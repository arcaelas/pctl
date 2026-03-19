# Despliegue Basico

## Ejemplo 1: Servicio unico con Docker local

Un servicio Docker local sin registry, con mapeo de puertos.

### pctl.yaml

```yaml
name: hello

services:
  web:
    image: nginx:latest
    scale:
      replica: 1
    ports:
      - "8080:80"
    provider:
      name: docker
```

### Desplegar

```bash
pctl deploy
```

### Salida esperada

```
[docker] started "hello-web"
[docker] deployed "hello-web" (1 replica)
```

### Estado (pctl.hello.json)

```json
{
  "hello-web": {
    "provider": "docker",
    "host": "local",
    "registryUrl": null,
    "image": "nginx:latest",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "hello",
      "pctl-service": "hello-web"
    },
    "fingerprint": "a1b2c3...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```

### Verificar

```bash
docker ps --filter label=pctl-stack=hello
```

```
CONTAINER ID  IMAGE          PORTS                  NAMES
a1b2c3d4e5f6  nginx:latest   0.0.0.0:8080->80/tcp   hello-web
```

```bash
curl http://localhost:8080
```

### Destruir

```bash
pctl destroy
```

```
[docker] destroyed "hello-web"
```

---

## Ejemplo 2: Dos servicios, uno con health check

Un API con health check y un worker sin health check, ambos en Docker local.

### pctl.yaml

```yaml
name: my-app

services:
  api:
    image: node:20-alpine
    command: "node server.js"
    env:
      PORT: "3000"
      NODE_ENV: production
    scale:
      replica: 1
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    health:
      interval: 30
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    provider:
      name: docker

  worker:
    image: node:20-alpine
    command: "node worker.js"
    env:
      NODE_ENV: production
    scale:
      replica: 2
    provider:
      name: docker
```

### Desplegar

```bash
pctl deploy
```

### Salida esperada

```
[docker] started "my-app-api"
[docker] deployed "my-app-api" (1 replica)
[docker] started "my-app-worker-1"
[docker] started "my-app-worker-2"
[docker] deployed "my-app-worker" (2 replicas)
```

### Verificar

```bash
docker ps --filter label=pctl-stack=my-app
```

```
CONTAINER ID  IMAGE            PORTS                   NAMES
a1b2c3d4e5f6  node:20-alpine   0.0.0.0:3000->3000/tcp  my-app-api
b2c3d4e5f6a7  node:20-alpine                           my-app-worker-1
c3d4e5f6a7b8  node:20-alpine                           my-app-worker-2
```

El API tiene `--health-cmd`, `--health-interval`, `--health-retries` y `--restart unless-stopped`. El worker no tiene health check pero tambien usa `--restart unless-stopped` por defecto.

### Estado (pctl.my-app.json)

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
    "fingerprint": "d4e5f6...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  },
  "my-app-worker": {
    "provider": "docker",
    "host": "local",
    "image": "node:20-alpine",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "my-app",
      "pctl-service": "my-app-worker"
    },
    "fingerprint": "e5f6a7...",
    "replica": 2,
    "hasPorts": false,
    "pushedByPctl": false
  }
}
```

---

## Ejemplo 3: Imagen pre-construida con comando override

Nginx con configuracion personalizada via command.

### pctl.yaml

```yaml
name: proxy

services:
  nginx:
    image: nginx:latest
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

### Desplegar

```bash
pctl deploy
```

### Salida esperada

```
[docker] started "proxy-nginx"
[docker] deployed "proxy-nginx" (1 replica)
```

### Verificar

```bash
docker ps --filter label=pctl-stack=proxy
```

```
CONTAINER ID  IMAGE          PORTS                                     NAMES
f6a7b8c9d0e1  nginx:latest   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp  proxy-nginx
```

El contenedor ejecuta `sh -c "nginx -g 'daemon off;' -c /etc/nginx/custom.conf"` en lugar del CMD por defecto. El volumen `proxy-nginx-storage` se monta en `/etc/nginx/conf.d`.

### Estado (pctl.proxy.json)

```json
{
  "proxy-nginx": {
    "provider": "docker",
    "host": "local",
    "image": "nginx:latest",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "proxy",
      "pctl-service": "proxy-nginx"
    },
    "fingerprint": "b8c9d0...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```
