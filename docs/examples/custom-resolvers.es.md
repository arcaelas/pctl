# Resolvers Personalizados

## Ejemplo 1: Resolver que lee de un archivo JSON

Un resolver que carga un archivo JSON local y resuelve claves con notacion de punto.

### resolvers/json-file.js

```javascript
const { readFileSync } = require('fs');
const { resolve } = require('path');

module.exports = class JsonFile extends Function {
    constructor(_parsed) {
        super();
        const cache = new Map();

        function loadFile(file) {
            if (cache.has(file)) return cache.get(file);
            try {
                const data = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf-8'));
                cache.set(file, data);
                return data;
            } catch {
                cache.set(file, null);
                return null;
            }
        }

        return function jsonfile(key, fallback) {
            // key format: "file.json:path.to.value"
            const sep = key.indexOf(':');
            if (sep === -1) return fallback ?? null;
            const file = key.slice(0, sep);
            const path = key.slice(sep + 1);

            const data = loadFile(file);
            if (!data) return fallback ?? null;

            let value = data;
            for (const part of path.split('.')) {
                value = value?.[part];
                if (value === undefined) return fallback ?? null;
            }
            return value ?? fallback ?? null;
        };
    }
};
```

### secrets.json

```json
{
  "database": {
    "url": "postgres://user:pass@db.example.com:5432/myapp",
    "pool_size": "10"
  },
  "redis": {
    "url": "redis://cache.example.com:6379"
  }
}
```

### pctl.yaml

```yaml
name: my-app

resolver:
  - ./resolvers/json-file.js

services:
  api:
    image: node:20-alpine
    command: "node server.js"
    env:
      DATABASE_URL: ${jsonfile:secrets.json:database.url}
      DB_POOL_SIZE: ${jsonfile:secrets.json:database.pool_size, 5}
      REDIS_URL: ${jsonfile:secrets.json:redis.url}
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

Despues de la resolucion, las variables tendran:

- `DATABASE_URL` = `postgres://user:pass@db.example.com:5432/myapp`
- `DB_POOL_SIZE` = `10`
- `REDIS_URL` = `redis://cache.example.com:6379`

---

## Ejemplo 2: Resolver que consulta una API HTTP

Un resolver que hace peticiones HTTP para obtener valores de configuracion de un servicio externo.

### resolvers/http.js

```javascript
const https = require('https');
const http = require('http');

module.exports = class Http extends Function {
    constructor(_parsed) {
        super();
        const cache = new Map();

        function fetch(url) {
            return new Promise((resolve, reject) => {
                const client = url.startsWith('https') ? https : http;
                client.get(url, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve(data); }
                    });
                }).on('error', reject);
            });
        }

        return function httpresolver(key, fallback) {
            if (cache.has(key)) return cache.get(key) ?? fallback ?? null;
            return fetch(key)
                .then(data => {
                    const value = typeof data === 'object' ? JSON.stringify(data) : String(data);
                    cache.set(key, value);
                    return value;
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
  - ./resolvers/http.js

services:
  api:
    image: node:20-alpine
    env:
      CONFIG: ${httpresolver:https://config.example.com/api/v1/myapp, {}}
      VERSION: ${httpresolver:https://config.example.com/api/v1/version, 1.0.0}
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

El resolver:

1. Hace GET a la URL proporcionada como clave
2. Parsea la respuesta como JSON si es posible, si no usa el string crudo
3. Cachea el resultado para evitar multiples llamadas con la misma URL
4. Si falla la peticion, retorna el fallback

---

## Registro en YAML

Ambos resolvers se registran en el array `resolver`:

```yaml
resolver:
  - ./resolvers/json-file.js
  - ./resolvers/http.js
```

Se cargan en orden despues de los resolvers integrados (env, ssm, self, cfn). El nombre de la funcion retornada en el constructor determina la sintaxis:

- `function jsonfile(...)` → `${jsonfile:...}`
- `function httpresolver(...)` → `${httpresolver:...}`

Si intentas registrar un resolver con un nombre que ya existe (ej. `function env(...)`), pctl lanza:

```
Error: Resolver "env" already registered
```
