# Providers Overview

A provider deploys and destroys services on a specific target. Each service declares its provider in the `provider` field:

```yaml
services:
  api:
    provider:
      name: aws        # aws | gcp | docker
      options: {}      # Provider-specific config
```

## Built-in Providers

| Provider | Target | Auth | Remote |
|---|---|---|---|
| [aws](aws.md) | AWS EKS (Kubernetes) | AWS credentials or environment | Via Kubernetes API |
| [gcp](gcp.md) | Google Cloud GKE (Kubernetes) | gcloud CLI | Via Kubernetes API |
| [docker](docker.md) | Docker Engine | Local daemon or SSH | SSH with optional sudo |

## How Providers Work

Each provider function runs in the pipeline after plugins. It:

1. Reads the CLI command (`deploy` or `destroy`) from `process.argv`.
2. Filters `parsed.services` by `provider.name`.
3. Computes a fingerprint for each service.
4. Compares fingerprints against the state file.
5. Skips unchanged services. Builds, pushes, and deploys changed ones.
6. Removes services present in the state file but absent from the config.

## State File

pctl writes a JSON state file named `pctl.{stack_name}.json` in the working directory.

```bash
pctl deploy -c pctl.yaml   # Creates pctl.my-app.json
```

The state file tracks every deployed resource:

```json
{
  "my-app-api": {
    "provider": "aws",
    "cluster": "prod-cluster",
    "namespace": "production",
    "registryUrl": "507738....ecr.us-east-1.amazonaws.com/api",
    "image": "507738....ecr.us-east-1.amazonaws.com/api:1710000000000",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "my-app",
      "pctl-service": "my-app-api"
    },
    "fingerprint": "a3f8c1b2...",
    "hasPorts": true,
    "hasHpa": true,
    "hasRbac": false,
    "hasPvc": false,
    "hasPv": false,
    "hasPullSecret": false,
    "pushedByPctl": true
  }
}
```

On destroy, entries are marked `"destroyed": true` rather than deleted, so the state file retains history.

## Fingerprint Diff

The fingerprint is a SHA-256 hash of the service configuration (excluding `provider`) plus the MD5 of the Dockerfile content when `image` starts with `./`.

```
fingerprint = sha256(sortedJSON(service - provider) + md5(Dockerfile))
```

When a service's fingerprint matches the state file, pctl logs `unchanged, skipping` and moves on. This avoids unnecessary builds and redeployments.

## Labels

Every resource created by pctl receives three labels:

| Label | Value | Example |
|---|---|---|
| `managed-by` | `pctl` | `pctl` |
| `pctl-stack` | Stack name | `my-app` |
| `pctl-service` | `{stack}-{service}` | `my-app-api` |

On Kubernetes, labels are applied to Deployments, Services, HPAs, PVCs, PVs, Secrets, ServiceAccounts, Roles, and RoleBindings. On Docker, they are applied as `--label` flags.

## Resource Naming

Resources are named `{stack}-{service}`:

```yaml
name: acme
services:
  api: ...
  worker: ...
```

Creates resources named `acme-api` and `acme-worker`. For Docker with replicas > 1, containers get a numeric suffix: `acme-api-1`, `acme-api-2`.

## Mixing Providers

A single config can target multiple providers. Each service runs on its declared provider independently:

```yaml
name: hybrid

services:
  api:
    provider:
      name: aws
      options:
        cluster: prod
        namespace: api

  monitor:
    provider:
      name: docker
```

Both services deploy in the same `pctl deploy` run and share the same state file.
