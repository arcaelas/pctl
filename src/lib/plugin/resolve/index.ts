import { Noop } from '@arcaelas/utils';
import type { z } from 'zod';
import schema from '~/lib/schema';
import Env from './resolver/env';
import Self from './resolver/self';
import Ssm from './resolver/ssm';

export default async function resolve(parsed: z.infer<typeof schema>) {
    let uid = 0;
    const refs = new Map<string, any>();
    const pool = new Map<string, Noop>();
    for (const fn of [Env, Ssm, Self, ...parsed.resolvers]) {
        const mod = typeof fn === 'string' ? require(fn) : (typeof fn === 'function' ? fn : null);
        const instance = new (mod?.default || mod)(parsed);
        if (!pool.has(instance.name)) {
            pool.set(instance.name, instance);
        } else throw new Error(`Resolver "${instance.name}" already registered`);
    }
    parsed.services = await (async function walk(options: any): Promise<any> {
        if (typeof options === 'string') {
            if (refs.has(options)) return refs.get(options);
            let str = options;
            let match: RegExpExecArray | null;
            while ((match = /\$\{([^:}]+):([^{}]*)}/.exec(str))) {
                const [expr, name, args] = match;
                const resolver = pool.get(name.trim());
                if (!resolver) throw new Error(`Resolver "${name.trim()}" not found`);
                const params = args.split(',').map(s => refs.get(s.trim()) ?? s.trim());
                const value = await resolver(...params);
                if (expr === str) return walk(value);
                if (typeof value !== 'string') {
                    const key = `__pctl_${uid++}__`;
                    refs.set(key, value);
                    str = str.replace(expr, key);
                } else str = str.replace(expr, value);
            }
            return str;
        } else if (Array.isArray(options))
            return await Promise.all(options.map(i => walk(i)));
        else if (typeof (options ?? 0) === 'object') {
            for (const k in options)
                options[k] = await walk(options[k]);
            return options;
        }
        return options;
    })(parsed.services);
}
