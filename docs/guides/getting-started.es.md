# Primeros Pasos

## Servicio minimo con Docker local

Crea un archivo `pctl.yaml` en el directorio de tu proyecto:

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

### Campos explicados

| Campo | Descripcion |
|---|---|
| `name` | Nombre del stack. Se usa como prefijo para nombres de contenedores y labels (`my-app-api`) |
| `services` | Mapa de servicios. Cada clave es el nombre del servicio |
| `image` | Imagen Docker. Puede ser una imagen pre-construida (`node:20-alpine`) o una ruta a un Dockerfile (`./Dockerfile`) |
| `command` | Sobreescribe el CMD del contenedor. Se ejecuta como `sh -c "node server.js"` |
| `scale.replica` | Numero de instancias. Entero para replicas fijas, tupla `[min, max]` para auto-scaling |
| `ports` | Puertos a exponer. Numero (`3000`) o mapeo host:container (`"8080:3000"`) |
| `provider.name` | Driver de despliegue: `aws`, `gcp` o `docker` |

## Desplegar

```bash
pctl deploy
```

Salida:

```
[docker] started "my-app-api"
[docker] deployed "my-app-api" (1 replica)
```

## Verificar contenedores

```bash
docker ps --filter label=pctl-stack=my-app
```

```
CONTAINER ID  IMAGE            COMMAND              STATUS    PORTS                   NAMES
a1b2c3d4e5f6  node:20-alpine   "sh -c node serve…"  Up 10s   0.0.0.0:3000->3000/tcp  my-app-api
```

## Destruir

```bash
pctl destroy
```

Salida:

```
[docker] destroyed "my-app-api"
```

## Archivo de estado

Despues de cada despliegue, pctl genera un archivo `pctl.my-app.json` en el directorio actual:

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
    "fingerprint": "a1b2c3...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": false
  }
}
```

El archivo de estado rastrea cada recurso creado. Se usa para:

- **Diff**: comparar fingerprints y saltar servicios sin cambios
- **Destroy**: saber que recursos eliminar
- **Limpieza**: detectar servicios removidos de la configuracion y eliminarlos automaticamente

## Siguiente paso

- [Configuracion](configuration.es.md) - Todos los campos del YAML
- [Proveedores](../providers/overview.es.md) - AWS, GCP y Docker en detalle
- [Resolvers](resolvers.es.md) - Variables dinamicas en la configuracion
