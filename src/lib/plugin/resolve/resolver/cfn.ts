import { CloudFormationClient, DescribeStacksCommand, ListExportsCommand } from '@aws-sdk/client-cloudformation';

export default class Cfn extends Function {
    constructor(_parsed: any) {
        super();
        const client = new CloudFormationClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, any>();
        async function getExport(name: string): Promise<string | null> {
            if (cache.has(`export:${name}`)) return cache.get(`export:${name}`);
            let token: string | undefined;
            do {
                const res = await client.send(new ListExportsCommand({ NextToken: token }));
                for (const exp of res.Exports ?? []) {
                    cache.set(`export:${exp.Name}`, exp.Value ?? null);
                }
                token = res.NextToken;
            } while (token && !cache.has(`export:${name}`));
            if (!cache.has(`export:${name}`)) cache.set(`export:${name}`, null);
            return cache.get(`export:${name}`);
        }
        async function getOutput(stack: string, key: string): Promise<string | null> {
            const cacheKey = `output:${stack}.${key}`;
            if (cache.has(cacheKey)) return cache.get(cacheKey);
            const res = await client.send(new DescribeStacksCommand({ StackName: stack })).catch(() => null);
            for (const output of res?.Stacks?.[0]?.Outputs ?? []) {
                cache.set(`output:${stack}.${output.OutputKey}`, output.OutputValue ?? null);
            }
            if (!cache.has(cacheKey)) cache.set(cacheKey, null);
            return cache.get(cacheKey);
        }
        return function cfn(key: string, fallback?: any) {
            const dot = key.indexOf('.');
            if (dot === -1) return getExport(key).then(v => v ?? fallback ?? null);
            return getOutput(key.slice(0, dot), key.slice(dot + 1)).then(v => v ?? fallback ?? null);
        };
    }
}
