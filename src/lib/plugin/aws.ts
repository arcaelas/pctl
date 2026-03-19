import { Sha256 } from '@aws-crypto/sha256-js';
import { BatchDeleteImageCommand, ECRClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-ecr';
import { DescribeClusterCommand, EKSClient } from '@aws-sdk/client-eks';
import { formatUrl } from '@aws-sdk/util-format-url';
import * as k8s from '@kubernetes/client-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { z } from 'zod';
import type Schema from '~/lib/schema';

type Parsed = z.infer<typeof Schema>;
type Service = Parsed['services'][string];
type Registry = Exclude<Service['registry'], undefined>;
interface Credentials { region: string; access_key_id: string; secret_access_key: string; session_token?: string }
interface RbacRule { resources: string[]; verbs: string[] }
interface Storage { name?: string; id?: string; size?: string }
interface Options { credentials?: Credentials; cluster: string; namespace: string; strategy?: string; serviceAccount?: string; rbac?: RbacRule[]; storage?: Storage }
interface K8sClients { api: k8s.AppsV1Api; core: k8s.CoreV1Api; autoscaling: k8s.AutoscalingV1Api; rbac: k8s.RbacAuthorizationV1Api; storage: k8s.StorageV1Api }

const toSdk = (c?: Credentials) => c ? ({
    region: c.region,
    credentials: { accessKeyId: c.access_key_id, secretAccessKey: c.secret_access_key, ...(c.session_token ? { sessionToken: c.session_token } : {}) },
}) : {};

const toShell = (c?: Credentials): Record<string, string> => ({
    ...process.env as Record<string, string>,
    ...(c ? { AWS_REGION: c.region, AWS_ACCESS_KEY_ID: c.access_key_id, AWS_SECRET_ACCESS_KEY: c.secret_access_key, ...(c.session_token ? { AWS_SESSION_TOKEN: c.session_token } : {}) } : {}),
});

const lbl = (stack: string, name: string) => ({ 'managed-by': 'pctl', 'pctl-stack': stack, 'pctl-service': `${stack}-${name}` });

function registryUrl(reg?: Registry): string | undefined {
    if (!reg) return undefined;
    return typeof reg === 'string' ? reg : reg.url;
}

function registryAuth(reg?: Registry): { username?: string; password?: string } | undefined {
    if (!reg || typeof reg === 'string') return undefined;
    if (!reg.username && !reg.password) return undefined;
    return { username: reg.username, password: reg.password };
}

function isEcr(url?: string): boolean {
    return !!url?.includes('.dkr.ecr.');
}

function stFile(stack: string) { return resolvePath(process.cwd(), `pctl.${stack}.json`); }
function stRead(stack: string): Record<string, any> { try { return JSON.parse(readFileSync(stFile(stack), 'utf-8')); } catch { return {}; } }
function stWrite(stack: string, state: Record<string, any>) { writeFileSync(stFile(stack), JSON.stringify(state, null, 2)); }

function optsFromEntry(entry: Record<string, any>, parsed: Parsed): Options {
    const match = Object.values(parsed.services).find(s =>
        s.provider.name === 'aws' && (s.provider.options as Options).cluster === entry.cluster
    );
    const fallback = Object.values(parsed.services).find(s => s.provider.name === 'aws');
    const resolved = (match ?? fallback)?.provider?.options as Options | undefined;
    return { credentials: resolved?.credentials ?? entry.credentials, cluster: entry.cluster, namespace: entry.namespace };
}

const k8sCache = new Map<string, { clients: K8sClients; expires: number }>();

async function getToken(opts: Options): Promise<string> {
    const c = opts.credentials;
    const region = c?.region ?? process.env.AWS_REGION ?? 'us-east-1';
    const creds = c
        ? { accessKeyId: c.access_key_id, secretAccessKey: c.secret_access_key, ...(c.session_token ? { sessionToken: c.session_token } : {}) }
        : { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!, ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) };
    const signer = new SignatureV4({ credentials: creds, region, service: 'sts', sha256: Sha256 });
    const hostname = `sts.${region}.amazonaws.com`;
    const req = new HttpRequest({
        method: 'GET', protocol: 'https:', hostname, path: '/',
        query: { Action: 'GetCallerIdentity', Version: '2011-06-15' },
        headers: { host: hostname, 'x-k8s-aws-id': opts.cluster },
    });
    return `k8s-aws-v1.${Buffer.from(formatUrl(await signer.presign(req, { expiresIn: 60 }))).toString('base64url')}`;
}

