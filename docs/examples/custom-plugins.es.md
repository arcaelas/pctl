# Plugins Personalizados

## Ejemplo 1: Plugin que loguea todos los valores resueltos

Registra el estado completo de cada servicio despues de que los resolvers procesaron el YAML.

### plugins/logger.js

```javascript
module.exports = async function logger(parsed) {
    console.log(`\n[logger] Stack: ${parsed.name}`);
    console.log(`[logger] Services: ${Object.keys(parsed.services).join(', ')}`);

    for (const [name, service] of Object.entries(parsed.services)) {
        console.log(`\n[logger] --- ${name} ---`);
        console.log(`[logger]   image: ${service.image}`);
        console.log(`[logger]   provider: ${service.provider.name}`);
        console.log(`[logger]   replica: ${JSON.stringify(service.scale.replica)}`);

        if (service.env) {
            for (const [key, value] of Object.entries(service.env)) {
                // Enmascara valores que parecen secretos
                const masked = key.match(/SECRET|PASSWORD|TOKEN|KEY/i)
                    ? value.slice(0, 4) + '****'
                    : value;
                console.log(`[logger]   env.${key}: ${masked}`);
            }
        }

        if (service.ports) console.log(`[logger]   ports: ${service.ports.join(', ')}`);
        if (service.health) console.log(`[logger]   health: ${service.health.command} (every ${service.health.interval}s)`);
    }

    console.log('');
};
```

### Salida

```
[logger] Stack: my-app
[logger] Services: api, worker

[logger] --- api ---
[logger]   image: ./Dockerfile
[logger]   provider: aws
[logger]   replica: [2,10]
[logger]   env.NODE_ENV: production
[logger]   env.DATABASE_URL: post****
[logger]   env.JWT_SECRET: s3cr****
[logger]   ports: 3000
[logger]   health: curl -f http://localhost:3000/health (every 30s)

[logger] --- worker ---
[logger]   image: ./Dockerfile
[logger]   provider: aws
[logger]   replica: 3
[logger]   env.NODE_ENV: production
[logger]   env.QUEUE_URL: https://sqs.us-east-1.amazonaws.com/...
```

---

## Ejemplo 2: Plugin que valida la existencia de variables de entorno

Verifica que variables criticas no esten vacias ni sean `null` antes de desplegar.

### plugins/require-env.js

```javascript
module.exports = async function requireEnv(parsed) {
    const required = {
        api: ['DATABASE_URL', 'JWT_SECRET'],
        worker: ['DATABASE_URL', 'QUEUE_URL'],
    };

    const errors = [];

    for (const [name, keys] of Object.entries(required)) {
        const service = parsed.services[name];
        if (!service) continue;

        for (const key of keys) {
            const value = service.env?.[key];
            if (value === undefined || value === null || value === '') {
                errors.push(`Service "${name}": env.${key} is empty or missing`);
            }
        }
    }

    if (errors.length) {
        throw new Error(`[require-env] Validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }

    console.log(`[require-env] All required env vars present`);
};
```

### Error de ejemplo

```
Error: [require-env] Validation failed:
  - Service "api": env.JWT_SECRET is empty or missing
  - Service "worker": env.QUEUE_URL is empty or missing
```

---

## Ejemplo 3: Plugin que agrega labels por defecto

Inyecta variables de entorno con metadata del despliegue a todos los servicios.

### plugins/default-labels.js

```javascript
module.exports = async function defaultLabels(parsed) {
    const metadata = {
        PCTL_STACK: parsed.name,
        PCTL_DEPLOY_TIME: new Date().toISOString(),
        PCTL_GIT_SHA: (() => {
            try {
                const { execSync } = require('child_process');
                return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
            } catch {
                return 'unknown';
            }
        })(),
    };

    for (const [name, service] of Object.entries(parsed.services)) {
        service.env = {
            ...metadata,
            PCTL_SERVICE: name,
            ...(service.env ?? {}),
        };
    }

    console.log(`[default-labels] Injected metadata (git: ${metadata.PCTL_GIT_SHA})`);
};
```

Resultado: cada contenedor tendra `PCTL_STACK`, `PCTL_DEPLOY_TIME`, `PCTL_GIT_SHA` y `PCTL_SERVICE` en sus variables de entorno. Las variables del usuario sobreescriben las del plugin porque se aplican despues en el spread.

---

## Ejemplo 4: Plugin que modifica el escalado por horario

Reduce las replicas durante la noche para ahorrar costos.

### plugins/time-scaler.js

```javascript
module.exports = async function timeScaler(parsed) {
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour < 6;
    const isWeekend = [0, 6].includes(new Date().getDay());

    for (const [name, service] of Object.entries(parsed.services)) {
        if (!Array.isArray(service.scale.replica)) continue;

        const [min, max] = service.scale.replica;

        if (isNight) {
            service.scale.replica = [Math.max(min, 1), Math.ceil(max / 3)];
            console.log(`[time-scaler] "${name}" night mode: [${service.scale.replica}]`);
        } else if (isWeekend) {
            service.scale.replica = [min, Math.ceil(max / 2)];
            console.log(`[time-scaler] "${name}" weekend mode: [${service.scale.replica}]`);
        }
    }

    if (!isNight && !isWeekend) {
        console.log(`[time-scaler] Business hours, no changes`);
    }
};
```

### Comportamiento

| Horario | Replica original | Replica ajustada |
|---|---|---|
| Dia laboral | `[2, 10]` | `[2, 10]` (sin cambio) |
| Noche (22-06) | `[2, 10]` | `[2, 4]` (max / 3) |
| Fin de semana | `[2, 10]` | `[2, 5]` (max / 2) |

Solo afecta servicios con auto-scaling (replica como tupla). Los servicios con replicas fijas no se modifican.

---

## YAML completo con todos los plugins

```yaml
name: my-app

plugin:
  - ./plugins/default-labels.js
  - ./plugins/require-env.js
  - ./plugins/time-scaler.js
  - ./plugins/logger.js

custom:
  cluster: prod-eks
  namespace: app
  ecr: 507738123456.dkr.ecr.us-east-1.amazonaws.com

services:
  api:
    image: ./services/api/Dockerfile
    registry: ${self:custom.ecr}/api
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/myapp/db-url}
      JWT_SECRET: ${ssm:/myapp/jwt-secret}
    scale:
      replica: [2, 10]
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    health:
      interval: 30
      command: "curl -f http://localhost:3000/health"
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}

  worker:
    image: ./services/worker/Dockerfile
    registry: ${self:custom.ecr}/worker
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/myapp/db-url}
      QUEUE_URL: ${ssm:/myapp/queue-url}
    scale:
      replica: 3
      cpu: 512m
      memory: 1Gi
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}
```

### Orden de ejecucion

1. **resolve** - Resuelve `${self:...}`, `${ssm:...}`, `${env:...}`
2. **validate** - Verifica el schema Zod
3. **default-labels** - Inyecta `PCTL_STACK`, `PCTL_DEPLOY_TIME`, `PCTL_GIT_SHA`, `PCTL_SERVICE`
4. **require-env** - Verifica que `DATABASE_URL` y `JWT_SECRET` existan en `api`, y `DATABASE_URL` y `QUEUE_URL` en `worker`
5. **time-scaler** - Ajusta replicas de `api` si es noche o fin de semana
6. **logger** - Imprime todo el estado resuelto y modificado
7. **aws** - Despliega `api` y `worker` a EKS
8. **docker** - No hace nada (no hay servicios Docker)
9. **gcp** - No hace nada (no hay servicios GCP)
