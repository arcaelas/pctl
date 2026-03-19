# Plugins

Plugins are pipeline functions that receive the parsed configuration object and can read, validate, or mutate it before providers execute.

## Pipeline Order

```
resolve -> validate -> [user plugins] -> aws -> docker -> gcp
```

1. **resolve** -- Replaces all `${name:key}` expressions with real values.
2. **validate** -- Validates the resolved config against the Zod schema.
3. **User plugins** -- Your custom plugins from the `plugin` array, in order.
4. **aws / docker / gcp** -- Built-in providers that deploy/destroy services.

Each step receives the same `parsed` object. Mutations propagate downstream.

## Writing a Plugin

A plugin is an async function that receives the parsed config:

```javascript
// plugins/logger.js
module.exports = async function logger(parsed) {
    console.log(`[logger] Stack: ${parsed.name}`);
    for (const [name, service] of Object.entries(parsed.services)) {
        console.log(`[logger] Service "${name}": image=${service.image}, replicas=${service.scale.replica}`);
        if (service.env) {
            for (const [k, v] of Object.entries(service.env)) {
                console.log(`[logger]   ${k}=${v}`);
            }
        }
    }
};
```

Or as a default export:

```javascript
// plugins/logger.js
export default async function logger(parsed) {
    // ...
};
```

Both `module.exports` and `export default` are supported. pctl resolves the handler from either format.

## Registration

Add the module path to the `plugin` array:

```yaml
plugin:
  - ./plugins/logger.js
  - ./plugins/env-check.js

services:
  api:
    image: ./Dockerfile
    env:
      NODE_ENV: production
    scale:
      replica: 1
    provider:
      name: docker
```

Plugins execute in array order.

## Mutating the Config

Plugins can modify `parsed` directly. Changes affect all downstream plugins and providers:

```javascript
// plugins/env-override.js
module.exports = async function envOverride(parsed) {
    const stage = process.env.PCTL_STAGE || 'development';
    for (const [name, service] of Object.entries(parsed.services)) {
        service.env = service.env || {};
        service.env.STAGE = stage;
        service.env.SERVICE_NAME = name;
    }
};
```

## Plugin Examples

### Validate Required Environment Variables

```javascript
// plugins/require-env.js
module.exports = async function requireEnv(parsed) {
    const required = ['NODE_ENV', 'DB_URL'];
    for (const [name, service] of Object.entries(parsed.services)) {
        for (const key of required) {
            if (!service.env?.[key]) {
                throw new Error(`Service "${name}" missing required env var: ${key}`);
            }
        }
    }
};
```

### Add Default Labels to Custom Block

```javascript
// plugins/defaults.js
module.exports = async function defaults(parsed) {
    parsed.custom.deployed_at = new Date().toISOString();
    parsed.custom.deployed_by = process.env.USER || 'unknown';
};
```

### Scale Based on Time of Day

```javascript
// plugins/time-scale.js
module.exports = async function timeScale(parsed) {
    const hour = new Date().getHours();
    const isOffHours = hour < 8 || hour > 20;

    for (const service of Object.values(parsed.services)) {
        if (Array.isArray(service.scale.replica) && isOffHours) {
            // Scale down during off-hours: set min to 1
            service.scale.replica = [1, service.scale.replica[1]];
        }
    }
};
```
