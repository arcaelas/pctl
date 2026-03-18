import type { z } from 'zod';
import schema from '~/lib/schema';

export default async function validate(parsed: z.infer<typeof schema>) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
        const errors = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Schema validation failed:\n${errors}`);
    }
    for (const [name, service] of Object.entries(parsed.services)) {
        if (service.instances.min > service.instances.max) {
            throw new Error(`Service "${name}": instances.min (${service.instances.min}) cannot exceed instances.max (${service.instances.max})`);
        }
    }
}
