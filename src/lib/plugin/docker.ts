import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { dirname, resolve as resolvePath } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { z } from 'zod';
import type Schema from '~/lib/schema';

type Parsed = z.infer<typeof Schema>;
type Service = Parsed['services'][string];
type Registry = Exclude<Service['registry'], undefined>;
interface Options { host?: string; user?: string; key?: string; sudo?: boolean }

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

function stFile(stack: string) { return resolvePath(process.cwd(), `pctl.${stack}.json`); }
function stRead(stack: string): Record<string, any> { try { return JSON.parse(readFileSync(stFile(stack), 'utf-8')); } catch { return {}; } }
function stWrite(stack: string, state: Record<string, any>) { writeFileSync(stFile(stack), JSON.stringify(state, null, 2)); }

function expandHome(p: string): string { return p.startsWith('~') ? p.replace('~', homedir()) : p; }

function ssh(opts: Options, cmd: string): string {
    if (!opts.host) return cmd;
    const keyFlag = opts.key ? `-i ${resolvePath(expandHome(opts.key))}` : '';
    const userHost = opts.user ? `${opts.user}@${opts.host}` : opts.host;
    const prefix = opts.sudo ? 'sudo ' : '';
    return `ssh ${keyFlag} -o StrictHostKeyChecking=no ${userHost} '${(prefix + cmd).replace(/'/g, "'\\''")}'`;
}

function run(opts: Options, cmd: string) {
    execSync(opts.host ? ssh(opts, cmd) : cmd, { stdio: 'inherit' });
}

function dockerLogin(reg?: Registry, remote?: Options) {
    const url = registryUrl(reg);
    if (!url) return;
    const auth = registryAuth(reg);
    if (!auth?.username || !auth?.password) return;
    const loginCmd = `docker login -u ${auth.username} --password-stdin ${url}`;
    execSync(loginCmd, { input: auth.password, stdio: ['pipe', 'inherit', 'inherit'] });
    if (remote?.host) {
        execSync(ssh(remote, loginCmd), { input: auth.password, stdio: ['pipe', 'inherit', 'inherit'] });
    }
}

