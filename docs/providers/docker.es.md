# Docker

## Requisitos

- Docker instalado y corriendo
- SSH (para despliegues remotos)

## Opciones del proveedor

### Local

```yaml
provider:
  name: docker
  options: {}
```

Sin opciones. Docker debe estar corriendo en la maquina local.

### Remoto via SSH

```yaml
provider:
  name: docker
  options:
    host: 192.168.1.100
    user: deploy
    key: ~/.ssh/deploy_key
    sudo: true
```

## Opciones detalladas

| Opcion | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| `host` | `string` | No | IP o hostname del servidor remoto. Si se omite, usa Docker local |
| `user` | `string` | No | Usuario SSH |
| `key` | `string` | No | Ruta a la clave SSH privada. Soporta `~` para el home |
| `sudo` | `boolean` | No | Si `true`, ejecuta comandos Docker con `sudo` en el servidor remoto |

## Transferencia de imagenes

### Con registry

Si el servicio tiene `registry` definido:

1. `docker build` local
2. `docker push` al registry
3. En remoto: `docker login` + `docker pull`

```yaml
image: ./Dockerfile
registry: ghcr.io/myorg/api
```

### Sin registry (remoto)

Si no hay registry y el destino es remoto:

1. `docker build` local
2. `docker save` → archivo tar
3. `scp` al servidor
4. `docker load` en el servidor
5. Limpia archivos tar en ambos lados

```yaml
image: ./Dockerfile
# Sin registry - usa save/scp/load
provider:
  name: docker
  options:
    host: 192.168.1.100
    user: deploy
```

pctl emite un warning:

```
[docker] "api": no registry for remote host, using docker save/load
```

### Imagen pre-construida

Si `image` no empieza con `./`, se trata como imagen pre-construida:

```yaml
image: nginx:latest
```

pctl no construye ni sube nada. Usa la imagen directamente.

## Replicas

**Numero fijo**: Crea N contenedores con sufijo `-1`, `-2`, etc.

```yaml
scale:
  replica: 3
```

Contenedores: `my-app-api-1`, `my-app-api-2`, `my-app-api-3`

Si `replica` es 1, el contenedor no lleva sufijo: `my-app-api`.

**Tupla [min, max]**: Docker no soporta auto-scaling. Usa el valor `max`.

```yaml
scale:
  replica: [2, 5]
```

Crea 5 contenedores.

## Health checks

```yaml
health:
  interval: 30
  command: "curl -f http://localhost:3000/health"
  retries: 3
  onfailure: restart
```

Se traduce a flags de Docker:

| Campo | Docker flag |
|---|---|
| `command` | `--health-cmd` |
| `interval` | `--health-interval` |
| `retries` | `--health-retries` |

### onfailure

| Valor | Docker flag | Comportamiento |
|---|---|---|
| `restart` | `--restart unless-stopped` | Docker reinicia el contenedor si falla o se cae |
| `stop` | `--restart no` | Docker no reinicia el contenedor |

Si no hay `health` definido, se usa `--restart unless-stopped` por defecto.

## Recursos del contenedor

```yaml
scale:
  cpu: 256m
  memory: 512Mi
```

| Campo | Docker flag | Conversion |
|---|---|---|
| `cpu` | `--cpus` | `256m` → `256e-3` (0.256 CPUs) |
| `memory` | `--memory` | `512Mi` → `512m`, `1Gi` → `1g` |

## Volumenes

```yaml
volumes:
  - path: /data
  - path: /uploads
```

Crea un Docker volume con nombre `{stack}-{service}-storage` y lo monta en las rutas indicadas:

```
-v my-app-api-storage:/data -v my-app-api-storage:/uploads
```

## Puertos

```yaml
ports:
  - 3000         # -p 3000:3000
  - "8080:3000"  # -p 8080:3000
```

## sudo

Algunos servidores requieren `sudo` para ejecutar Docker. Con `sudo: true`, todos los comandos remotos se ejecutan como:

```bash
ssh user@host 'sudo docker run ...'
```

## Ejemplo completo: local + remoto

```yaml
name: my-app

custom:
  ghcr: ghcr.io/myorg

services:
  api:
    image: ./services/api/Dockerfile
    registry:
      url: ${self:custom.ghcr}/api
      username: ${env:GHCR_USER}
      password: ${env:GHCR_TOKEN}
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${env:DATABASE_URL}
    scale:
      replica: 2
      cpu: 512m
      memory: 1Gi
    ports:
      - "8080:3000"
    health:
      interval: 30
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    volumes:
      - path: /app/uploads
    provider:
      name: docker
      options:
        host: 192.168.1.100
        user: deploy
        key: ~/.ssh/deploy_key
        sudo: true

  redis:
    image: redis:7-alpine
    scale:
      replica: 1
    ports:
      - 6379
    provider:
      name: docker

  nginx:
    image: nginx:latest
    command: "nginx -g 'daemon off;'"
    scale:
      replica: 1
    ports:
      - "80:80"
      - "443:443"
    provider:
      name: docker
      options:
        host: 192.168.1.100
        user: deploy
        key: ~/.ssh/deploy_key
```

## Comportamiento de destroy

1. Para cada servicio Docker en el estado:
    - Detiene y elimina todos los contenedores (`docker rm -f`)
    - Elimina volumenes (`docker volume rm`)
    - Elimina imagen (si fue construida por pctl)
2. Marca servicios como `destroyed` en el estado

Para servicios remotos, los comandos se ejecutan via SSH con la configuracion almacenada en el estado.
