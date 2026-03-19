# Custom Plugins Examples

## Plugin 1: Log All Resolved Values

Prints every service's resolved environment variables and configuration after the resolve step.

### plugins/audit-log.js

```javascript
module.exports = async function auditLog(parsed) {
    console.log(`[audit] Stack: ${parsed.name}`);
    console.log(`[audit] Services: ${Object.keys(parsed.services).join(', ')}`);
    for (const [name, service] of Object.entries(parsed.services)) {
        console.log(`[audit] --- ${name} ---`);
        console.log(`[audit]   image: ${service.image}`);
        console.log(`[audit]   provider: ${service.provider.name}`);
        console.log(`[audit]   replica: ${JSON.stringify(service.scale.replica)}`);
        if (service.env) {
            for (const [k, v] of Object.entries(service.env)) {
                // Mask sensitive values
                const display = k.match(/SECRET|PASSWORD|TOKEN|KEY/i) ? '***' : v;
                console.log(`[audit]   env.${k}: ${display}`);
            }
        }
    }
};
```

### pctl.yaml

```yaml
plugin:
  - ./plugins/audit-log.js

name: my-app
services:
  api:
    image: ./Dockerfile
    env:
      NODE_ENV: production
      DB_PASSWORD: "${ssm:/prod/db-pass}"
    scale:
      replica: 1
    provider:
      name: docker
```

Output during deploy:

```
[audit] Stack: my-app
[audit] Services: api
[audit] --- api ---
[audit]   image: ./Dockerfile
[audit]   provider: docker
[audit]   replica: 1
[audit]   env.NODE_ENV: production
[audit]   env.DB_PASSWORD: ***
```

---

## Plugin 2: Validate Environment Variables Exist

Ensures critical env vars are present after resolution. Throws if any are null or empty.

### plugins/require-env.js

```javascript
const REQUIRED = {
    api: ['NODE_ENV', 'DB_URL', 'PORT'],
    worker: ['QUEUE_URL'],
};

module.exports = async function requireEnv(parsed) {
    for (const [name, service] of Object.entries(parsed.services)) {
        const required = REQUIRED[name];
        if (!required) continue;
        for (const key of required) {
            const value = service.env?.[key];
            if (!value || value === 'null') {
                throw new Error(`[require-env] Service "${name}" is missing required env var: ${key}`);
            }
        }
    }
};
```

### pctl.yaml

```yaml
plugin:
  - ./plugins/require-env.js

name: my-app
services:
  api:
    image: ./Dockerfile
    env:
      NODE_ENV: production
      DB_URL: "${ssm:/prod/db-url}"
      PORT: "3000"
    scale:
      replica: 1
    provider:
      name: docker

  worker:
    image: ./worker/Dockerfile
    env:
      QUEUE_URL: "${env:QUEUE_URL}"
    scale:
      replica: 1
    provider:
      name: docker
```

If `QUEUE_URL` is not set in the environment:

```
[require-env] Service "worker" is missing required env var: QUEUE_URL
```

---

## Plugin 3: Add Default Labels via Custom

Injects deployment metadata into the `custom` block for downstream use.

### plugins/deploy-meta.js

```javascript
module.exports = async function deployMeta(parsed) {
    parsed.custom.deployed_at = new Date().toISOString();
    parsed.custom.deployed_by = process.env.USER || 'ci';
    parsed.custom.git_sha = (() => {
        try {
            return require('child_process')
                .execSync('git rev-parse --short HEAD', { encoding: 'utf-8' })
                .trim();
        } catch {
            return 'unknown';
        }
    })();

    // Inject into every service's env
    for (const service of Object.values(parsed.services)) {
        service.env = service.env || {};
        service.env.DEPLOY_SHA = parsed.custom.git_sha;
        service.env.DEPLOY_TIME = parsed.custom.deployed_at;
    }
};
```

### pctl.yaml

```yaml
plugin:
  - ./plugins/deploy-meta.js

name: my-app
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

After the plugin runs, the API container receives:

```
NODE_ENV=production
DEPLOY_SHA=a1b2c3d
DEPLOY_TIME=2025-01-15T14:30:00.000Z
```

---

## Plugin 4: Scale Based on Time of Day

Adjusts auto-scaling ranges during off-hours to save resources.

### plugins/time-scale.js

```javascript
module.exports = async function timeScale(parsed) {
    const hour = new Date().getHours();
    const isOffHours = hour < 8 || hour > 20;

    if (!isOffHours) return;

    for (const [name, service] of Object.entries(parsed.services)) {
        if (!Array.isArray(service.scale.replica)) continue;

        const [min, max] = service.scale.replica;
        const newMin = Math.max(1, Math.floor(min / 2));
        const newMax = Math.max(2, Math.floor(max / 2));

        console.log(`[time-scale] "${name}": off-hours, scaling [${min},${max}] -> [${newMin},${newMax}]`);
        service.scale.replica = [newMin, newMax];
    }
};
```

### pctl.yaml

```yaml
plugin:
  - ./plugins/time-scale.js

name: my-app
services:
  api:
    image: ./Dockerfile
    scale:
      replica: [4, 40]
      cpu: 500m
      memory: 1Gi
    ports:
      - 3000
    provider:
      name: aws
      options:
        cluster: prod
        namespace: production

  worker:
    image: ./worker/Dockerfile
    scale:
      replica: 10
      cpu: 1
      memory: 2Gi
    provider:
      name: aws
      options:
        cluster: prod
        namespace: production
```

During off-hours (before 8 AM or after 8 PM):

```
[time-scale] "api": off-hours, scaling [4,40] -> [2,20]
```

The `worker` service has a fixed replica count (not an array), so it is not modified.
