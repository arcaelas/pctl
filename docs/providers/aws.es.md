# AWS (EKS)

## Requisitos

- AWS CLI configurado o credenciales explicitas
- Cluster EKS existente
- ECR o registry externo para imagenes construidas por pctl
- Docker local para construir imagenes

## Opciones del proveedor

```yaml
provider:
  name: aws
  options:
    credentials:              # Opcional - usa env/AWS config si se omite
      region: us-east-1
      access_key_id: AKIA...
      secret_access_key: wJal...
      session_token: FwoG...  # Opcional
    cluster: prod-cluster     # Obligatorio
    namespace: production     # Obligatorio
    strategy: RollingUpdate   # Opcional
    serviceAccount: api-sa    # Opcional
    rbac:                     # Opcional
      - resources: ["pods", "services"]
        verbs: ["get", "list", "watch"]
    storage:                  # Opcional
      size: 20Gi              # EBS
      # O para EFS:
      # name: efs
      # id: fs-0123456789abcdef0
```

## Opciones detalladas

| Opcion | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| `credentials` | `object` | No | Credenciales AWS. Si se omite, usa variables de entorno o configuracion AWS |
| `credentials.region` | `string` | Si (si credentials) | Region AWS |
| `credentials.access_key_id` | `string` | Si (si credentials) | Access key ID |
| `credentials.secret_access_key` | `string` | Si (si credentials) | Secret access key |
| `credentials.session_token` | `string` | No | Session token para credenciales temporales (STS) |
| `cluster` | `string` | Si | Nombre del cluster EKS |
| `namespace` | `string` | Si | Namespace de Kubernetes |
| `strategy` | `string` | No | Estrategia de deployment (`RollingUpdate`, `Recreate`) |
| `serviceAccount` | `string` | No | Nombre del ServiceAccount. Por defecto usa `{stack}-{service}` |
| `rbac` | `array` | No | Reglas RBAC. Crea ServiceAccount + Role + RoleBinding |
| `storage` | `object` | No | Configuracion de almacenamiento persistente |

## Credenciales

El proveedor resuelve credenciales en este orden:

1. `options.credentials` explicitas en el YAML
2. Variables de entorno: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
3. Configuracion AWS por defecto (`~/.aws/credentials`, roles IAM)

Para generar un token de Kubernetes, pctl firma una peticion presigned a STS usando SignatureV4, similar a como funciona `aws eks get-token`.

## Que crea

Para cada servicio con `provider.name: aws`, pctl genera y aplica estos recursos de Kubernetes:

### Namespace

Se crea automaticamente si no existe. Se elimina en destroy si queda vacio.

### Deployment

Deployment con las replicas, imagen, variables de entorno, limites de recursos, comando, probes y volumenes configurados.

### Service

Se crea solo si el servicio tiene `ports` definidos. Mapea los puertos host:container.

### HPA (HorizontalPodAutoscaler)

Se crea cuando `scale.replica` es una tupla `[min, max]`:

```yaml
scale:
  replica: [2, 10]
```

Genera un HPA con target de 80% de utilizacion de CPU, `minReplicas: 2`, `maxReplicas: 10`.

### PersistentVolume y PersistentVolumeClaim

Se crean cuando `volumes` esta definido y `storage` esta configurado en las opciones del proveedor.

**EBS** (`storage.size`):

```yaml
storage:
  size: 20Gi
```

Crea un PVC con `storageClassName: gp2`, modo `ReadWriteOnce`.

**EFS** (`storage.name: efs` + `storage.id`):

```yaml
storage:
  name: efs
  id: fs-0123456789abcdef0
```

Crea un PV con driver CSI `efs.csi.aws.com`, un StorageClass `efs-sc`, y un PVC con modo `ReadWriteMany`.

**Sin storage**: Usa `emptyDir` (se pierde al reiniciar el pod).

### RBAC (ServiceAccount + Role + RoleBinding)

Se crea cuando `rbac` tiene reglas:

```yaml
rbac:
  - resources: ["pods", "services"]
    verbs: ["get", "list", "watch"]
  - resources: ["configmaps"]
    verbs: ["get"]
```

Crea:

- **ServiceAccount** con el nombre configurado en `serviceAccount` (o `{stack}-{service}`)
- **Role** con las reglas especificadas
- **RoleBinding** que asocia el ServiceAccount al Role

### imagePullSecret

Se crea automaticamente cuando el registry tiene credenciales (`username`/`password`) y **no es ECR**. Para ECR, pctl obtiene el token de autenticacion automaticamente via `GetAuthorizationTokenCommand`.

```yaml
registry:
  url: ghcr.io/myorg/api
  username: ${env:GHCR_USER}
  password: ${env:GHCR_TOKEN}
```

Genera un Secret de tipo `kubernetes.io/dockerconfigjson` y lo referencia en `imagePullSecrets` del Deployment.

## Autenticacion con ECR

Si la URL del registry contiene `.dkr.ecr.`, pctl la trata como ECR:

1. Obtiene token via `GetAuthorizationTokenCommand`
2. Ejecuta `docker login` con el token
3. No crea imagePullSecret (EKS autentica via IAM)

## Health checks

| `onfailure` | Kubernetes | Comportamiento |
|---|---|---|
| `restart` | livenessProbe | Si falla, Kubernetes reinicia el pod |
| `stop` | readinessProbe | Si falla, Kubernetes deja de enviar trafico al pod |

El probe ejecuta `sh -c "{command}"` con `periodSeconds` y `failureThreshold` configurados.

## Ejemplo completo

```yaml
name: production

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
        storage:
          size: 50Gi
```

## Comportamiento de destroy

1. Elimina HPA (si existe)
2. Elimina Deployment
3. Elimina Service (si existe)
4. Elimina imagePullSecret (si existe)
5. Elimina RBAC: RoleBinding, Role, ServiceAccount (si existen)
6. Elimina PVC y PV (si existen)
7. Elimina imagen de ECR (si fue construida por pctl)
8. Espera hasta 60 segundos a que los pods terminen
9. Si el namespace queda vacio, lo elimina (espera hasta 30 segundos)
10. Elimina StorageClass `efs-sc` si se creo
