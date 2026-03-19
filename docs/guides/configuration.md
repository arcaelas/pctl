# Configuration

The configuration file is a YAML document parsed and validated against a Zod schema.

## File Location

By default, pctl reads `./pctl.yaml`. Override with `-c`:

```bash
pctl deploy -c infra/production.yaml
```

## Top-Level Fields

```yaml
name: my-stack
resolver: []
plugin: []
custom: {}
services: {}
```

| Field | Type | Required | Default | Description |
|---|---|:---:|---|---|
| `name` | `string` | Yes | -- | Stack name. Prefix for all resource names and labels. |
| `resolver` | `string[]` | No | `[]` | Custom resolver module paths, loaded after built-in resolvers. |
| `plugin` | `string[]` | No | `[]` | Custom plugin module paths, executed between validate and providers. |
| `custom` | `Record<string, any>` | No | `{}` | Free-form key/value store. Accessible via `${self:custom.*}`. |
| `services` | `Record<string, Service>` | Yes | -- | Map of service names to their configuration. |

## Service Fields

Each key under `services` defines a service:

```yaml
services:
  api:
    image: ./Dockerfile
    registry: ghcr.io/myorg/api
    command: "node dist/main.js"
    env:
      NODE_ENV: production
      DB_HOST: "${ssm:/prod/db-host}"
    scale:
      replica: [2, 10]
      cpu: 256m
      memory: 512Mi
    ports:
      - "8080:3000"
    health:
      interval: 30
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    volumes:
      - path: /data
    provider:
      name: aws
      options:
        cluster: prod-cluster
        namespace: production
```

### image

```yaml
image: ./Dockerfile       # Build from Dockerfile
image: node:20-alpine     # Use pre-built image
image: ghcr.io/org/api    # Pull from registry
```

When the value starts with `./`, pctl runs `docker build`. Otherwise it uses the image as-is.

### registry

String form (URL only):

```yaml
registry: ghcr.io/myorg/api
```

Object form (URL with auth):

```yaml
registry:
  url: ghcr.io/myorg/api
  username: "${env:GHCR_USER}"
  password: "${env:GHCR_TOKEN}"
```

Optional. Not needed for local Docker deploys or pre-built images that the target can already pull.

### command

```yaml
command: "node dist/main.js"
```

Overrides the container CMD. Executed as `sh -c "<command>"`.

### env

```yaml
env:
  NODE_ENV: production
  DB_URL: "${ssm:/prod/db-url, postgresql://localhost:5432/db}"
```

Key/value environment variables. Supports resolver syntax.

### scale

```yaml
scale:
  replica: 3          # Fixed: 3 instances
  cpu: 256m            # CPU limit
  memory: 512Mi        # Memory limit
```

Auto-scaling with a tuple:

```yaml
scale:
  replica: [2, 10]     # Min 2, max 10 (creates HPA on Kubernetes)
  cpu: 500m
  memory: 1Gi
```

| Field | Type | Required | Description |
|---|---|:---:|---|
| `replica` | `number \| [min, max]` | Yes | Fixed count or auto-scale range. |
| `cpu` | `string` | No | CPU limit (e.g. `256m`, `1`). |
| `memory` | `string` | No | Memory limit (e.g. `512Mi`, `1Gi`). |

On Kubernetes providers, `[min, max]` creates a HorizontalPodAutoscaler targeting 80% CPU utilization. On Docker, `[min, max]` uses the `max` value as fixed replica count.

### ports

```yaml
ports:
  - 3000               # Container port 3000 -> host port 3000
  - "8080:3000"        # Host port 8080 -> container port 3000
```

Array of numbers or `"host:container"` strings. On Kubernetes, creates a Service resource. On Docker, maps to `-p` flags.

### health

```yaml
health:
  interval: 30
  command: "curl -f http://localhost:3000/health"
  retries: 3
  onfailure: restart
```

