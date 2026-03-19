# Getting Started

## Minimal Configuration

Create a file named `pctl.yaml` in your project root:

```yaml
name: my-app

services:
  api:
    image: node:20-alpine
    command: "node server.js"
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

### Field Breakdown

| Field | Description |
|---|---|
| `name` | Stack name. Used as prefix for all container/resource names (e.g. `my-app-api`). |
| `services` | Map of service names to their configuration. Each key becomes the service identifier. |
| `image` | Pre-built image (`node:20-alpine`) or path to Dockerfile (`./Dockerfile`). |
| `command` | Overrides the image CMD. Executed as `sh -c "<command>"`. |
| `scale.replica` | Number of instances. Integer for fixed count, `[min, max]` for auto-scaling. |
| `ports` | Ports to expose. Number (`3000`) or host:container mapping (`"8080:3000"`). |
| `provider.name` | Deployment target: `aws`, `gcp`, or `docker`. |

## Deploy

```bash
pctl deploy
```

Output:

```
[docker] started "my-app-api"
[docker] deployed "my-app-api" (1 replica)
```

## Check Running Containers

```bash
docker ps --filter label=pctl-stack=my-app
```

```
CONTAINER ID   IMAGE             COMMAND                NAMES
a1b2c3d4e5f6   node:20-alpine    "sh -c 'node server…"  my-app-api
```

## State File

After deploy, pctl creates `pctl.my-app.json` in the working directory:

```json
{
  "my-app-api": {
    "provider": "docker",
    "host": "local",
    "image": "node:20-alpine",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "my-app",
      "pctl-service": "my-app-api"
    },
    "fingerprint": "a3f8c1...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```

The state file tracks every resource created. On subsequent deploys, pctl compares fingerprints and skips unchanged services.

## Destroy

```bash
pctl destroy
```

Output:

```
[docker] destroyed "my-app-api"
```

All containers, volumes, and locally-built images are removed.

## Building from Dockerfile

Point `image` to a Dockerfile path instead of a pre-built image:

```yaml
name: my-app

services:
  api:
    image: ./Dockerfile
    scale:
      replica: 1
    ports:
      - 3000
    provider:
      name: docker
```

When `image` starts with `./`, pctl builds the image locally with `docker build`. For remote Docker hosts or Kubernetes providers, a `registry` field is required to push the built image.

## What's Next

- [Configuration](configuration.md) -- Full YAML anatomy with every field explained
- [Providers](../providers/overview.md) -- AWS, GCP, and Docker provider details
- [Resolvers](resolvers.md) -- Dynamic value resolution with `${env:KEY}`, `${ssm:/path}`, etc.