async function k8sConnect(opts: Options): Promise<K8sClients> {
    const key = opts.cluster;
    const cached = k8sCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.clients;
    const eks = new EKSClient(toSdk(opts.credentials));
    const { cluster } = await eks.send(new DescribeClusterCommand({ name: opts.cluster }));
    if (!cluster) throw new Error(`[aws] cluster "${opts.cluster}" not found`);
    const kc = new k8s.KubeConfig();
    kc.loadFromOptions({
        clusters: [{ name: opts.cluster, server: cluster.endpoint!, caData: cluster.certificateAuthority!.data! }],
        contexts: [{ name: opts.cluster, cluster: opts.cluster, user: 'pctl' }],
        currentContext: opts.cluster,
        users: [{ name: 'pctl', token: await getToken(opts) }],
    });
    const clients: K8sClients = { api: kc.makeApiClient(k8s.AppsV1Api), core: kc.makeApiClient(k8s.CoreV1Api), autoscaling: kc.makeApiClient(k8s.AutoscalingV1Api), rbac: kc.makeApiClient(k8s.RbacAuthorizationV1Api), storage: kc.makeApiClient(k8s.StorageV1Api) };
    k8sCache.set(key, { clients, expires: Date.now() + 50_000 });
    return clients;
}

async function dockerLogin(reg: Registry | undefined, opts: Options): Promise<void> {
    const url = registryUrl(reg);
    if (!url) return;
    if (isEcr(url)) {
        const ecr = new ECRClient(toSdk(opts.credentials));
        const { authorizationData } = await ecr.send(new GetAuthorizationTokenCommand({}));
        const [user, pass] = Buffer.from(authorizationData![0].authorizationToken!, 'base64').toString().split(':');
        execSync(`docker login -u ${user} --password-stdin ${authorizationData![0].proxyEndpoint!}`, { input: pass, stdio: ['pipe', 'inherit', 'inherit'], env: toShell(opts.credentials) });
    } else {
        const auth = registryAuth(reg);
        if (auth?.username && auth?.password) {
            execSync(`docker login -u ${auth.username} --password-stdin ${url}`, { input: auth.password, stdio: ['pipe', 'inherit', 'inherit'] });
        }
    }
}

async function buildPush(service: Service, opts: Options, configDir: string): Promise<string> {
    const url = registryUrl(service.registry);
    if (!service.image.startsWith('./')) return service.image;
    if (!url) throw new Error(`[aws] registry is required for building images`);
    const dockerfile = resolvePath(configDir, service.image);
    const tag = `${url}:${Date.now()}`;
    const e = toShell(opts.credentials);
    execSync(`docker build -t ${tag} -t ${url}:latest -f ${dockerfile} ${configDir}`, { stdio: 'inherit', env: e });
    await dockerLogin(service.registry, opts);
    execSync(`docker push ${tag} && docker push ${url}:latest`, { stdio: 'inherit', env: e });
    return tag;
}

function imagePullSecretName(full: string) { return `${full}-regcred`; }

