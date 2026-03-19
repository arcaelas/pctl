# CLI

## Comandos

### deploy

Construye imagenes, sube a registries y despliega servicios a los proveedores configurados.

```bash
pctl deploy [-c path] [--name override]
```

### destroy

Elimina todos los recursos creados por pctl segun el archivo de estado.

```bash
pctl destroy [-c path] [--name override]
```

## Opciones

| Opcion | Alias | Tipo | Default | Descripcion |
|---|---|---|---|---|
| `--config` | `-c` | `string` | `./pctl.yaml` | Ruta al archivo de configuracion |
| `--name` | - | `string` | - | Sobreescribe el nombre del stack definido en el YAML |
| `--help` | - | - | - | Muestra la ayuda |

## Archivo de configuracion por defecto

Si no se especifica `--config`, pctl busca `./pctl.yaml` en el directorio actual.

```bash
# Estos dos son equivalentes
pctl deploy
pctl deploy -c ./pctl.yaml
```

## Sobreescritura de nombre

`--name` sobreescribe el campo `name` del YAML. Util para desplegar el mismo archivo con nombres distintos (staging, production):

```bash
pctl deploy -c pctl.yaml --name staging
pctl deploy -c pctl.yaml --name production
```

Esto genera archivos de estado separados: `pctl.staging.json` y `pctl.production.json`.

## Codigos de salida

| Codigo | Significado |
|---|---|
| `0` | Operacion completada exitosamente |
| `1` | Error. El mensaje se imprime en stderr |

Errores comunes:

```bash
# Archivo de configuracion no encontrado
Error: ENOENT: no such file or directory, open './pctl.yaml'

# Schema invalido
Error: Schema validation failed:
  - services.api.scale.replica: Expected number, received string

# Opciones de proveedor faltantes
Error: [aws] service "api" missing required options (cluster, namespace)

# Resolver no encontrado
Error: Resolver "vault" not found

# Conflicto de replicas
Error: Service "api": scale.replica min (5) cannot exceed max (3)
```

## Variables de entorno

Variables usadas por los resolvers y proveedores integrados:

| Variable | Usada por | Descripcion |
|---|---|---|
| `AWS_REGION` | ssm, cfn, aws | Region AWS para clientes SDK |
| `AWS_ACCESS_KEY_ID` | aws | Credenciales AWS (si no se definen en options) |
| `AWS_SECRET_ACCESS_KEY` | aws | Credenciales AWS |
| `AWS_SESSION_TOKEN` | aws | Token de sesion (credenciales temporales) |

Las variables de entorno tambien son accesibles en el YAML via `${env:VARIABLE}`.

## Pipeline de ejecucion

El CLI ejecuta los siguientes pasos en orden:

1. Parsear argumentos con yargs
2. Leer y parsear el archivo YAML
3. Validar con el schema Zod
4. Aplicar `--name` si se proporciono
5. Ejecutar pipeline: `resolve` → `validate` → plugins del usuario → `aws` → `docker` → `gcp`

Cada paso del pipeline recibe el objeto `parsed` y puede mutarlo. Los proveedores detectan el comando (`deploy`/`destroy`) de los argumentos del proceso.
