# Multi-Proveedor

Un stack que combina AWS EKS y Docker en un solo YAML, usando `custom` para reutilizar valores y registries distintos por servicio.

## pctl.yaml

```yaml
name: my-platform

custom:
  region: us-east-1
  cluster: prod-eks
  namespace: platform
  ecr: 507738123456.dkr.ecr.us-east-1.amazonaws.com
  ghcr: ghcr.io/myorg

services:
  api:
    image: ./services/api/Dockerfile
    registry: ${self:custom.ecr}/api
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/platform/db-url}
      REDIS_URL: ${ssm:/platform/redis-url}
      JWT_SECRET: ${ssm:/platform/jwt-secret}
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
    provider:
      name: aws
      options:
        credentials:
          region: ${self:custom.region}
          access_key_id: ${env:AWS_ACCESS_KEY_ID}
          secret_access_key: ${env:AWS_SECRET_ACCESS_KEY}
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}
        strategy: RollingUpdate

  worker:
    image: ./services/worker/Dockerfile
    registry: ${self:custom.ecr}/worker
    command: "node dist/worker.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${ssm:/platform/db-url}
      QUEUE_URL: ${ssm:/platform/queue-url}
    scale:
      replica: 3
      cpu: 512m
      memory: 1Gi
    provider:
      name: aws
      options:
        credentials:
          region: ${self:custom.region}
          access_key_id: ${env:AWS_ACCESS_KEY_ID}
          secret_access_key: ${env:AWS_SECRET_ACCESS_KEY}
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}

  monitoring:
    image: ./services/monitoring/Dockerfile
    registry:
      url: ${self:custom.ghcr}/monitoring
      username: ${env:GHCR_USER}
      password: ${env:GHCR_TOKEN}
    env:
      GRAFANA_ADMIN_PASSWORD: ${env:GRAFANA_PASS, admin}
    scale:
      replica: 1
    ports:
      - "3001:3000"
    provider:
      name: docker
      options:
        host: 10.0.1.50
        user: deploy
        key: ~/.ssh/monitoring_key

  redis:
    image: redis:7-alpine
    scale:
      replica: 1
    ports:
      - 6379
    health:
      interval: 10
      command: "redis-cli ping"
      retries: 5
      onfailure: restart
    provider:
      name: docker
```

## Explicacion

### Bloque custom

El bloque `custom` centraliza valores reutilizados por multiples servicios:

- `region`, `cluster`, `namespace` - Configuracion de AWS compartida entre `api` y `worker`
- `ecr` - URL base del registry ECR para servicios de Kubernetes
- `ghcr` - URL base de GitHub Container Registry para el servicio de monitoring

Todos accesibles via `${self:custom.*}`.

### Registries distintos

| Servicio | Registry | Autenticacion |
|---|---|---|
| `api` | ECR (`507738...ecr...`) | Auto-auth via AWS credentials |
| `worker` | ECR (`507738...ecr...`) | Auto-auth via AWS credentials |
| `monitoring` | GHCR (`ghcr.io/myorg`) | Username/token, crea imagePullSecret en Docker remoto |
| `redis` | Ninguno | Imagen pre-construida, sin push |

### Proveedores mezclados

- **api** y **worker**: AWS EKS con auto-scaling, SSM para secrets, ECR para imagenes
- **monitoring**: Docker remoto via SSH con GHCR para la imagen
- **redis**: Docker local sin registry

### Flujo de deploy

Al ejecutar `pctl deploy`:

1. **resolve**: Procesa `${self:...}`, `${ssm:...}`, `${env:...}` en todos los valores
2. **validate**: Verifica el schema
3. **aws**: Despliega `api` y `worker` a EKS (build → push ECR → Deployment + Service + HPA)
4. **docker**: Despliega `monitoring` via SSH (build → push GHCR → pull remoto → docker run) y `redis` local (pull → docker run)

### Estado resultante

El archivo `pctl.my-platform.json` contiene las cuatro entradas con proveedores distintos:

```json
{
  "my-platform-api": {
    "provider": "aws",
    "cluster": "prod-eks",
    "namespace": "platform",
    "registryUrl": "507738123456.dkr.ecr.us-east-1.amazonaws.com/api",
    "image": "507738123456.dkr.ecr.us-east-1.amazonaws.com/api:1710234567890",
    "fingerprint": "...",
    "hasHpa": true,
    "hasPorts": true
  },
  "my-platform-worker": {
    "provider": "aws",
    "cluster": "prod-eks",
    "namespace": "platform",
    "registryUrl": "507738123456.dkr.ecr.us-east-1.amazonaws.com/worker",
    "image": "507738123456.dkr.ecr.us-east-1.amazonaws.com/worker:1710234567891",
    "fingerprint": "...",
    "hasHpa": false,
    "hasPorts": false
  },
  "my-platform-monitoring": {
    "provider": "docker",
    "host": "10.0.1.50",
    "registryUrl": "ghcr.io/myorg/monitoring",
    "image": "ghcr.io/myorg/monitoring:1710234567892",
    "fingerprint": "...",
    "replica": 1,
    "hasPorts": true
  },
  "my-platform-redis": {
    "provider": "docker",
    "host": "local",
    "image": "redis:7-alpine",
    "fingerprint": "...",
    "replica": 1,
    "hasPorts": true
  }
}
```

### Destroy

`pctl destroy` elimina todos los recursos de ambos proveedores:

- AWS: Deployments, Services, HPA, namespace (si vacio), imagenes ECR
- Docker: Contenedores locales y remotos, volumenes, imagenes construidas por pctl