function compile(stack: string, name: string, image: string, service: Service, opts: Options) {
    const full = `${stack}-${name}`;
    const l = lbl(stack, name);
    const ns = opts.namespace;
    const isAutoScale = Array.isArray(service.scale.replica);
    const replica = isAutoScale ? service.scale.replica[0] : service.scale.replica;
    const { cpu, memory } = service.scale;
    const regAuth = registryAuth(service.registry);
    const needsPullSecret = !!regAuth && !isEcr(registryUrl(service.registry));

    const container: k8s.V1Container = {
        name: full, image,
        env: Object.entries(service.env ?? {}).map(([k, v]) => ({ name: k, value: String(v) })),
        ...(cpu || memory ? { resources: { limits: { ...(cpu ? { cpu } : {}), ...(memory ? { memory } : {}) } } } : {}),
    };
    if (service.command) container.command = ['sh', '-c', service.command];
    if (service.ports) container.ports = service.ports.map(p => ({ containerPort: String(p).includes(':') ? +String(p).split(':')[1] : +p }));
    if (service.health) {
        const probe = { exec: { command: ['sh', '-c', service.health.command] }, periodSeconds: service.health.interval, failureThreshold: service.health.retries };
        if (service.health.onfailure === 'restart') container.livenessProbe = probe;
        else container.readinessProbe = probe;
    }

    const volumes: k8s.V1Volume[] = [];
    const mounts: k8s.V1VolumeMount[] = [];
    const storage = opts.storage;
    const volName = `${full}-storage`;
    const isEfs = storage?.name === 'efs' && storage?.id;
    const isEbs = !isEfs && !!storage?.size;
    const hasPersistent = isEfs || isEbs;

    if (service.volumes?.length) {
        for (const [i, v] of service.volumes.entries()) mounts.push({ name: volName, mountPath: v.path, subPath: `vol-${i}` });
        volumes.push(hasPersistent ? { name: volName, persistentVolumeClaim: { claimName: volName } } : { name: volName, emptyDir: {} });
        container.volumeMounts = mounts;
    }

    const pv: k8s.V1PersistentVolume | null = isEfs ? {
        metadata: { name: volName, labels: l },
        spec: { capacity: { storage: '100Gi' }, accessModes: ['ReadWriteMany'], persistentVolumeReclaimPolicy: 'Retain', storageClassName: 'efs-sc', csi: { driver: 'efs.csi.aws.com', volumeHandle: storage!.id! } },
    } : null;

    const pvc: k8s.V1PersistentVolumeClaim | null = hasPersistent ? {
        metadata: { name: volName, namespace: ns, labels: l },
        spec: {
            accessModes: [isEfs ? 'ReadWriteMany' : 'ReadWriteOnce'],
            resources: { requests: { storage: isEbs ? storage!.size! : '100Gi' } },
            ...(isEbs ? { storageClassName: 'gp2' } : {}),
            ...(isEfs ? { storageClassName: 'efs-sc', volumeName: volName } : {}),
        },
    } : null;

    const saName = opts.serviceAccount ?? full;

    const pullSecret: k8s.V1Secret | null = needsPullSecret ? {
        metadata: { name: imagePullSecretName(full), namespace: ns, labels: l },
        type: 'kubernetes.io/dockerconfigjson',
        data: {
            '.dockerconfigjson': Buffer.from(JSON.stringify({
                auths: { [registryUrl(service.registry)!]: { username: regAuth!.username, password: regAuth!.password, auth: Buffer.from(`${regAuth!.username}:${regAuth!.password}`).toString('base64') } }
            })).toString('base64'),
        },
    } : null;

    const dep: k8s.V1Deployment = {
        metadata: { name: full, namespace: ns, labels: l },
        spec: {
            replicas: replica,
            ...(opts.strategy ? { strategy: { type: opts.strategy } } : {}),
            selector: { matchLabels: l },
            template: {
                metadata: { labels: l },
                spec: {
                    ...(opts.serviceAccount || opts.rbac ? { serviceAccountName: saName } : {}),
                    ...(needsPullSecret ? { imagePullSecrets: [{ name: imagePullSecretName(full) }] } : {}),
                    containers: [container],
                    ...(volumes.length ? { volumes } : {}),
                },
            },
        },
    };

    const svc: k8s.V1Service | null = service.ports?.length ? {
        metadata: { name: full, namespace: ns, labels: l },
        spec: { selector: l, ports: service.ports.map(p => { const s = String(p); if (s.includes(':')) { const [h, c] = s.split(':').map(Number); return { port: h, targetPort: c as any }; } return { port: +s, targetPort: +s as any }; }) },
    } : null;

    const hpa: k8s.V1HorizontalPodAutoscaler | null = isAutoScale ? {
        metadata: { name: full, namespace: ns, labels: l },
        spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: full }, minReplicas: (service.scale.replica as [number, number])[0], maxReplicas: (service.scale.replica as [number, number])[1], targetCPUUtilizationPercentage: 80 },
    } : null;

    const rbacResources: { sa: k8s.V1ServiceAccount; role: k8s.V1Role; binding: k8s.V1RoleBinding } | null = opts.rbac?.length ? {
        sa: { metadata: { name: saName, namespace: ns, labels: l } },
        role: { metadata: { name: saName, namespace: ns, labels: l }, rules: opts.rbac.map(r => ({ apiGroups: [''], resources: r.resources, verbs: r.verbs })) },
        binding: { metadata: { name: saName, namespace: ns, labels: l }, subjects: [{ kind: 'ServiceAccount', name: saName, namespace: ns }], roleRef: { kind: 'Role', name: saName, apiGroup: 'rbac.authorization.k8s.io' } },
    } : null;

    return { full, ns, l, dep, svc, pv, pvc, hpa, rbacResources, pullSecret, image, hasPorts: !!service.ports?.length, hasHpa: !!hpa, hasRbac: !!rbacResources, hasPvc: !!pvc, hasPv: !!pv, hasPullSecret: !!pullSecret };
}