function buildPush(service: Service, opts: Options, configDir: string): string {
    if (!service.image.startsWith('./')) return service.image;
    const url = registryUrl(service.registry);
    const dockerfile = resolvePath(configDir, service.image);
    const tag = url ? `${url}:${Date.now()}` : `pctl-local:${Date.now()}`;
    execSync(`docker build -t ${tag} -f ${dockerfile} ${configDir}`, { stdio: 'inherit' });
    if (url) {
        dockerLogin(service.registry);
        execSync(`docker push ${tag}`, { stdio: 'inherit' });
        if (opts.host) {
            dockerLogin(service.registry, opts);
            run(opts, `docker pull ${tag}`);
        }
    } else if (opts.host) {
        const archive = `/tmp/${tag.replace(/[/:]/g, '_')}.tar`;
        execSync(`docker save ${tag} -o ${archive}`, { stdio: 'inherit' });
        const keyFlag = opts.key ? `-i ${resolvePath(expandHome(opts.key))}` : '';
        const userHost = opts.user ? `${opts.user}@${opts.host}` : opts.host;
        execSync(`scp ${keyFlag} -o StrictHostKeyChecking=no ${archive} ${userHost}:${archive}`, { stdio: 'inherit' });
        run(opts, `docker load -i ${archive} && rm ${archive}`);
        execSync(`rm ${archive}`, { stdio: 'inherit' });
    }
    return tag;
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

function runArgs(full: string, service: Service, image: string, labels: Record<string, string>): string {
    const args: string[] = ['--name', full, '-d'];
    for (const [k, v] of Object.entries(labels)) args.push('--label', `${k}=${v}`);
    if (service.env) for (const [k, v] of Object.entries(service.env)) args.push('-e', `${k}=${v}`);
    if (service.scale.cpu) args.push('--cpus', service.scale.cpu.replace('m', 'e-3'));
    if (service.scale.memory) args.push('--memory', service.scale.memory.replace('Mi', 'm').replace('Gi', 'g'));
    if (service.ports) for (const p of service.ports) { const s = String(p); args.push('-p', s.includes(':') ? s : `${s}:${s}`); }
    if (service.volumes) for (const v of service.volumes) args.push('-v', `${full}-storage:${v.path}`);
    if (service.health) {
        args.push('--health-cmd', `"${service.health.command}"`);
        args.push('--health-interval', `${service.health.interval}s`);
        args.push('--health-retries', `${service.health.retries}`);
    }
    args.push('--restart', service.health?.onfailure === 'stop' ? 'no' : 'unless-stopped');
    if (service.command) args.push(image, 'sh', '-c', service.command);
    else args.push(image);
    return `docker run ${args.join(' ')}`;
}

export default async function docker(parsed: Parsed) {
    const cmd = process.argv.includes('deploy') ? 'deploy'
        : process.argv.includes('destroy') ? 'destroy' : null;
    if (!cmd) return;

    const stack = parsed.name;
    const argv = yargs(hideBin(process.argv)).option('config', { alias: 'c', type: 'string', default: './pctl.yaml' }).parseSync();
    const configDir = dirname(resolvePath(argv.config));
    const prev = stRead(stack);

    const services = Object.entries(parsed.services).filter(([, s]) => s.provider.name === 'docker');
    if (!services.length && cmd === 'deploy') return;
    if (!Object.keys(prev).length && cmd === 'destroy') return;

    if (cmd === 'deploy') {
        const next: Record<string, any> = {};

        for (const [name, service] of services) {
            const opts = service.provider.options as Options;
            const replica = Array.isArray(service.scale.replica) ? service.scale.replica[1] : service.scale.replica;
            if (service.image.startsWith('./') && !service.registry && opts.host)
                console.warn(`[docker] "${name}": no registry for remote host, using docker save/load`);

            const fp = fingerprint(service, configDir);
            const full = `${stack}-${name}`;
            const prevReplica = prev[full]?.replica ?? 0;
            if (prev[full]?.fingerprint === fp && prevReplica === replica) {
                console.log(`[docker] "${full}" unchanged, skipping`);
                next[full] = prev[full];
                continue;
            }

            const pushedByPctl = service.image.startsWith('./');
            const image = buildPush(service, opts, configDir);
            const l = lbl(stack, name);

            for (let i = 1; i <= Math.max(prevReplica, replica); i++) {
                const cname = replica > 1 ? `${full}-${i}` : full;
                run(opts, `docker rm -f ${cname} 2>/dev/null || true`);
            }

            for (let i = 1; i <= replica; i++) {
                const cname = replica > 1 ? `${full}-${i}` : full;
                run(opts, runArgs(cname, service, image, l));
                console.log(`[docker] started "${cname}"`);
            }

            const regUrl = registryUrl(service.registry);
            next[full] = { provider: 'docker', host: opts.host ?? 'local', user: opts.user, key: opts.key, sudo: opts.sudo, registryUrl: regUrl, image, labels: l, fingerprint: fp, replica, hasPorts: !!service.ports?.length, pushedByPctl };
            stWrite(stack, { ...prev, ...next });
            console.log(`[docker] deployed "${full}" (${replica} replica${replica > 1 ? 's' : ''})`);
        }

        const removed = Object.keys(prev).filter(k => prev[k].provider === 'docker' && !next[k] && !prev[k].destroyed);
        for (const full of removed) {
            const entry = prev[full];
            const opts: Options = { host: entry.host === 'local' ? undefined : entry.host, user: entry.user, key: entry.key, sudo: entry.sudo };
            const r = entry.replica ?? 1;
            for (let i = 1; i <= r; i++) {
                const cname = r > 1 ? `${full}-${i}` : full;
                run(opts, `docker rm -f ${cname} 2>/dev/null || true`);
            }
            run(opts, `docker volume rm ${full}-storage 2>/dev/null || true`);
            console.log(`[docker] removed "${full}" (no longer in config)`);
        }

        const finalState = { ...prev, ...next };
        for (const k of removed) delete finalState[k];
        stWrite(stack, finalState);
    }

    if (cmd === 'destroy') {
        for (const [full, entry] of Object.entries(prev)) {
            if (entry.provider !== 'docker' || entry.destroyed) continue;
            const opts: Options = { host: entry.host === 'local' ? undefined : entry.host, user: entry.user, key: entry.key, sudo: entry.sudo };
            const r = entry.replica ?? 1;
            for (let i = 1; i <= r; i++) {
                const cname = r > 1 ? `${full}-${i}` : full;
                run(opts, `docker rm -f ${cname} 2>/dev/null || true`);
            }
            run(opts, `docker volume rm ${full}-storage 2>/dev/null || true`);
            if (entry.pushedByPctl) run(opts, `docker rmi ${entry.image} 2>/dev/null || true`);
            console.log(`[docker] destroyed "${full}"`);
        }

        const destroyed = { ...prev };
        for (const k in destroyed) if (destroyed[k].provider === 'docker') destroyed[k].destroyed = true;
        stWrite(stack, destroyed);
    }
}
