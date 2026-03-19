# AWS Provider (EKS)

Deploys services to an Amazon EKS Kubernetes cluster.

## Requirements

- AWS credentials (CLI config, environment variables, or explicit in `options.credentials`)
- An existing EKS cluster
- Docker installed locally (for building images)
- ECR repository or external registry (for Dockerfile builds)

## Options

```yaml
provider:
  name: aws
  options:
    credentials:             # Optional. Falls back to env/CLI config.
      region: us-east-1
      access_key_id: AKIA...
      secret_access_key: wJal...
      session_token: FwoG...  # Optional (STS temporary credentials)
    cluster: my-cluster      # Required. EKS cluster name.
    namespace: production    # Required. Kubernetes namespace.
    strategy: RollingUpdate  # Optional. Deployment strategy.
    serviceAccount: api-sa   # Optional. Custom ServiceAccount name.
    rbac:                    # Optional. Creates SA + Role + RoleBinding.
      - resources: ["pods", "services"]
        verbs: ["get", "list", "watch"]
      - resources: ["secrets"]
        verbs: ["get"]
    storage:                 # Optional. Persistent storage config.
      size: 20Gi             # EBS: provision by size.
```

### Options Reference

| Option | Type | Required | Description |
|---|---|:---:|---|
| `credentials` | `object` | No | AWS credentials. Falls back to `AWS_*` environment variables or AWS CLI config. |
| `credentials.region` | `string` | -- | AWS region. Falls back to `AWS_REGION`. |
| `credentials.access_key_id` | `string` | -- | Access key ID. |
| `credentials.secret_access_key` | `string` | -- | Secret access key. |
| `credentials.session_token` | `string` | -- | Session token for temporary credentials. |
| `cluster` | `string` | Yes | EKS cluster name. |
| `namespace` | `string` | Yes | Kubernetes namespace. Created automatically if it does not exist. |
| `strategy` | `string` | No | Deployment strategy type (e.g. `RollingUpdate`, `Recreate`). |
| `serviceAccount` | `string` | No | Custom ServiceAccount name. Defaults to `{stack}-{service}`. |
| `rbac` | `array` | No | RBAC rules. Creates ServiceAccount, Role, and RoleBinding. |
| `storage` | `object` | No | Persistent storage. See Storage section. |

## What It Creates

For each service, the AWS provider creates or updates:

| Resource | Condition |
|---|---|
| Namespace | Always (idempotent) |
| Deployment | Always |
| Service (K8s) | When `ports` is defined |
| HorizontalPodAutoscaler | When `scale.replica` is `[min, max]` |
| PersistentVolume | When `storage` uses EFS |
| PersistentVolumeClaim | When `storage` is defined |
| ServiceAccount + Role + RoleBinding | When `rbac` is defined |
| Secret (imagePullSecret) | When registry has auth and is not ECR |

## Credentials

pctl resolves AWS credentials in this order:

1. Explicit `options.credentials` in the config.
2. Environment variables (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`).
3. AWS CLI default profile.

For EKS authentication, pctl generates a presigned STS `GetCallerIdentity` URL as a Kubernetes bearer token (same mechanism as `aws eks get-token`).

## Registry and Image Handling

### ECR (auto-auth)

When the registry URL contains `.dkr.ecr.`, pctl automatically authenticates via `GetAuthorizationToken`:

```yaml
image: ./Dockerfile
registry: 507738123456.dkr.ecr.us-east-1.amazonaws.com/api
```

No username/password needed. The ECR credentials use the same AWS credentials as the provider.

### External Registry (imagePullSecret)

For non-ECR registries with authentication, pctl creates a Kubernetes `dockerconfigjson` Secret:

```yaml
image: ./Dockerfile
registry:
  url: ghcr.io/myorg/api
  username: "${env:GHCR_USER}"
  password: "${env:GHCR_TOKEN}"
```

The Deployment spec automatically references the imagePullSecret.

### Pre-built Image

No build or push. The image is pulled directly by the cluster:

```yaml
image: nginx:latest
```

## Storage

### EBS (block storage)

Provision by size. Uses `gp2` StorageClass with `ReadWriteOnce` access mode:

```yaml
volumes:
  - path: /data

provider:
  name: aws
  options:
    cluster: prod
    namespace: production
    storage:
      size: 50Gi
```

### EFS (shared filesystem)

Provision by EFS file system ID. Uses the EFS CSI driver with `ReadWriteMany` access mode:

```yaml
volumes:
  - path: /shared

provider:
  name: aws
  options:
    cluster: prod
    namespace: production
    storage:
      name: efs
      id: fs-0123456789abcdef0
```

Creates a PersistentVolume, a StorageClass (`efs-sc`), and a PersistentVolumeClaim.

### Ephemeral (no storage config)

Without `storage` in options, volumes mount as `emptyDir`:

```yaml
volumes:
  - path: /tmp/cache
```

Data is lost when the pod restarts.

## Health Checks

```yaml
health:
  interval: 30
  command: "curl -f http://localhost:3000/health"
  retries: 5
  onfailure: restart
```

- `onfailure: restart` creates a **livenessProbe**. The kubelet restarts the container on failure.
- `onfailure: stop` creates a **readinessProbe**. The pod stops receiving traffic but is not restarted.

Both use `exec` with `sh -c "<command>"`.

## RBAC

When `rbac` is defined, the provider creates:

1. **ServiceAccount** named `serviceAccount` (or `{stack}-{service}` by default).
2. **Role** with the specified rules.
3. **RoleBinding** linking the ServiceAccount to the Role.

```yaml
provider:
  name: aws
  options:
    cluster: prod
    namespace: production
    serviceAccount: api-sa
    rbac:
      - resources: ["pods"]
        verbs: ["get", "list", "watch"]
      - resources: ["secrets"]
        verbs: ["get"]
```

## Full Example

```yaml
name: acme

custom:
  region: us-east-1
  ecr: "507738123456.dkr.ecr.us-east-1.amazonaws.com"

services:
  api:
    image: ./services/api/Dockerfile
    registry: "${self:custom.ecr}/api"
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      DB_URL: "${ssm:/acme/prod/db-url}"
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
        cluster: acme-prod
        namespace: production
        strategy: RollingUpdate
        serviceAccount: api-sa
        rbac:
          - resources: ["secrets"]
            verbs: ["get"]
        storage:
          size: 50Gi

  worker:
    image: ./services/worker/Dockerfile
    registry: "${self:custom.ecr}/worker"
    env:
      QUEUE_URL: "${ssm:/acme/prod/queue-url}"
    scale:
      replica: 5
      cpu: 1
      memory: 2Gi
    provider:
      name: aws
      options:
        cluster: acme-prod
        namespace: production
        storage:
          name: efs
          id: fs-0abc123def456789
```

## Destroy Behavior

`pctl destroy` performs:

1. Deletes HPA (if exists).
2. Deletes Deployment.
3. Deletes Service (if ports were exposed).
4. Deletes imagePullSecret (if exists).
5. Deletes RBAC resources: RoleBinding, Role, ServiceAccount (if exists).
6. Deletes PVC and PV (if storage was provisioned).
7. For ECR images built by pctl, deletes the image tags from the ECR repository.
8. Waits up to 60 seconds for pods to terminate.
9. Cleans up empty namespaces (waits up to 30 seconds).
10. Removes the `efs-sc` StorageClass if it was created.
11. Marks entries as `destroyed: true` in the state file.
