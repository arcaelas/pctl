# Multi-Provider Example

A single configuration deploying services to both AWS EKS and Docker via SSH. Shared credentials and configuration are centralized in the `custom` block using `${self:custom.*}` references.

## pctl.yaml

```yaml
name: acme

custom:
  region: us-east-1
  cluster: acme-prod
  namespace: production
  ecr_base: "507738123456.dkr.ecr.us-east-1.amazonaws.com"
  ghcr_base: "ghcr.io/acme-org"
  ghcr_user: "${env:GHCR_USER}"
  ghcr_token: "${env:GHCR_TOKEN}"
  db_url: "${ssm:/acme/prod/db-url}"

services:
  # --- AWS EKS services ---
  api:
    image: ./services/api/Dockerfile
    registry: "${self:custom.ecr_base}/api"
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      PORT: "3000"
      DB_URL: "${self:custom.db_url}"
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
        namespace: "${self:custom.namespace}"
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
      DB_URL: "${self:custom.db_url}"
      QUEUE_URL: "${ssm:/acme/prod/queue-url}"
    scale:
      replica: 5
      cpu: 1
      memory: 2Gi
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
        namespace: "${self:custom.namespace}"

  # --- Docker SSH services ---
  monitor:
    image: ./services/monitor/Dockerfile
    registry:
      url: "${self:custom.ghcr_base}/monitor"
      username: "${self:custom.ghcr_user}"
      password: "${self:custom.ghcr_token}"
    env:
      GRAFANA_ADMIN_PASS: "${env:GRAFANA_PASS, admin}"
    scale:
      replica: 1
      cpu: 256m
      memory: 512Mi
    ports:
      - "3001:3000"
    provider:
      name: docker
      options:
        host: 10.0.1.50
        user: deploy
        key: ~/.ssh/deploy_key
        sudo: true

  redis:
    image: redis:7-alpine
    scale:
      replica: 1
    ports:
      - "6379:6379"
    volumes:
      - path: /data
    health:
      interval: 5
      command: "redis-cli ping"
      retries: 3
      onfailure: restart
    provider:
      name: docker
```

## Explanation

### Shared Configuration

The `custom` block centralizes repeated values:

- `ecr_base` is reused by both AWS services for their registry.
- `ghcr_base`, `ghcr_user`, `ghcr_token` are reused by the Docker SSH service.
- `db_url` is resolved once from SSM and referenced by multiple services.
- `cluster` and `namespace` are shared across AWS services.

### Different Registries Per Provider

- **AWS services** use ECR (`507738...ecr...`). ECR auto-authenticates using AWS credentials.
- **Docker SSH service** uses GHCR (`ghcr.io/acme-org/monitor`) with explicit username/password from environment variables.
- **Redis** uses a pre-built image, no registry needed.

### Provider Mix

`api` and `worker` deploy to an EKS cluster. `monitor` deploys to a remote server via SSH. `redis` runs locally. All share the same state file (`pctl.acme.json`).

## Deploy

```bash
export GHCR_USER=myuser
export GHCR_TOKEN=ghp_xxxxx
export GRAFANA_PASS=secret123

pctl deploy
```

Output:

```
[aws] deployed "acme-api"
[aws] deployed "acme-worker"
[docker] started "acme-monitor"
[docker] deployed "acme-monitor" (1 replica)
[docker] started "acme-redis"
[docker] deployed "acme-redis" (1 replica)
```

## State File (pctl.acme.json)

```json
{
  "acme-api": {
    "provider": "aws",
    "cluster": "acme-prod",
    "namespace": "production",
    "registryUrl": "507738123456.dkr.ecr.us-east-1.amazonaws.com/api",
    "image": "507738123456.dkr.ecr.us-east-1.amazonaws.com/api:1710000001",
    "labels": { "managed-by": "pctl", "pctl-stack": "acme", "pctl-service": "acme-api" },
    "fingerprint": "a1b2c3...",
    "hasPorts": true,
    "hasHpa": true,
    "hasRbac": true,
    "hasPvc": true,
    "hasPv": false,
    "hasPullSecret": false,
    "pushedByPctl": true
  },
  "acme-worker": {
    "provider": "aws",
    "cluster": "acme-prod",
    "namespace": "production",
    "registryUrl": "507738123456.dkr.ecr.us-east-1.amazonaws.com/worker",
    "image": "507738123456.dkr.ecr.us-east-1.amazonaws.com/worker:1710000002",
    "labels": { "managed-by": "pctl", "pctl-stack": "acme", "pctl-service": "acme-worker" },
    "fingerprint": "d4e5f6...",
    "hasPorts": false,
    "hasHpa": false,
    "hasRbac": false,
    "hasPvc": false,
    "hasPv": false,
    "hasPullSecret": false,
    "pushedByPctl": true
  },
  "acme-monitor": {
    "provider": "docker",
    "host": "10.0.1.50",
    "user": "deploy",
    "key": "~/.ssh/deploy_key",
    "sudo": true,
    "registryUrl": "ghcr.io/acme-org/monitor",
    "image": "ghcr.io/acme-org/monitor:1710000003",
    "labels": { "managed-by": "pctl", "pctl-stack": "acme", "pctl-service": "acme-monitor" },
    "fingerprint": "g7h8i9...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": true
  },
  "acme-redis": {
    "provider": "docker",
    "host": "local",
    "image": "redis:7-alpine",
    "labels": { "managed-by": "pctl", "pctl-stack": "acme", "pctl-service": "acme-redis" },
    "fingerprint": "j0k1l2...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```

## Destroy

```bash
pctl destroy
```

```
[aws] destroyed "acme-api"
[aws] destroyed "acme-worker"
[aws] namespace "production" removed
[docker] destroyed "acme-monitor"
[docker] destroyed "acme-redis"
```

AWS resources (deployments, services, HPA, PVC, RBAC, namespace) are cleaned up via Kubernetes API. Docker containers and volumes are removed locally and via SSH.
