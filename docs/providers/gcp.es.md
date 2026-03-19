# GCP (GKE)

## Requisitos

- gcloud CLI autenticado (`gcloud auth login`)
- Cluster GKE existente
- Artifact Registry o registry externo para imagenes construidas por pctl
- Docker local para construir imagenes

## Opciones del proveedor

```yaml
provider:
  name: gcp
  options:
    project: my-gcp-project     # Obligatorio
    zone: us-central1-a         # Obligatorio
    cluster: prod-gke           # Obligatorio
    namespace: production       # Obligatorio
    strategy: RollingUpdate     # Opcional
    serviceAccount: api-sa      # Opcional
    rbac:                       # Opcional
      - resources: ["pods", "services"]
        verbs: ["get", "list", "watch"]
    storage:                    # Opcional
      size: 20Gi                # Persistent Disk
      # O para Filestore:
      # name: filestore
      # id: 10.0.0.2
```

## Opciones detalladas

| Opcion | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| `project` | `string` | Si | ID del proyecto GCP |
| `zone` | `string` | Si | Zona del cluster GKE (ej. `us-central1-a`) |
| `cluster` | `string` | Si | Nombre del cluster GKE |
| `namespace` | `string` | Si | Namespace de Kubernetes |
| `strategy` | `string` | No | Estrategia de deployment (`RollingUpdate`, `Recreate`) |
| `serviceAccount` | `string` | No | Nombre del ServiceAccount. Por defecto usa `{stack}-{service}` |
| `rbac` | `array` | No | Reglas RBAC. Crea ServiceAccount + Role + RoleBinding |
| `storage` | `object` | No | Configuracion de almacenamiento persistente |

## Autenticacion

GCP no requiere credenciales explicitas en el YAML. pctl usa `gcloud` para:

1. Obtener credenciales del cluster: `gcloud container clusters get-credentials {cluster} --zone {zone} --project {project}`
2. Cargar kubeconfig por defecto
3. Autenticarse con Artifact Registry (si aplica)

Asegurate de tener `gcloud auth login` ejecutado antes de usar pctl.

## Que crea

Los recursos son equivalentes a los de AWS. Para cada servicio con `provider.name: gcp`:

### Namespace

Se crea automaticamente si no existe.

### Deployment

Deployment con replicas, imagen, env, limites, comando, probes y volumenes.

### Service

Se crea solo si hay `ports` definidos.

### HPA

Se crea cuando `scale.replica` es `[min, max]`. Target de 80% CPU.

### PersistentVolume y PersistentVolumeClaim

**Persistent Disk** (`storage.size`):

```yaml
storage:
  size: 20Gi
```

PVC con `storageClassName: standard-rw`, modo `ReadWriteOnce`.

**Filestore** (`storage.name: filestore` + `storage.id`):

```yaml
storage:
  name: filestore
  id: 10.0.0.2
```

PV con NFS (`server: 10.0.0.2`, `path: /vol1`), StorageClass `filestore-sc`, PVC con modo `ReadWriteMany`.

**Sin storage**: Usa `emptyDir`.

### RBAC

Identico a AWS: ServiceAccount + Role + RoleBinding.

### imagePullSecret

Se crea para registries externos con credenciales. Para Artifact Registry, pctl obtiene un token via `gcloud auth print-access-token` y ejecuta `docker login` automaticamente. No necesita imagePullSecret.

## Autenticacion con Artifact Registry

Si la URL del registry contiene `-docker.pkg.dev`, pctl la trata como Artifact Registry:

1. Obtiene token via `gcloud auth print-access-token`
2. Ejecuta `docker login -u oauth2accesstoken` con el token
3. No crea imagePullSecret

## Health checks

| `onfailure` | Kubernetes | Comportamiento |
|---|---|---|
| `restart` | livenessProbe | Si falla, Kubernetes reinicia el pod |
| `stop` | readinessProbe | Si falla, deja de recibir trafico |

## Ejemplo completo

```yaml
name: production

custom:
  project: my-gcp-project
  zone: us-central1-a
  cluster: prod-gke
  namespace: app
  ar: us-central1-docker.pkg.dev/my-gcp-project/containers

services:
  api:
    image: ./services/api/Dockerfile
    registry: ${self:custom.ar}/api
    command: "node dist/server.js"
    env:
      NODE_ENV: production
      DATABASE_URL: ${env:DATABASE_URL}
      REDIS_URL: ${env:REDIS_URL}
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
      name: gcp
      options:
        project: ${self:custom.project}
        zone: ${self:custom.zone}
        cluster: ${self:custom.cluster}
        namespace: ${self:custom.namespace}
        strategy: RollingUpdate
        serviceAccount: api-sa
        rbac:
          - resources: ["pods", "services"]
            verbs: ["get", "list"]
        storage:
          name: filestore
          id: 10.0.0.2

  worker:
    image: ./services/worker/Dockerfile
    registry: ${self:custom.ar}/worker
    env:
      NODE_ENV: production
      QUEUE_URL: ${env:QUEUE_URL}
    scale:
      replica: 3
      cpu: 512m
      memory: 1Gi
    provider:
      name: gcp
      options:
        project: ${self:custom.project}
        zone: ${self:custom.zone}
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
7. Elimina imagen de Artifact Registry (si fue construida por pctl) via `gcloud artifacts docker images delete`
8. Espera hasta 60 segundos a que los pods terminen
9. Si el namespace queda vacio, lo elimina (espera hasta 30 segundos)
10. Elimina StorageClass `filestore-sc` si se creo