function fingerprint(service: Service, configDir: string): string {
    const { provider, ...rest } = service;
    function sortKeys(obj: any): any {
        if (Array.isArray(obj)) return obj.map(sortKeys);
        if (obj && typeof obj === 'object')
            return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = sortKeys(obj[k]); return acc; }, {} as any);
        return obj;
    }
    let hash = JSON.stringify(sortKeys(rest));
    if (service.image.startsWith('./')) {
        const dockerfile = resolvePath(configDir, service.image);
        if (existsSync(dockerfile)) hash += createHash('md5').update(readFileSync(dockerfile)).digest('hex');
    }
    return createHash('sha256').update(hash).digest('hex');
}

async function applyService(artifact: ReturnType<typeof compile>, opts: Options, clients: K8sClients, prev: Record<string, any> | undefined) {
    const { api, core, autoscaling, rbac } = clients;
    const { full, ns } = artifact;

    await core.createNamespace({ body: { metadata: { name: ns } } }).catch(() => {});

    if (artifact.rbacResources) {
        const { sa, role, binding } = artifact.rbacResources;
        await core.createNamespacedServiceAccount({ namespace: ns, body: sa }).catch(() => {});
        try { await rbac.readNamespacedRole({ name: sa.metadata!.name!, namespace: ns }); await rbac.replaceNamespacedRole({ name: sa.metadata!.name!, namespace: ns, body: role }); }
        catch { await rbac.createNamespacedRole({ namespace: ns, body: role }); }
        try { await rbac.readNamespacedRoleBinding({ name: sa.metadata!.name!, namespace: ns }); await rbac.replaceNamespacedRoleBinding({ name: sa.metadata!.name!, namespace: ns, body: binding }); }
        catch { await rbac.createNamespacedRoleBinding({ namespace: ns, body: binding }); }
    } else if (prev?.hasRbac) {
        await rbac.deleteNamespacedRoleBinding({ name: full, namespace: ns }).catch(() => {});
        await rbac.deleteNamespacedRole({ name: full, namespace: ns }).catch(() => {});
        await core.deleteNamespacedServiceAccount({ name: full, namespace: ns }).catch(() => {});
    }

    if (artifact.pullSecret) {
        try { await core.readNamespacedSecret({ name: imagePullSecretName(full), namespace: ns }); await core.replaceNamespacedSecret({ name: imagePullSecretName(full), namespace: ns, body: artifact.pullSecret }); }
        catch { await core.createNamespacedSecret({ namespace: ns, body: artifact.pullSecret }); }
    } else if (prev?.hasPullSecret) {
        await core.deleteNamespacedSecret({ name: imagePullSecretName(full), namespace: ns }).catch(() => {});
    }

    if (artifact.pv) {
        await clients.storage.createStorageClass({ body: { metadata: { name: 'efs-sc' }, provisioner: 'efs.csi.aws.com' } }).catch(() => {});
        await core.createPersistentVolume({ body: artifact.pv }).catch(() => {});
    } else if (prev?.hasPv) await core.deletePersistentVolume({ name: `${full}-storage` }).catch(() => {});

    if (artifact.pvc) await core.createNamespacedPersistentVolumeClaim({ namespace: ns, body: artifact.pvc }).catch(() => {});
    else if (prev?.hasPvc) await core.deleteNamespacedPersistentVolumeClaim({ name: `${full}-storage`, namespace: ns }).catch(() => {});

    try { await api.readNamespacedDeployment({ name: full, namespace: ns }); await api.replaceNamespacedDeployment({ name: full, namespace: ns, body: artifact.dep }); }
    catch { await api.createNamespacedDeployment({ namespace: ns, body: artifact.dep }); }

    if (artifact.svc) {
        try { await core.readNamespacedService({ name: full, namespace: ns }); await core.replaceNamespacedService({ name: full, namespace: ns, body: artifact.svc }); }
        catch { await core.createNamespacedService({ namespace: ns, body: artifact.svc }); }
    } else if (prev?.hasPorts) {
        await core.deleteNamespacedService({ name: full, namespace: ns }).catch(() => {});
    }

    if (artifact.hpa) {
        try { await autoscaling.readNamespacedHorizontalPodAutoscaler({ name: full, namespace: ns }); await autoscaling.replaceNamespacedHorizontalPodAutoscaler({ name: full, namespace: ns, body: artifact.hpa }); }
        catch { await autoscaling.createNamespacedHorizontalPodAutoscaler({ namespace: ns, body: artifact.hpa }); }
    } else if (prev?.hasHpa) {
        await autoscaling.deleteNamespacedHorizontalPodAutoscaler({ name: full, namespace: ns }).catch(() => {});
    }

    if (artifact.dep.spec?.replicas) {
        const start = Date.now();
        while (Date.now() - start < 120_000) {
            const { status } = await api.readNamespacedDeployment({ name: full, namespace: ns });
            if (status?.readyReplicas && status.readyReplicas >= (artifact.dep.spec.replicas ?? 1)) return;
            await new Promise(r => setTimeout(r, 3000));
        }
        console.warn(`[aws] rollout timeout for "${full}"`);
    }
}

