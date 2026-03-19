import { z } from 'zod';

export default z.object({
    name: z.string().describe('Stack name. Used as prefix for all service labels and resource names (e.g. pool → pool-reconciler).'),
    resolver: z.array(z.string()).default([]).describe('Custom resolver modules loaded after built-in resolvers (env, ssm, self, cfn). Each entry is a module path.'),
    plugin: z.array(z.string()).default([]).describe('Pipeline of plugins executed in order. Each entry is a module path. Plugins receive (parsed).'),
    custom: z.record(z.string(), z.any()).default({}).describe('Free-form key/value store for reusable values. Accessible via ${self:custom.*} from any service field.'),
    services: z.record(z.string(), z.object({
        image: z.string().describe('Path to Dockerfile (./ prefix) for build+push, or pre-built image name for pull only.'),
        registry: z.union([
            z.string(),
            z.object({
                url: z.string().describe('Registry URL (e.g. ghcr.io/user/repo, 507738...ecr.../pool).'),
                username: z.string().optional().describe('Registry username for authentication.'),
                password: z.string().optional().describe('Registry password or token for authentication.'),
            }),
        ]).optional().describe('Container registry for push/pull. String for URL only, object for URL with auth. Optional — not needed for local Docker or pre-built images.'),
        command: z.string().optional().describe('Override the CMD of the Dockerfile. Shell form string.'),
        env: z.record(z.string(), z.string()).optional().describe('Key/value environment variables passed to the container.'),
        scale: z.object({
            replica: z.union([z.number().int().min(0), z.tuple([z.number().int().min(0), z.number().int().min(1)])]).describe('Number of instances. Integer for fixed, tuple [min, max] for auto-scaling range.'),
            cpu: z.string().optional().describe('CPU limit for the container (e.g. 256m, 1).'),
            memory: z.string().optional().describe('Memory limit for the container (e.g. 512Mi, 1Gi).'),
        }).describe('Scaling and compute resources for the service.'),
        ports: z.array(z.union([z.number(), z.string()])).optional().describe('Ports to expose. Number (3000) or host:container mapping ("8080:3000").'),
        health: z.object({
            interval: z.number().int().min(1).describe('Seconds between health checks.'),
            command: z.string().describe('Command executed inside the container. Non-zero exit code marks unhealthy.'),
            retries: z.number().int().min(1).default(3).describe('Consecutive failures before triggering onfailure action.'),
            onfailure: z.enum(['restart', 'stop']).default('restart').describe('Action on health check failure. Restart recreates the container/pod. Stop halts it.'),
        }).optional().describe('Liveness probe configuration. Optional — omit for services that do not need health checks.'),
        volumes: z.array(z.object({
            path: z.string().describe('Mount path inside the container.'),
        })).optional().describe('Mount points inside the container. Storage is provisioned by provider.options.storage.'),
        provider: z.object({
            name: z.string().describe('Driver identifier for deployment (e.g. aws, docker, gcp).'),
            options: z.record(z.string(), z.any()).default({}).describe('Provider-specific configuration (credentials, cluster, namespace, registry, strategy, serviceAccount, rbac, storage).'),
        }).describe('Deployment target for this service.'),
    })).describe('Map of service names to their configuration.'),
});