| Field | Type | Required | Default | Description |
|---|---|:---:|---|---|
| `interval` | `number` | Yes | -- | Seconds between health checks. |
| `command` | `string` | Yes | -- | Command executed inside the container. Non-zero exit = unhealthy. |
| `retries` | `number` | No | `3` | Consecutive failures before triggering `onfailure`. |
| `onfailure` | `"restart" \| "stop"` | No | `"restart"` | Action on failure. |

On Kubernetes:

- `onfailure: restart` maps to a **livenessProbe** (kubelet restarts the pod).
- `onfailure: stop` maps to a **readinessProbe** (pod stops receiving traffic).

On Docker:

- `onfailure: restart` sets `--restart unless-stopped`.
- `onfailure: stop` sets `--restart no`.

### volumes

```yaml
volumes:
  - path: /data
  - path: /uploads
```

Mount points inside the container. The actual storage backend depends on the provider's `options.storage` setting.

Without `storage` in provider options, volumes use `emptyDir` (Kubernetes) or Docker volumes (Docker).

### provider

```yaml
provider:
  name: aws
  options:
    cluster: my-cluster
    namespace: production
    strategy: RollingUpdate
    serviceAccount: api-sa
    rbac:
      - resources: ["pods", "services"]
        verbs: ["get", "list"]
    storage:
      size: 20Gi
```

| Field | Type | Required | Description |
|---|---|:---:|---|
| `name` | `string` | Yes | Provider identifier: `aws`, `gcp`, or `docker`. |
| `options` | `Record<string, any>` | No | Provider-specific configuration. See provider docs. |

## Custom Block and Self-References

The `custom` block stores reusable values accessible via `${self:custom.*}`:

```yaml
name: my-stack

custom:
  region: us-east-1
  cluster: prod-cluster
  namespace: production
  db_host: "${ssm:/prod/db-host}"

services:
  api:
    image: ./Dockerfile
    registry: "507738123456.dkr.ecr.${self:custom.region}.amazonaws.com/api"
    env:
      DB_HOST: "${self:custom.db_host}"
    scale:
      replica: [2, 10]
      cpu: 256m
      memory: 512Mi
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
        namespace: "${self:custom.namespace}"

  worker:
    image: ./worker/Dockerfile
    registry: "507738123456.dkr.ecr.${self:custom.region}.amazonaws.com/worker"
    env:
      DB_HOST: "${self:custom.db_host}"
    scale:
      replica: 3
      cpu: 512m
      memory: 1Gi
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
        namespace: "${self:custom.namespace}"
```

## Complete Example

```yaml
name: acme

resolver:
  - ./resolvers/vault.js

plugin:
  - ./plugins/audit-log.js

custom:
  region: us-east-1
  cluster: acme-prod
  ns: production
  ecr_base: "507738123456.dkr.ecr.us-east-1.amazonaws.com"

services:
  api:
    image: ./services/api/Dockerfile
    registry: "${self:custom.ecr_base}/api"
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      PORT: "3000"
      DB_URL: "${ssm:/acme/prod/db-url}"
      REDIS_URL: "${ssm:/acme/prod/redis-url}"
    scale:
      replica: [2, 20]
      cpu: 500m
      memory: 1Gi
    ports:
      - "8080:3000"
    health:
      interval: 15
      command: "curl -sf http://localhost:3000/health"
      retries: 5
      onfailure: restart
    volumes:
      - path: /app/uploads
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
        namespace: "${self:custom.ns}"
        strategy: RollingUpdate
        serviceAccount: api-sa
        rbac:
          - resources: ["secrets"]
            verbs: ["get"]
        storage:
          size: 50Gi

  worker:
    image: ./services/worker/Dockerfile
    registry: "${self:custom.ecr_base}/worker"
    env:
      QUEUE_URL: "${ssm:/acme/prod/queue-url}"
    scale:
      replica: 5
      cpu: 1
      memory: 2Gi
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
        namespace: "${self:custom.ns}"

  monitor:
    image: grafana/grafana:latest
    scale:
      replica: 1
    ports:
      - "3001:3000"
    provider:
      name: docker
```
