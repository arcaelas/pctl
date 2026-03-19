# Providers API

## Provider Interface

A provider is an async function that receives the parsed config, checks `process.argv` for `deploy` or `destroy`, and acts on services that match its provider name:

```typescript
async function myProvider(parsed: z.infer<typeof Schema>): Promise<void> {
    const cmd = process.argv.includes('deploy') ? 'deploy'
        : process.argv.includes('destroy') ? 'destroy' : null;
    if (!cmd) return;

    const services = Object.entries(parsed.services)
        .filter(([, s]) => s.provider.name === 'myprovider');

    if (cmd === 'deploy') {
        for (const [name, service] of services) {
            // Deploy logic
        }
    }

    if (cmd === 'destroy') {
        // Destroy logic using state file
    }
}
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `parsed` | `z.infer<typeof Schema>` | The full parsed config after resolver, validation, and plugin processing. |

### Return Value

`void`. Providers perform side effects (create containers, apply Kubernetes manifests, etc.).

## Command Detection

Providers read `process.argv` to determine the command:

```typescript
const cmd = process.argv.includes('deploy') ? 'deploy'
    : process.argv.includes('destroy') ? 'destroy' : null;
if (!cmd) return;
```

If neither `deploy` nor `destroy` is in the args, the provider returns immediately.

## Service Filtering

Each provider filters services by `provider.name`:

```typescript
const services = Object.entries(parsed.services)
    .filter(([, s]) => s.provider.name === 'aws');
```

Only services with the matching provider name are processed.

## State File

### Format

State is stored as `pctl.{stack_name}.json` in the working directory:

```typescript
function stFile(stack: string) {
    return resolve(process.cwd(), `pctl.${stack}.json`);
}
```

### Structure

Each key is `{stack}-{service}`. The value contains provider-specific metadata:

```json
{
  "my-app-api": {
    "provider": "docker",
    "host": "local",
    "image": "pctl-local:1710000000000",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "my-app",
      "pctl-service": "my-app-api"
    },
    "fingerprint": "sha256...",
    "replica": 2,
    "hasPorts": true,
    "pushedByPctl": true
  }
}
```

AWS and GCP entries include additional fields: `cluster`, `namespace`, `registryUrl`, `hasHpa`, `hasRbac`, `hasPvc`, `hasPv`, `hasPullSecret`. GCP also includes `project` and `zone`.

### Read/Write

```typescript
function stRead(stack: string): Record<string, any> {
    try { return JSON.parse(readFileSync(stFile(stack), 'utf-8')); }
    catch { return {}; }
}

function stWrite(stack: string, state: Record<string, any>) {
    writeFileSync(stFile(stack), JSON.stringify(state, null, 2));
}
```

State is written after each service deploy (incremental), providing crash resilience.

## Labels

All providers use the same label format:

```typescript
const lbl = (stack: string, name: string) => ({
    'managed-by': 'pctl',
    'pctl-stack': stack,
    'pctl-service': `${stack}-${name}`
});
```

| Label | Value |
|---|---|
| `managed-by` | Always `pctl` |
| `pctl-stack` | Stack name from config |
| `pctl-service` | `{stack}-{service}` |

On Kubernetes, applied as metadata labels. On Docker, applied as `--label` flags.

## Fingerprint

The fingerprint determines whether a service has changed since the last deploy:

```typescript
function fingerprint(service: Service, configDir: string): string {
    const { provider, ...rest } = service;          // Exclude provider config
    const hash = JSON.stringify(sortKeys(rest));     // Deterministic JSON
    if (service.image.startsWith('./')) {
        hash += md5(readFileSync(dockerfilePath));   // Include Dockerfile content
    }
    return sha256(hash);
}
```

- The `provider` field is excluded, so changing provider options (e.g. namespace) without changing the service itself does not trigger a rebuild.
- Dockerfile content is included in the hash, so editing the Dockerfile triggers a rebuild.
- If the fingerprint matches the state file, the service is skipped with `unchanged, skipping`.

## Orphan Removal

After deploying current services, providers check for orphans -- services present in the state file but absent from the current config:

```typescript
const removed = Object.keys(prev)
    .filter(k => prev[k].provider === 'aws' && !next[k] && !prev[k].destroyed);
```

Orphaned services are destroyed and removed from the state file. This handles service renames and removals.

## Destroy Lifecycle

On `destroy`, providers iterate all entries in the state file with the matching provider name and `destroyed !== true`:

1. Remove all resources for each service.
2. Wait for termination (pods, containers).
3. Clean up namespace/volumes/images.
4. Mark entries as `destroyed: true` in the state file.

The state file is preserved with `destroyed: true` flags rather than deleted.
