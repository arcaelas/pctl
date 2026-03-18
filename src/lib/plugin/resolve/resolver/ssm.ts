import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export default class Ssm extends Function {
    constructor(_parsed: any) {
        super();
        const client = new SSMClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, string | null>();
        return function ssm(key: string, fallback?: any) {
            if (cache.has(key)) return cache.get(key) ?? fallback ?? null;
            return client.send(new GetParameterCommand({ Name: key, WithDecryption: true }))
                .then(res => {
                    const value = res.Parameter?.Value ?? null;
                    cache.set(key, value);
                    return value ?? fallback ?? null;
                })
                .catch(() => {
                    cache.set(key, null);
                    return fallback ?? null;
                });
        };
    }
}
