# Configuracion

## Anatomia del archivo pctl.yaml

```yaml
name: my-stack                    # Nombre del stack (obligatorio)
resolver:                         # Resolvers personalizados (opcional)
  - ./resolvers/vault.js
plugin:                           # Plugins personalizados (opcional)
  - ./plugins/logger.js
custom:                           # Almacen de valores reutilizables (opcional)
  region: us-east-1
  cluster: prod-cluster
services:                         # Mapa de servicios (obligatorio)
  api:
    image: ./Dockerfile
    # ...campos del servicio
```

## Campos raiz

| Campo | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| `name` | `string` | Si | Nombre del stack. Se usa como prefijo para todos los labels y nombres de recursos |
| `resolver` | `string[]` | No | Rutas a modulos de resolvers personalizados. Se cargan despues de los resolvers integrados (env, ssm, self, cfn) |
| `plugin` | `string[]` | No | Rutas a modulos de plugins. Se ejecutan en orden dentro del pipeline |
| `custom` | `Record<string, any>` | No | Almacen libre de clave/valor. Accesible via `${self:custom.*}` desde cualquier campo |
| `services` | `Record<string, Service>` | Si | Mapa de nombres de servicio a su configuracion |

## Campos del servicio

### image

```yaml
# Ruta a Dockerfile - pctl construye y sube la imagen
image: ./Dockerfile

# Imagen pre-construida - pctl solo hace pull
image: nginx:latest
image: node:20-alpine
```

Cuando `image` empieza con `./`, pctl lo interpreta como ruta a un Dockerfile relativa al archivo de configuracion. Construye la imagen con `docker build` y la sube al registry especificado. Si no empieza con `./`, se trata como nombre de imagen pre-construida.

### registry

```yaml
# Solo URL (sin autenticacion o auto-auth)
registry: ghcr.io/myorg/api

# URL con credenciales
registry:
  url: ghcr.io/myorg/api
  username: ${env:GHCR_USER}
  password: ${env:GHCR_TOKEN}
```

| Campo | Tipo | Descripcion |
|---|---|---|
| `url` | `string` | URL del registry (ej. `ghcr.io/user/repo`, `507738...ecr.../pool`) |
| `username` | `string?` | Usuario para autenticacion |
| `password` | `string?` | Contrasena o token para autenticacion |

El registry es opcional. No se necesita para Docker local con imagenes pre-construidas. ECR y Artifact Registry se autentican automaticamente con las credenciales del proveedor.

### command

```yaml
command: "node server.js"
```

Sobreescribe el CMD del Dockerfile. Se ejecuta como `sh -c "<command>"`.

### env

```yaml
env:
  NODE_ENV: production
  DATABASE_URL: ${ssm:/myapp/db-url}
  API_KEY: ${env:API_KEY, default-key}
```

Variables de entorno pasadas al contenedor. Los valores soportan sintaxis de resolvers.

### scale

```yaml
# Replicas fijas
scale:
  replica: 3
  cpu: 256m
  memory: 512Mi

# Auto-scaling (solo Kubernetes)
scale:
  replica: [2, 10]
  cpu: 1
  memory: 1Gi
```

| Campo | Tipo | Descripcion |
|---|---|---|
| `replica` | `number \| [min, max]` | Numero fijo de instancias, o rango para HPA (HorizontalPodAutoscaler) |
| `cpu` | `string?` | Limite de CPU del contenedor (ej. `256m`, `1`, `0.5`) |
| `memory` | `string?` | Limite de memoria del contenedor (ej. `512Mi`, `1Gi`) |

Con `replica` como tupla `[min, max]`, los proveedores Kubernetes crean un HPA con target de 80% de utilizacion de CPU. Docker usa el valor `max`.

### ports

```yaml
ports:
  - 3000           # Mismo puerto host y contenedor
  - "8080:3000"    # host:container
```

Puertos a exponer. En Kubernetes crea un Service. En Docker mapea puertos con `-p`.

### health

```yaml
health:
  interval: 30
  command: "curl -f http://localhost:3000/health"
  retries: 3
  onfailure: restart
```

