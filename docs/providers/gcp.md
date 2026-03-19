# GCP Provider (GKE)

Deploys services to a Google Kubernetes Engine cluster.

## Requirements

- gcloud CLI authenticated (`gcloud auth login`)
- An existing GKE cluster
- Docker installed locally (for building images)
- Artifact Registry or external registry (for Dockerfile builds)

## Options

```yaml
provider:
  name: gcp
  options:
    project: my-gcp-project    # Required. GCP project ID.
    zone: us-central1-a        # Required. Cluster zone.
    cluster: my-cluster        # Required. GKE cluster name.
    namespace: production      # Required. Kubernetes namespace.
    strategy: RollingUpdate    # Optional. Deployment strategy.
    serviceAccount: api-sa     # Optional. Custom ServiceAccount name.
    rbac:                      # Optional. Creates SA + Role + RoleBinding.
      - resources: ["pods"]
        verbs: ["get", "list"]
    storage:                   # Optional. Persistent storage config.
      size: 20Gi               # Persistent Disk: provision by size.
```

### Options Reference

| Option | Type | Required | Description |
|---|---|:---:|---|
| `project` | `string` | Yes | GCP project ID. |
| `zone` | `string` | Yes | Cluster zone (e.g. `us-central1-a`). |
| `cluster` | `string` | Yes | GKE cluster name. |
| `namespace` | `string` | Yes | Kubernetes namespace. Created automatically if it does not exist. |
| `strategy` | `string` | No | Deployment strategy type (e.g. `RollingUpdate`, `Recreate`). |
| `serviceAccount` | `string` | No | Custom ServiceAccount name. Defaults to `{stack}-{service}`. |
| `rbac` | `array` | No | RBAC rules. Creates ServiceAccount, Role, and RoleBinding. |
| `storage` | `object` | No | Persistent storage. See Storage section. |

## Authentication

GCP authentication uses gcloud CLI. No explicit credentials are passed in the config. pctl runs:

```bash
gcloud container clusters get-credentials {cluster} --zone {zone} --project {project}
```

This configures `kubectl` with the cluster context. The current gcloud user must have GKE permissions.

## What It Creates

Same resources as the AWS provider:

| Resource | Condition |
|---|---|
| Namespace | Always (idempotent) |
| Deployment | Always |
| Service (K8s) | When `ports` is defined |
| HorizontalPodAutoscaler | When `scale.replica` is `[min, max]` |
| PersistentVolume | When `storage` uses Filestore |
| PersistentVolumeClaim | When `storage` is defined |
| ServiceAccount + Role + RoleBinding | When `rbac` is defined |
| Secret (imagePullSecret) | When registry has auth and is not Artifact Registry |

## Registry and Image Handling

### Artifact Registry (auto-auth)

When the registry URL contains `-docker.pkg.dev`, pctl authenticates automatically using a gcloud access token:

```yaml
image: ./Dockerfile
registry: us-central1-docker.pkg.dev/my-project/my-repo/api
```

No username/password needed. Auth runs `gcloud auth print-access-token` and logs in as `oauth2accesstoken`.

### External Registry (imagePullSecret)

For non-Artifact Registry registries with authentication:

```yaml
image: ./Dockerfile
registry:
  url: ghcr.io/myorg/api
  username: "${env:GHCR_USER}"
  password: "${env:GHCR_TOKEN}"
```

Creates a Kubernetes `dockerconfigjson` Secret.

### Pre-built Image

```yaml
image: nginx:latest
```

## Storage

### Persistent Disk (block storage)

Uses `standard-rw` StorageClass with `ReadWriteOnce`:

```yaml
volumes:
  - path: /data

provider:
  name: gcp
  options:
    project: my-project
    zone: us-central1-a
    cluster: prod
    namespace: production
    storage:
      size: 50Gi
```

### Filestore (NFS shared filesystem)

Uses NFS mount with `ReadWriteMany`:

```yaml
volumes:
  - path: /shared

provider:
  name: gcp
  options:
    project: my-project
    zone: us-central1-a
    cluster: prod
    namespace: production
    storage:
      name: filestore
      id: 10.0.1.5
```

The `id` is the Filestore instance IP address. Creates a PersistentVolume with NFS driver (server: `id`, path: `/vol1`), a StorageClass (`filestore-sc`), and a PersistentVolumeClaim.

### Ephemeral (no storage config)

Volumes mount as `emptyDir`. Data is lost on pod restart.

## Health Checks

Same behavior as the AWS provider:

- `onfailure: restart` creates a livenessProbe.
- `onfailure: stop` creates a readinessProbe.

## RBAC

Same structure as the AWS provider. Creates ServiceAccount, Role, and RoleBinding.

## Full Example

```yaml
name: acme

custom:
  project: acme-prod-123
  zone: us-central1-a
  cluster: acme-gke
  ar: "us-central1-docker.pkg.dev/acme-prod-123/acme-repo"

services:
  api:
    image: ./services/api/Dockerfile
    registry: "${self:custom.ar}/api"
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
      name: gcp
      options:
        project: "${self:custom.project}"
        zone: "${self:custom.zone}"
        cluster: "${self:custom.cluster}"
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
    registry: "${self:custom.ar}/worker"
    env:
      QUEUE_URL: "${env:QUEUE_URL}"
    scale:
      replica: 3
      cpu: 1
      memory: 2Gi
    provider:
      name: gcp
      options:
        project: "${self:custom.project}"
        zone: "${self:custom.zone}"
        cluster: "${self:custom.cluster}"
        namespace: production
        storage:
          name: filestore
          id: "10.0.1.5"
```

## Destroy Behavior

`pctl destroy` performs:

1. Deletes HPA (if exists).
2. Deletes Deployment.
3. Deletes Service (if ports were exposed).
4. Deletes imagePullSecret (if exists).
5. Deletes RBAC resources: RoleBinding, Role, ServiceAccount (if exists).
6. Deletes PVC and PV (if storage was provisioned).
7. For Artifact Registry images built by pctl, deletes the image tag using `gcloud artifacts docker images delete`.
8. Waits up to 60 seconds for pods to terminate.
9. Cleans up empty namespaces (waits up to 30 seconds).
10. Removes the `filestore-sc` StorageClass if it was created.
11. Marks entries as `destroyed: true` in the state file.
