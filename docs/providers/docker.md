# Docker Provider

Deploys services as Docker containers on the local machine or remote hosts via SSH.

## Requirements

- Docker installed and running (locally, or on the remote host)
- SSH access (for remote deployments)

## Options

```yaml
provider:
  name: docker
  options: {}               # Local deployment (no options needed)
```

```yaml
provider:
  name: docker
  options:
    host: 192.168.1.50      # Remote host address
    user: deploy             # SSH user
    key: ~/.ssh/id_rsa       # Path to SSH private key
    sudo: true               # Run docker commands with sudo
```

### Options Reference

| Option | Type | Required | Description |
|---|---|:---:|---|
| `host` | `string` | No | Remote host address. Omit for local deployment. |
| `user` | `string` | No | SSH user. |
| `key` | `string` | No | Path to SSH private key. Supports `~` expansion. |
| `sudo` | `boolean` | No | Prefix docker commands with `sudo` on the remote host. |

## Local Deployment

When `options` is empty or `host` is not set, pctl runs docker commands directly on the local machine:

```yaml
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

## Remote Deployment via SSH

With `host` set, all docker commands run over SSH:

```yaml
services:
  api:
    image: ./Dockerfile
    registry: ghcr.io/myorg/api
    scale:
      replica: 2
    ports:
      - "8080:3000"
    provider:
      name: docker
      options:
        host: 10.0.1.20
        user: deploy
        key: ~/.ssh/deploy_key
        sudo: true
```

SSH commands use `-o StrictHostKeyChecking=no` and the provided key file. When `sudo: true`, docker commands are prefixed with `sudo`.

## Image Transfer

### With Registry

When `registry` is set, pctl builds and pushes locally, then pulls on the remote host:

```
local: docker build -> docker push
remote: docker login -> docker pull
```

### Without Registry (docker save/load)

When building from Dockerfile without a registry on a remote host, pctl transfers the image via `docker save` + `scp` + `docker load`:

```
local: docker build -> docker save -> scp
remote: docker load
```

Temporary tar files are cleaned up on both sides.

### Pre-built Image

When `image` does not start with `./`, pctl uses the image as-is. On remote hosts, the image must already exist or be pullable.

## Replicas

### Fixed Count

```yaml
scale:
  replica: 3
```

Creates 3 containers named `{stack}-{service}-1`, `{stack}-{service}-2`, `{stack}-{service}-3`.

With `replica: 1`, the container is named `{stack}-{service}` (no suffix).

### Auto-Scale Tuple

```yaml
scale:
  replica: [2, 5]
```

Docker does not support auto-scaling. The `max` value is used as a fixed count. This creates 5 containers.

## Health Checks

```yaml
health:
  interval: 10
  command: "curl -f http://localhost:3000/health"
  retries: 3
  onfailure: restart
```

Maps to Docker health check flags:

| YAML Field | Docker Flag |
|---|---|
| `command` | `--health-cmd` |
| `interval` | `--health-interval` (in seconds) |
| `retries` | `--health-retries` |

### onfailure Behavior

| Value | Docker Restart Policy |
|---|---|
| `restart` | `--restart unless-stopped` |
| `stop` | `--restart no` |

When no health check is defined, the default restart policy is `--restart unless-stopped`.

## Resource Limits

```yaml
scale:
  replica: 1
  cpu: 256m
  memory: 512Mi
```

Maps to Docker flags:

- `cpu: 256m` becomes `--cpus 256e-3` (0.256 CPUs)
- `memory: 512Mi` becomes `--memory 512m`
- `memory: 1Gi` becomes `--memory 1g`

## Ports

```yaml
ports:
  - 3000            # -p 3000:3000
  - "8080:3000"     # -p 8080:3000
```

## Volumes

```yaml
volumes:
  - path: /data
```

Creates a Docker named volume `{stack}-{service}-storage` mounted at the specified path.

## Registry Authentication

```yaml
registry:
  url: ghcr.io/myorg/api
  username: "${env:GHCR_USER}"
  password: "${env:GHCR_TOKEN}"
```

When auth is provided, pctl runs `docker login` both locally and on the remote host (if `host` is set).

## Full Example

```yaml
name: my-app

custom:
  ghcr: ghcr.io/myorg

services:
  # Local service - no registry needed
  api:
    image: ./services/api/Dockerfile
    command: "node server.js"
    env:
      NODE_ENV: production
      PORT: "3000"
    scale:
      replica: 1
      cpu: 512m
      memory: 1Gi
    ports:
      - "8080:3000"
    health:
      interval: 10
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    volumes:
      - path: /app/data
    provider:
      name: docker

  # Remote service via SSH with registry
  worker:
    image: ./services/worker/Dockerfile
    registry:
      url: "${self:custom.ghcr}/worker"
      username: "${env:GHCR_USER}"
      password: "${env:GHCR_TOKEN}"
    env:
      REDIS_URL: "${env:REDIS_URL}"
    scale:
      replica: 3
      cpu: 256m
      memory: 512Mi
    provider:
      name: docker
      options:
        host: 10.0.1.20
        user: deploy
        key: ~/.ssh/deploy_key
        sudo: true

  # Pre-built image, local
  redis:
    image: redis:7-alpine
    scale:
      replica: 1
    ports:
      - "6379:6379"
    volumes:
      - path: /data
    provider:
      name: docker
```

## Destroy Behavior

`pctl destroy` performs:

1. Stops and removes all containers (`docker rm -f`).
2. Removes associated Docker volumes (`docker volume rm`).
3. For images built by pctl, removes the local image (`docker rmi`).
4. On remote hosts, all removal commands run via SSH.
5. Marks entries as `destroyed: true` in the state file.
