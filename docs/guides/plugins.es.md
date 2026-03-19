# Plugins

Los plugins son funciones del pipeline que reciben el objeto `parsed` y pueden leerlo o mutarlo. Se ejecutan en orden secuencial.

## Pipeline integrado

```
resolve → validate → ...plugins del usuario → aws → docker → gcp
```

1. **resolve** - Procesa todos los patrones `${name:key, fallback}` del YAML
2. **validate** - Valida el esquema Zod y reglas de negocio (ej. min <= max en replicas)
3. **plugins del usuario** - Los que defines en el array `plugin` del YAML, en orden
4. **aws** - Proveedor AWS EKS (deploy/destroy)
5. **docker** - Proveedor Docker (deploy/destroy)
6. **gcp** - Proveedor GCP GKE (deploy/destroy)

## Escribir un plugin

Un plugin es una funcion asincrona que recibe `parsed`:

```javascript
// plugins/logger.js
module.exports = async function logger(parsed) {
    console.log(`[logger] Stack: ${parsed.name}`);
    console.log(`[logger] Services: ${Object.keys(parsed.services).join(', ')}`);
    for (const [name, service] of Object.entries(parsed.services)) {
        console.log(`[logger]   ${name}: image=${service.image}, replica=${service.scale.replica}`);
    }
};
```

O como export default:

```javascript
// plugins/logger.js
module.exports.default = async function logger(parsed) {
    console.log(`[logger] Stack: ${parsed.name}`);
};
```

## Registrar plugins

```yaml
plugin:
  - ./plugins/logger.js
  - ./plugins/env-override.js
```

Los plugins se cargan con `require()`. pctl busca primero `module.default`, luego el modulo directo. Si ninguno es una funcion, se omite.

## Mutar parsed

Los plugins pueden modificar el objeto `parsed` directamente. Los cambios persisten para los siguientes plugins y proveedores:

```javascript
// plugins/env-override.js
module.exports = async function envOverride(parsed) {
    for (const [name, service] of Object.entries(parsed.services)) {
        service.env = service.env ?? {};
        service.env.STACK_NAME = parsed.name;
        service.env.SERVICE_NAME = name;
        service.env.DEPLOYED_AT = new Date().toISOString();
    }
};
```

## Ejemplos

### Plugin de logging

Registra el estado completo despues de la resolucion:

```javascript
// plugins/audit-log.js
const { writeFileSync } = require('fs');

module.exports = async function auditLog(parsed) {
    const log = {
        timestamp: new Date().toISOString(),
        stack: parsed.name,
        services: Object.entries(parsed.services).map(([name, s]) => ({
            name,
            image: s.image,
            provider: s.provider.name,
            replica: s.scale.replica,
            env: Object.keys(s.env ?? {}),
        })),
    };
    writeFileSync(`pctl-audit-${Date.now()}.json`, JSON.stringify(log, null, 2));
    console.log(`[audit] Log written`);
};
```

### Plugin de sobreescritura de entorno

Inyecta variables de entorno comunes a todos los servicios:

```javascript
// plugins/env-override.js
module.exports = async function envOverride(parsed) {
    const common = {
        STACK_NAME: parsed.name,
        DEPLOY_TIME: new Date().toISOString(),
        NODE_ENV: process.env.NODE_ENV ?? 'production',
    };
    for (const service of Object.values(parsed.services)) {
        service.env = { ...common, ...(service.env ?? {}) };
    }
};
```

### Plugin de validacion de variables

Verifica que ciertas variables de entorno existan antes de desplegar:

```javascript
// plugins/require-env.js
module.exports = async function requireEnv(parsed) {
    const required = ['DATABASE_URL', 'JWT_SECRET'];
    for (const [name, service] of Object.entries(parsed.services)) {
        for (const key of required) {
            if (service.env?.[key] === undefined || service.env[key] === null || service.env[key] === '') {
                throw new Error(`[require-env] Service "${name}" missing required env: ${key}`);
            }
        }
    }
};
```

### Plugin de escalado por horario

Ajusta las replicas segun la hora del dia:

```javascript
// plugins/time-scaler.js
module.exports = async function timeScaler(parsed) {
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour < 6;

    for (const [name, service] of Object.entries(parsed.services)) {
        if (!Array.isArray(service.scale.replica)) continue;
        const [min, max] = service.scale.replica;
        if (isNight) {
            service.scale.replica = [Math.max(min, 1), Math.ceil(max / 2)];
            console.log(`[time-scaler] "${name}" night mode: [${service.scale.replica}]`);
        }
    }
};
```

## YAML completo con plugins

```yaml
name: my-app

plugin:
  - ./plugins/env-override.js
  - ./plugins/require-env.js
  - ./plugins/audit-log.js

services:
  api:
    image: ./Dockerfile
    registry: ghcr.io/myorg/api
    env:
      DATABASE_URL: ${ssm:/myapp/db-url}
      JWT_SECRET: ${ssm:/myapp/jwt-secret}
    scale:
      replica: [2, 10]
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    provider:
      name: aws
      options:
        cluster: prod
        namespace: app
```
