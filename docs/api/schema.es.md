# Referencia del Schema

Schema Zod completo de `pctl.yaml`. Definido en `src/lib/schema.ts`.

## Raiz

| Campo | Tipo Zod | Obligatorio | Default | Descripcion |
|---|---|---|---|---|
| `name` | `z.string()` | Si | - | Nombre del stack. Prefijo para labels y nombres de recursos |
| `resolver` | `z.array(z.string())` | No | `[]` | Modulos de resolvers personalizados. Se cargan despues de env, ssm, self, cfn |
| `plugin` | `z.array(z.string())` | No | `[]` | Modulos de plugins. Se ejecutan en orden en el pipeline |
| `custom` | `z.record(z.string(), z.any())` | No | `{}` | Almacen libre clave/valor. Accesible via `${self:custom.*}` |
| `services` | `z.record(z.string(), ServiceSchema)` | Si | - | Mapa de servicios |

## Service

| Campo | Tipo Zod | Obligatorio | Default | Descripcion |
|---|---|---|---|---|
| `image` | `z.string()` | Si | - | Ruta a Dockerfile (`./`) o nombre de imagen pre-construida |
| `registry` | `z.union([z.string(), RegistryObject])` | No | - | Registry para push/pull. String para URL, objeto para URL con auth |
| `command` | `z.string()` | No | - | Sobreescribe el CMD del Dockerfile |
| `env` | `z.record(z.string(), z.string())` | No | - | Variables de entorno para el contenedor |
| `scale` | `ScaleSchema` | Si | - | Escalado y recursos de computo |
| `ports` | `z.array(z.union([z.number(), z.string()]))` | No | - | Puertos a exponer |
| `health` | `HealthSchema` | No | - | Configuracion del probe de salud |
| `volumes` | `z.array(VolumeSchema)` | No | - | Puntos de montaje en el contenedor |
| `provider` | `ProviderSchema` | Si | - | Destino de despliegue |

## Registry (objeto)

| Campo | Tipo Zod | Obligatorio | Descripcion |
|---|---|---|---|
| `url` | `z.string()` | Si | URL del registry |
| `username` | `z.string()` | No | Usuario para autenticacion |
| `password` | `z.string()` | No | Contrasena o token |

## Scale

| Campo | Tipo Zod | Obligatorio | Descripcion |
|---|---|---|---|
| `replica` | `z.union([z.number().int().min(0), z.tuple([z.number().int().min(0), z.number().int().min(1)])])` | Si | Replicas fijas o rango [min, max] para HPA |
| `cpu` | `z.string()` | No | Limite de CPU (ej. `256m`, `1`) |
| `memory` | `z.string()` | No | Limite de memoria (ej. `512Mi`, `1Gi`) |

## Health

| Campo | Tipo Zod | Obligatorio | Default | Descripcion |
|---|---|---|---|---|
| `interval` | `z.number().int().min(1)` | Si | - | Segundos entre checks |
| `command` | `z.string()` | Si | - | Comando del health check |
| `retries` | `z.number().int().min(1)` | No | `3` | Fallos consecutivos antes de actuar |
| `onfailure` | `z.enum(["restart", "stop"])` | No | `"restart"` | Accion ante fallo |

## Volume

| Campo | Tipo Zod | Obligatorio | Descripcion |
|---|---|---|---|
| `path` | `z.string()` | Si | Ruta de montaje dentro del contenedor |

## Provider

| Campo | Tipo Zod | Obligatorio | Default | Descripcion |
|---|---|---|---|---|
| `name` | `z.string()` | Si | - | Identificador del driver (`aws`, `gcp`, `docker`) |
| `options` | `z.record(z.string(), z.any())` | No | `{}` | Configuracion especifica del proveedor |

## Validacion adicional

Ademas del schema Zod, el plugin `validate` verifica:

- Si `scale.replica` es un array `[min, max]`, `min` no puede ser mayor que `max`

```
Error: Service "api": scale.replica min (5) cannot exceed max (3)
```

## Schema como codigo

```typescript
import { z } from 'zod';

export default z.object({
    name: z.string(),
    resolver: z.array(z.string()).default([]),
    plugin: z.array(z.string()).default([]),
    custom: z.record(z.string(), z.any()).default({}),
    services: z.record(z.string(), z.object({
        image: z.string(),
        registry: z.union([
            z.string(),
            z.object({
                url: z.string(),
                username: z.string().optional(),
                password: z.string().optional(),
            }),
        ]).optional(),
        command: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        scale: z.object({
            replica: z.union([
                z.number().int().min(0),
                z.tuple([z.number().int().min(0), z.number().int().min(1)])
            ]),
            cpu: z.string().optional(),
            memory: z.string().optional(),
        }),
        ports: z.array(z.union([z.number(), z.string()])).optional(),
        health: z.object({
            interval: z.number().int().min(1),
            command: z.string(),
            retries: z.number().int().min(1).default(3),
            onfailure: z.enum(['restart', 'stop']).default('restart'),
        }).optional(),
        volumes: z.array(z.object({
            path: z.string(),
        })).optional(),
        provider: z.object({
            name: z.string(),
            options: z.record(z.string(), z.any()).default({}),
        }),
    })),
});
```
