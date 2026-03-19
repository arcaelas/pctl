# Instalacion

```bash
npm install -g @arcaelas/pctl
```

## Requisitos

- **Node.js 20+** - Runtime requerido
- **Docker** - Para construir y ejecutar imagenes
- **AWS CLI** (opcional) - Requerido para el proveedor AWS. Credenciales configuradas via `aws configure` o variables de entorno
- **gcloud CLI** (opcional) - Requerido para el proveedor GCP. Autenticado via `gcloud auth login`
- **SSH** (opcional) - Requerido para despliegues remotos con el proveedor Docker

## Verificar instalacion

```bash
pctl --help
```

Salida esperada:

```
Options:
  --config, -c  Path to the configuration file    [string] [default: "./pctl.yaml"]
  --name        Override the stack name defined in the config file        [string]
  --help        Show help                                               [boolean]
```

## Primer despliegue

Crea un archivo `pctl.yaml`:

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

Despliega:

```bash
pctl deploy
```

Verifica:

```bash
docker ps --filter label=pctl-stack=hello
```

Destruye:

```bash
pctl destroy
```