| Campo | Tipo | Default | Descripcion |
|---|---|---|---|
| `interval` | `number` | - | Segundos entre health checks |
| `command` | `string` | - | Comando ejecutado dentro del contenedor. Codigo de salida distinto de cero marca como unhealthy |
| `retries` | `number` | `3` | Fallos consecutivos antes de ejecutar la accion de `onfailure` |
| `onfailure` | `"restart" \| "stop"` | `"restart"` | Accion ante fallo del health check |

Comportamiento segun proveedor:

- **Kubernetes** (AWS/GCP): `restart` crea un **livenessProbe** (reinicia el pod). `stop` crea un **readinessProbe** (deja de recibir trafico)
- **Docker**: `restart` usa `--restart unless-stopped`. `stop` usa `--restart no`. El comando se pasa como `--health-cmd`

### volumes

```yaml
volumes:
  - path: /data
  - path: /uploads
```

Puntos de montaje dentro del contenedor. El almacenamiento real depende del proveedor:

- **AWS**: EBS (ReadWriteOnce) o EFS (ReadWriteMany) segun `provider.options.storage`
- **GCP**: Persistent Disk (ReadWriteOnce) o Filestore (ReadWriteMany) segun `provider.options.storage`
- **Docker**: Docker volumes con nombre `{stack}-{service}-storage`

Sin configuracion de storage en el proveedor, se usa `emptyDir` (Kubernetes) o un volumen Docker anonimo.

### provider

```yaml
provider:
  name: aws
  options:
    cluster: prod-cluster
    namespace: production
    strategy: RollingUpdate
    serviceAccount: api-sa
    rbac:
      - resources: ["pods", "services"]
        verbs: ["get", "list"]
    storage:
      size: 20Gi
```

| Campo | Tipo | Descripcion |
|---|---|---|
| `name` | `string` | Identificador del driver: `aws`, `gcp` o `docker` |
| `options` | `Record<string, any>` | Configuracion especifica del proveedor |

Las opciones varian por proveedor. Consulta [AWS](../providers/aws.es.md), [GCP](../providers/gcp.es.md) y [Docker](../providers/docker.es.md) para los detalles.

## Bloque custom

El bloque `custom` es un almacen libre de clave/valor accesible desde cualquier campo via `${self:custom.*}`:

```yaml
name: my-app

custom:
  region: us-east-1
  cluster: prod-cluster
  namespace: production
  ecr: 507738123456.dkr.ecr.us-east-1.amazonaws.com

services:
  api:
    image: ./services/api/Dockerfile
    registry: ${self:custom.ecr}/api
    env:
      AWS_REGION: ${self:custom.region}
    scale:
      replica: [2, 5]
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}

  worker:
    image: ./services/worker/Dockerfile
    registry: ${self:custom.ecr}/worker
    env:
      AWS_REGION: ${self:custom.region}
    scale:
      replica: 1
      cpu: 512m
      memory: 1Gi
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}
```

## Ejemplo completo

```yaml
name: production

resolver:
  - ./resolvers/vault.js

plugin:
  - ./plugins/logger.js

custom:
  region: us-east-1
  cluster: prod-eks
  namespace: app
  ecr: 507738123456.dkr.ecr.us-east-1.amazonaws.com

services:
  api:
    image: ./services/api/Dockerfile
    registry: ${self:custom.ecr}/api
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/prod/db-url}
      REDIS_URL: ${ssm:/prod/redis-url}
      JWT_SECRET: ${ssm:/prod/jwt-secret}
    scale:
      replica: [2, 10]
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    health:
      interval: 30
      command: "curl -f http://localhost:3000/health"
      retries: 3
      onfailure: restart
    volumes:
      - path: /app/uploads
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}
        strategy: RollingUpdate
        serviceAccount: api-sa
        rbac:
          - resources: ["pods", "services"]
            verbs: ["get", "list"]
        storage:
          name: efs
          id: fs-0123456789abcdef0

  worker:
    image: ./services/worker/Dockerfile
    registry: ${self:custom.ecr}/worker
    command: "node dist/worker.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/prod/db-url}
      QUEUE_URL: ${ssm:/prod/queue-url}
    scale:
      replica: 3
      cpu: 512m
      memory: 1Gi
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}

  monitoring:
    image: grafana/grafana:latest
    scale:
      replica: 1
    ports:
      - "3001:3000"
    provider:
      name: docker
```
