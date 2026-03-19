#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import YAML from 'yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import aws from '~/lib/plugin/aws';
import docker from '~/lib/plugin/docker';
import gcp from '~/lib/plugin/gcp';
import resolve from '~/lib/plugin/resolve';
import validate from '~/lib/plugin/validate';
import schema from '~/lib/schema';

export default async function pctl() {
    const argv = yargs(hideBin(process.argv))
        .option('config', {
            alias: 'c',
            type: 'string',
            default: './pctl.yaml',
            describe: 'Path to the configuration file',
        })
        .option('name', {
            type: 'string',
            describe: 'Override the stack name defined in the config file',
        }).parseSync();
    const parsed = schema.parse(YAML.parse(await readFile(resolvePath(argv.config), 'utf-8')));
    parsed.name = argv.name ?? parsed.name;
    for (const fn of [resolve, validate, ...parsed.plugin, aws, docker, gcp]) {
        const mod = typeof fn === 'string' ? require(fn) : (typeof fn === 'function' ? fn : null);
        const handler = typeof mod === 'function' ? mod : mod?.default;
        if (typeof handler !== 'function') continue;
        await handler(parsed);
    }
}

pctl().catch(err => { console.error(err.message); process.exit(1); });
