import type { z } from 'zod';
import schema from '~/lib/schema';

export default async function validate(parsed: z.infer<typeof schema>) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
        const errors = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Schema validation failed:\n${errors}`);
    }
    for (const [name, service] of Object.entries(parsed.services)) {
        const { replica } = service.scale;
        if (Array.isArray(replica) && replica[0] > replica[1]) {
            throw new Error(`Service "${name}": scale.replica min (${replica[0]}) cannot exceed max (${replica[1]})`);
        }
    }
}
