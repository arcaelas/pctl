# Proveedores

## Que es un proveedor

Un proveedor es la capa que ejecuta el deploy o destroy de los servicios hacia una plataforma destino. Cada servicio en `pctl.yaml` declara su proveedor en `provider.name`.

```yaml
services:
  api:
    provider:
      name: aws       # aws | gcp | docker
      options:
        cluster: prod
        namespace: app
```

## Proveedores integrados

| Proveedor | Plataforma | Descripcion |
|---|---|---|
| `aws` | AWS EKS | Kubernetes en Amazon. Deployment, Service, HPA, RBAC, PVC, imagePullSecret |
| `gcp` | GCP GKE | Kubernetes en Google Cloud. Deployment, Service, HPA, RBAC, PVC, imagePullSecret |
| `docker` | Docker local/SSH | Contenedores Docker en la maquina local o servidor remoto via SSH |

## Deteccion de servicios

Cada proveedor filtra servicios por `provider.name`. Un stack puede mezclar proveedores:

```yaml
services:
  api:
    provider:
      name: aws
      options: { ... }
  worker:
    provider:
      name: aws
      options: { ... }
  monitoring:
    provider:
      name: docker
```

En este caso, el proveedor AWS procesa `api` y `worker`. El proveedor Docker procesa `monitoring`. GCP no procesa nada.

## Archivo de estado

Despues de cada operacion, pctl escribe un archivo `pctl.{name}.json` en el directorio actual:

```bash
# Para un stack llamado "my-app"
pctl.my-app.json
```

Contenido:

```json
{
  "my-app-api": {
    "provider": "aws",
    "cluster": "prod",
    "namespace": "app",
    "registryUrl": "507738...ecr.../api",
    "image": "507738...ecr.../api:1710234567890",
    "labels": {
      "managed-by": "pctl",
      "pctl-stack": "my-app",
      "pctl-service": "my-app-api"
    },
    "fingerprint": "a1b2c3d4e5...",
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

El estado registra los recursos creados y sus flags. Se usa para:

- Saber que eliminar en `destroy`
- Detectar servicios removidos de la configuracion
- Calcular diffs para evitar redespliegues innecesarios

## Fingerprint y diff

Cada servicio genera un fingerprint SHA-256 basado en:

- Toda la configuracion del servicio (excluyendo `provider`)
- Hash MD5 del Dockerfile (si `image` empieza con `./`)

Si el fingerprint no cambio desde el ultimo despliegue, el servicio se omite:

```
[aws] "my-app-api" unchanged, skipping
```

Esto evita reconstruir imagenes, subir a registries y aplicar manifiestos Kubernetes cuando nada cambio.

## Labels

Todos los recursos creados por pctl llevan tres labels:

| Label | Valor | Ejemplo |
|---|---|---|
| `managed-by` | `pctl` | `pctl` |
| `pctl-stack` | `{name}` | `my-app` |
| `pctl-service` | `{name}-{service}` | `my-app-api` |

Los labels se usan para:

- Filtrar recursos en `kubectl` o `docker ps`
- Identificar pods durante la espera de terminacion en destroy
- Asegurar que pctl solo toca recursos que el creo

## Flujo de deploy

1. Leer estado previo de `pctl.{name}.json`
2. Para cada servicio del proveedor:
    - Calcular fingerprint
    - Comparar con estado previo → omitir si no cambio
    - Construir imagen si es Dockerfile
    - Subir a registry si aplica
    - Crear/actualizar recursos (Deployment, Service, HPA, etc.)
    - Guardar nuevo estado
3. Detectar servicios en el estado previo que ya no estan en la configuracion → eliminarlos
4. Escribir estado final

## Flujo de destroy

1. Leer estado de `pctl.{name}.json`
2. Para cada servicio del proveedor:
    - Eliminar todos los recursos asociados
    - Esperar terminacion de pods/contenedores
3. Limpiar namespaces vacios (Kubernetes)
4. Marcar servicios como `destroyed` en el estado
