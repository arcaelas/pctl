import { z } from 'zod';

export default z.object({
    resolvers: z.array(z.string()).default([]).describe('Custom resolver modules loaded after built-in resolvers (env, ssm). Each entry is a module path exporting a class that extends Resolver.'),
    plugins: z.array(z.string()).default([]).describe('Pipeline of plugins executed in order after resolution. Each entry is a module path or package name. Runs between validate (first) and deploy (last).'),
    services: z.record(z.string(), z.object({
        image: z.string().describe('Path to the Dockerfile used to build the pod image.'),
        env: z.record(z.string(), z.string()).optional().describe('Key/value environment variables passed to the pod.'),
        instances: z.object({
            min: z.number().int().min(0).describe('Minimum number of instances when idle. 0 enables scale-to-zero.'),
            max: z.number().int().min(1).describe('Maximum number of instances allowed.'),
        }).describe('Scaling boundaries for the service.'),
        resources: z.object({
            cpu: z.union([z.string(), z.tuple([z.string(), z.string()])]).describe('CPU allocation. String sets limit only, tuple sets [request, limit].'),
            memory: z.union([z.string(), z.tuple([z.string(), z.string()])]).describe('Memory allocation. String sets limit only, tuple sets [request, limit].'),
        }).optional().describe('Kubernetes resource requests and limits.'),
        health: z.object({
            interval: z.number().int().min(1).describe('Seconds between health checks.'),
            cmd: z.string().describe('Shell command executed inside the pod. Non-zero exit kills the pod.'),
        }).optional().describe('Liveness probe configuration using exec strategy.'),
    })).describe('Map of service names to their pod configuration.'),
});