async function removeService(full: string, entry: Record<string, any>, clients: K8sClients, opts: Options) {
    const { api, core, autoscaling, rbac } = clients;
    const ns = entry.namespace;
    const sel = Object.entries(entry.labels).map(([k, v]) => `${k}=${v}`).join(',');

    if (entry.hasHpa) await autoscaling.deleteNamespacedHorizontalPodAutoscaler({ name: full, namespace: ns }).catch(() => {});
    await api.deleteNamespacedDeployment({ name: full, namespace: ns }).catch(() => {});
    if (entry.hasPorts) await core.deleteNamespacedService({ name: full, namespace: ns }).catch(() => {});
    if (entry.hasPullSecret) await core.deleteNamespacedSecret({ name: imagePullSecretName(full), namespace: ns }).catch(() => {});
    if (entry.hasRbac) {
        await rbac.deleteNamespacedRoleBinding({ name: full, namespace: ns }).catch(() => {});
        await rbac.deleteNamespacedRole({ name: full, namespace: ns }).catch(() => {});
        await core.deleteNamespacedServiceAccount({ name: full, namespace: ns }).catch(() => {});
    }
    if (entry.hasPvc) await core.deleteNamespacedPersistentVolumeClaim({ name: `${full}-storage`, namespace: ns }).catch(() => {});
    if (entry.hasPv) await core.deletePersistentVolume({ name: `${full}-storage` }).catch(() => {});

    if (entry.registryUrl && entry.image && entry.pushedByPctl && isEcr(entry.registryUrl)) {
        const tag = entry.image.split(':').pop();
        const parts = entry.registryUrl.split('/');
        const repo = parts[parts.length - 1];
        if (tag && repo) {
            const ecr = new ECRClient(toSdk(opts.credentials));
            await ecr.send(new BatchDeleteImageCommand({ repositoryName: repo, imageIds: [{ imageTag: tag }, { imageTag: 'latest' }] })).catch(() => {});
        }
    }

    const start = Date.now();
    while (Date.now() - start < 60_000) {
        const { items } = await core.listNamespacedPod({ namespace: ns, labelSelector: sel }).catch(() => ({ items: [] as k8s.V1Pod[] }));
        if (!items.length) return;
        await new Promise(r => setTimeout(r, 2000));
    }
    console.warn(`[aws] pods for "${full}" still terminating after 60s`);
}

