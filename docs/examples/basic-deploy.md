# Basic Deploy Examples

## Example 1: Single Service, Docker Local, Port Mapping

A single NGINX container with port mapping. No registry needed for pre-built images.

### pctl.yaml

```yaml
name: web

services:
  nginx:
    image: nginx:latest
    scale:
      replica: 1
    ports:
      - "8080:80"
    provider:
      name: docker
```

### Deploy

```bash
pctl deploy
```

Output:

```
[docker] started "web-nginx"
[docker] deployed "web-nginx" (1 replica)
```

### Verify

```bash
docker ps --filter label=pctl-stack=web
```

```
CONTAINER ID   IMAGE          PORTS                  NAMES
f1a2b3c4d5e6   nginx:latest   0.0.0.0:8080->80/tcp   web-nginx
```

```bash
curl http://localhost:8080
```

### State (pctl.web.json)

```json
{
  "web-nginx": {
    "provider": "docker",
    "host": "local",
    "image": "nginx:latest",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "web",
      "pctl-service": "web-nginx"
    },
    "fingerprint": "e5a2f1...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```

### Destroy

```bash
pctl destroy
```

```
[docker] destroyed "web-nginx"
```

---

## Example 2: Two Services, One with Health Check

An API with health check and a worker without.

### pctl.yaml

```yaml
name: backend

services:
  api:
    image: ./Dockerfile
    env:
      PORT: "3000"
      NODE_ENV: production
    scale:
      replica: 2
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    health:
      interval: 10
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    provider:
      name: docker

  worker:
    image: ./worker/Dockerfile
    env:
      QUEUE_URL: "redis://localhost:6379"
    scale:
      replica: 1
      cpu: 512m
      memory: 1Gi
    provider:
      name: docker
```

### Deploy

```bash
pctl deploy
```

Output:

```
[docker] started "backend-api-1"
[docker] started "backend-api-2"
[docker] deployed "backend-api" (2 replicas)
[docker] started "backend-worker"
[docker] deployed "backend-worker" (1 replica)
```

### Verify

```bash
docker ps --filter label=pctl-stack=backend
```

```
CONTAINER ID   IMAGE                   PORTS      NAMES
a1b2c3d4e5f6   pctl-local:171000001    3000/tcp   backend-api-1
b2c3d4e5f6a7   pctl-local:171000001    3000/tcp   backend-api-2
c3d4e5f6a7b8   pctl-local:171000002               backend-worker
```

The API containers have `--health-cmd`, `--health-interval 10s`, `--health-retries 3`, and `--restart unless-stopped`. The worker has `--restart unless-stopped` but no health check.

### State (pctl.backend.json)

```json
{
  "backend-api": {
    "provider": "docker",
    "host": "local",
    "image": "pctl-local:1710000001",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "backend",
      "pctl-service": "backend-api"
    },
    "fingerprint": "b7c3d2...",
    "replica": 2,
    "hasPorts": true,
    "pushedByPctl": true
  },
  "backend-worker": {
    "provider": "docker",
    "host": "local",
    "image": "pctl-local:1710000002",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "backend",
      "pctl-service": "backend-worker"
    },
    "fingerprint": "d4e5f6...",
    "replica": 1,
    "hasPorts": false,
    "pushedByPctl": true
  }
}
```

---

## Example 3: Pre-built Image with Command Override

Using `nginx:alpine` with a custom config command.

### pctl.yaml

```yaml
name: proxy

services:
  gateway:
    image: nginx:alpine
    command: "nginx -g 'daemon off;' -c /etc/nginx/custom.conf"
    scale:
      replica: 1
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - path: /etc/nginx/conf.d
    provider:
      name: docker
```

### Deploy

```bash
pctl deploy
```

Output:

```
[docker] started "proxy-gateway"
[docker] deployed "proxy-gateway" (1 replica)
```

### Verify

```bash
docker inspect proxy-gateway --format '{{.Config.Cmd}}'
```

```
[sh -c nginx -g 'daemon off;' -c /etc/nginx/custom.conf]
```

The command is executed as `sh -c "<command>"`, preserving the full shell expression.

### State (pctl.proxy.json)

```json
{
  "proxy-gateway": {
    "provider": "docker",
    "host": "local",
    "image": "nginx:alpine",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "proxy",
      "pctl-service": "proxy-gateway"
    },
    "fingerprint": "f6a7b8...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```
