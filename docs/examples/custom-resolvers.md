# Custom Resolvers Examples

## Example 1: JSON File Resolver

A resolver that reads values from a local JSON file using dot-notation keys.

### resolvers/json-file.js

```javascript
const { readFileSync } = require('fs');
const { resolve } = require('path');

module.exports = class JsonFile extends Function {
    constructor(parsed) {
        super();
        const filePath = parsed.custom?.secrets_file || './secrets.json';
        const data = JSON.parse(readFileSync(resolve(filePath), 'utf-8'));

        return function jsonfile(key, fallback) {
            const parts = key.split('.');
            let value = data;
            for (const p of parts) {
                value = value?.[p];
                if (value === undefined) return fallback ?? null;
            }
            return value;
        };
    }
};
```

### secrets.json

```json
{
  "database": {
    "host": "db.internal.local",
    "port": "5432",
    "password": "s3cret"
  },
  "redis": {
    "url": "redis://cache.internal.local:6379"
  }
}
```

### pctl.yaml

```yaml
name: my-app

resolver:
  - ./resolvers/json-file.js

custom:
  secrets_file: ./secrets.json

services:
  api:
    image: ./Dockerfile
    env:
      DB_HOST: "${jsonfile:database.host}"
      DB_PORT: "${jsonfile:database.port}"
      DB_PASS: "${jsonfile:database.password}"
      REDIS_URL: "${jsonfile:redis.url}"
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

After resolution, the env block becomes:

```yaml
env:
  DB_HOST: "db.internal.local"
  DB_PORT: "5432"
  DB_PASS: "s3cret"
  REDIS_URL: "redis://cache.internal.local:6379"
```

---

## Example 2: HTTP API Resolver

A resolver that fetches values from an HTTP config service.

### resolvers/http-config.js

```javascript
const https = require('https');

module.exports = class HttpConfig extends Function {
    constructor(parsed) {
        super();
        const baseUrl = parsed.custom?.config_api || 'https://config.internal.local';
        const cache = new Map();

        function fetch(url) {
            return new Promise((resolve, reject) => {
                https.get(url, res => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(data); }
                    });
                    res.on('error', reject);
                }).on('error', reject);
            });
        }

        return function httpconfig(key, fallback) {
            if (cache.has(key)) return cache.get(key) ?? fallback ?? null;
            return fetch(`${baseUrl}/config/${key}`)
                .then(data => {
                    const value = data?.value ?? null;
                    cache.set(key, value);
                    return value ?? fallback ?? null;
                })
                .catch(() => {
                    cache.set(key, null);
                    return fallback ?? null;
                });
        };
    }
};
```

### pctl.yaml

```yaml
name: my-app

resolver:
  - ./resolvers/http-config.js

custom:
  config_api: "https://config.internal.local"

services:
  api:
    image: ./Dockerfile
    env:
      DB_URL: "${httpconfig:prod/db-url}"
      API_KEY: "${httpconfig:prod/api-key, default-key}"
      FEATURE_FLAGS: "${httpconfig:prod/features, {}}"
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

The resolver calls `GET https://config.internal.local/config/prod/db-url` and expects a JSON response like `{"value": "postgresql://..."}`. Results are cached per key.

---

## Combining Custom Resolvers with Built-in

Custom resolvers work alongside built-in resolvers. You can nest them:

```yaml
resolver:
  - ./resolvers/json-file.js

custom:
  secrets_file: "${env:SECRETS_PATH, ./secrets.json}"

services:
  api:
    image: ./Dockerfile
    env:
      # env resolver runs first (innermost), then jsonfile
      DB_HOST: "${jsonfile:${env:DB_KEY, database.host}}"
      # SSM fallback to json file
      API_KEY: "${ssm:/prod/api-key, ${jsonfile:api.key, fallback-key}}"
    scale:
      replica: 1
    provider:
      name: docker
```