async function cleanNamespaces(namespaces: Set<string>, entries: Record<string, any>[], parsed: Parsed) {
    for (const ns of namespaces) {
        const entry = entries.find(e => e.namespace === ns);
        if (!entry) continue;
        const opts = optsFromEntry(entry, parsed);
        const { core, storage } = await k8sConnect(opts);

        const start = Date.now();
        while (Date.now() - start < 30_000) {
            const { items } = await core.listNamespacedPod({ namespace: ns }).catch(() => ({ items: [] }));
            if (!items.length) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        const { items: pods } = await core.listNamespacedPod({ namespace: ns }).catch(() => ({ items: [] }));
        if (!pods.length) {
            await core.deleteNamespace({ name: ns }).catch(() => {});
            const nsStart = Date.now();
            while (Date.now() - nsStart < 30_000) {
                try { await core.readNamespace({ name: ns }); await new Promise(r => setTimeout(r, 2000)); }
                catch { break; }
            }
            console.log(`[aws] namespace "${ns}" removed`);
        }

        await storage.deleteStorageClass({ name: 'efs-sc' }).catch(() => {});
    }
}

export default async function aws(parsed: Parsed) {
    const cmd = process.argv.includes('deploy') ? 'deploy'
        : process.argv.includes('destroy') ? 'destroy' : null;
    if (!cmd) return;

    const stack = parsed.name;
    const argv = yargs(hideBin(process.argv)).option('config', { alias: 'c', type: 'string', default: './pctl.yaml' }).parseSync();
    const configDir = dirname(resolvePath(argv.config));
    const prev = stRead(stack);

    const services = Object.entries(parsed.services).filter(([, s]) => s.provider.name === 'aws');
    if (!services.length && cmd === 'deploy') return;
    if (!Object.keys(prev).length && cmd === 'destroy') return;

    if (cmd === 'deploy') {
        const next: Record<string, any> = {};

        for (const [name, service] of services) {
            const opts = service.provider.options as Options;
            if (!opts.cluster || !opts.namespace)
                throw new Error(`[aws] service "${name}" missing required options (cluster, namespace)`);
            if (service.image.startsWith('./') && !service.registry)
                throw new Error(`[aws] service "${name}" requires registry for Dockerfile builds`);

            const full = `${stack}-${name}`;
            const fp = fingerprint(service, configDir);
            if (prev[full]?.fingerprint === fp) {
                console.log(`[aws] "${full}" unchanged, skipping`);
                next[full] = prev[full];
                continue;
            }

            const pushedByPctl = service.image.startsWith('./');
            const image = await buildPush(service, opts, configDir);
            const artifact = compile(stack, name, image, service, opts);
            const clients = await k8sConnect(opts);

            await applyService(artifact, opts, clients, prev[full]);

            const regUrl = registryUrl(service.registry);
            next[full] = { provider: 'aws', cluster: opts.cluster, namespace: artifact.ns, registryUrl: regUrl, image, labels: artifact.l, fingerprint: fp, hasPorts: artifact.hasPorts, hasHpa: artifact.hasHpa, hasRbac: artifact.hasRbac, hasPvc: artifact.hasPvc, hasPv: artifact.hasPv, hasPullSecret: artifact.hasPullSecret, pushedByPctl };
            stWrite(stack, { ...prev, ...next });
            console.log(`[aws] deployed "${full}"`);
        }

        const removed = Object.keys(prev).filter(k => prev[k].provider === 'aws' && !next[k] && !prev[k].destroyed);
        const namespacesToCheck = new Set<string>();

        for (const full of removed) {
            const entry = prev[full];
            const opts = optsFromEntry(entry, parsed);
            const clients = await k8sConnect(opts);
            await removeService(full, entry, clients, opts);
            namespacesToCheck.add(entry.namespace);
            console.log(`[aws] removed "${full}" (no longer in config)`);
        }

        if (namespacesToCheck.size) await cleanNamespaces(namespacesToCheck, removed.map(k => prev[k]), parsed);

        const finalState = { ...prev, ...next };
        for (const k of removed) delete finalState[k];
        stWrite(stack, finalState);
    }

    if (cmd === 'destroy') {
        const namespacesToCheck = new Set<string>();
        const entries: Record<string, any>[] = [];

        for (const [full, entry] of Object.entries(prev)) {
            if (entry.provider !== 'aws' || entry.destroyed) continue;
            const opts = optsFromEntry(entry, parsed);
            const clients = await k8sConnect(opts);
            await removeService(full, entry, clients, opts);
            namespacesToCheck.add(entry.namespace);
            entries.push(entry);
            console.log(`[aws] destroyed "${full}"`);
        }

        if (namespacesToCheck.size) await cleanNamespaces(namespacesToCheck, entries, parsed);

        const destroyed = { ...prev };
        for (const k in destroyed) if (destroyed[k].provider === 'aws') destroyed[k].destroyed = true;
        stWrite(stack, destroyed);
    }
}
