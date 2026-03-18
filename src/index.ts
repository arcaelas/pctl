import { readFile } from 'fs/promises';
import YAML from 'yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import deploy from '~/lib/plugin/deploy';
import resolve from '~/lib/plugin/resolve';
import validate from '~/lib/plugin/validate';
import cfg from '~/lib/schema';

export default async function pctl() {
    const argv = yargs(hideBin(process.argv))
        .option('config', { alias: 'c', type: 'string', demandOption: true })
        .parseSync();
    const raw = await readFile(argv.config, 'utf-8');
    const parsed = cfg.parse(YAML.parse(raw));
    for (const fn of [resolve, validate, ...parsed.plugins, deploy]) {
        const mod = typeof fn === 'string' ? require(fn) : (typeof fn === 'function' ? fn : null);
        await (mod?.default || mod)?.(parsed);
    }
}
