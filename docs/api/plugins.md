# Plugins API

## Plugin Interface

A plugin is an async function that receives the parsed configuration object:

```typescript
async function myPlugin(parsed: z.infer<typeof Schema>): Promise<void> {
    // Read or mutate parsed
}
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `parsed` | `z.infer<typeof Schema>` | The full parsed config after resolver processing and schema validation. |

### Return Value

`void`. Plugins modify `parsed` in place. Any thrown error stops the pipeline and exits with code 1.

## Loading

Plugins are specified as module paths in the `plugin` array:

```yaml
plugin:
  - ./plugins/logger.js
  - ./plugins/defaults.js
```

Each path is passed to `require()`. The handler is resolved as:

1. If the module is a function, use it directly.
2. If the module has a `default` export that is a function, use that.
3. Otherwise, skip.

This supports both CommonJS and ES module default exports:

```javascript
// CommonJS
module.exports = async function logger(parsed) { /* ... */ };

// ES module (compiled)
export default async function logger(parsed) { /* ... */ };
```

## Pipeline Order

```
resolve -> validate -> plugin[0] -> plugin[1] -> ... -> aws -> docker -> gcp
```

Plugins run after validation but before providers. This means:

- All `${...}` expressions are already resolved.
- The config has been validated against the Zod schema.
- Plugins can safely mutate `parsed` knowing it is structurally valid.
- Provider functions see the mutated config.

## Mutating Parsed

Plugins receive the same object reference. Mutations propagate:

```javascript
module.exports = async function addEnv(parsed) {
    for (const service of Object.values(parsed.services)) {
        service.env = service.env || {};
        service.env.DEPLOYED_AT = new Date().toISOString();
    }
};
```

The aws/docker/gcp providers will see the added `DEPLOYED_AT` env var.

## Error Handling

Throw to abort the pipeline:

```javascript
module.exports = async function requirePorts(parsed) {
    for (const [name, service] of Object.entries(parsed.services)) {
        if (!service.ports?.length) {
            throw new Error(`Plugin requirePorts: service "${name}" has no ports defined`);
        }
    }
};
```

Output:

```
Plugin requirePorts: service "worker" has no ports defined
```

Process exits with code 1.

## Built-in Plugins

### resolve

The resolver plugin. Walks all string values and replaces `${name:key, fallback}` patterns. Runs first in the pipeline.

### validate

Runs `schema.safeParse(parsed)` after resolution. Also checks that `scale.replica` tuple has `min <= max`. Runs second.

## Parsed Object Shape

The `parsed` object available to plugins:

```typescript
{
    name: string;
    resolver: string[];
    plugin: string[];
    custom: Record<string, any>;
    services: Record<string, {
        image: string;
        registry?: string | { url: string; username?: string; password?: string };
        command?: string;
        env?: Record<string, string>;
        scale: {
            replica: number | [number, number];
            cpu?: string;
            memory?: string;
        };
        ports?: (number | string)[];
        health?: {
            interval: number;
            command: string;
            retries: number;
            onfailure: 'restart' | 'stop';
        };
        volumes?: { path: string }[];
        provider: {
            name: string;
            options: Record<string, any>;
        };
    }>;
}
```
