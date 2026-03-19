# Schema Reference

The configuration schema is defined with Zod in `src/lib/schema.ts`. The YAML file is parsed and validated against this schema.

## Top-Level Schema

| Field | Zod Type | Required | Default | Description |
|---|---|:---:|---|---|
| `name` | `z.string()` | Yes | -- | Stack name. Used as prefix for all service labels and resource names. |
| `resolver` | `z.array(z.string())` | No | `[]` | Custom resolver module paths loaded after built-in resolvers (env, ssm, self, cfn). |
| `plugin` | `z.array(z.string())` | No | `[]` | Pipeline of plugins executed in order. Each entry is a module path. |
| `custom` | `z.record(z.string(), z.any())` | No | `{}` | Free-form key/value store for reusable values. Accessible via `${self:custom.*}`. |
| `services` | `z.record(z.string(), ServiceSchema)` | Yes | -- | Map of service names to their configuration. |

## Service Schema

| Field | Zod Type | Required | Default | Description |
|---|---|:---:|---|---|
| `image` | `z.string()` | Yes | -- | Path to Dockerfile (`./` prefix) for build+push, or pre-built image name for pull only. |
| `registry` | `z.union([z.string(), RegistryObject])` | No | -- | Container registry for push/pull. String for URL only, object for URL with auth. |
| `command` | `z.string()` | No | -- | Override the CMD of the Dockerfile. Shell form string. |
| `env` | `z.record(z.string(), z.string())` | No | -- | Key/value environment variables passed to the container. |
| `scale` | `ScaleSchema` | Yes | -- | Scaling and compute resources for the service. |
| `ports` | `z.array(z.union([z.number(), z.string()]))` | No | -- | Ports to expose. Number (3000) or host:container mapping ("8080:3000"). |
| `health` | `HealthSchema` | No | -- | Liveness probe configuration. |
| `volumes` | `z.array(VolumeSchema)` | No | -- | Mount points inside the container. |
| `provider` | `ProviderSchema` | Yes | -- | Deployment target for this service. |

## Registry Schema

String form:

```
z.string()  ->  "ghcr.io/myorg/api"
```

Object form:

| Field | Zod Type | Required | Description |
|---|---|:---:|---|
| `url` | `z.string()` | Yes | Registry URL (e.g. `ghcr.io/user/repo`, `507738...ecr.../pool`). |
| `username` | `z.string()` | No | Registry username for authentication. |
| `password` | `z.string()` | No | Registry password or token for authentication. |

## Scale Schema

| Field | Zod Type | Required | Default | Description |
|---|---|:---:|---|---|
| `replica` | `z.union([z.number().int().min(0), z.tuple([z.number().int().min(0), z.number().int().min(1)])])` | Yes | -- | Fixed count or `[min, max]` auto-scale range. |
| `cpu` | `z.string()` | No | -- | CPU limit (e.g. `256m`, `1`). |
| `memory` | `z.string()` | No | -- | Memory limit (e.g. `512Mi`, `1Gi`). |

Validation: when `replica` is `[min, max]`, min must not exceed max. This is enforced by the validate plugin.

## Health Schema

| Field | Zod Type | Required | Default | Description |
|---|---|:---:|---|---|
| `interval` | `z.number().int().min(1)` | Yes | -- | Seconds between health checks. |
| `command` | `z.string()` | Yes | -- | Command executed inside the container. Non-zero exit code marks unhealthy. |
| `retries` | `z.number().int().min(1)` | No | `3` | Consecutive failures before triggering onfailure action. |
| `onfailure` | `z.enum(['restart', 'stop'])` | No | `"restart"` | Action on health check failure. |

## Volume Schema

| Field | Zod Type | Required | Description |
|---|---|:---:|---|
| `path` | `z.string()` | Yes | Mount path inside the container. |

## Provider Schema

| Field | Zod Type | Required | Default | Description |
|---|---|:---:|---|---|
| `name` | `z.string()` | Yes | -- | Driver identifier (`aws`, `docker`, `gcp`). |
| `options` | `z.record(z.string(), z.any())` | No | `{}` | Provider-specific configuration. |

## Validation Plugin

After resolver processing, the validate plugin runs `schema.safeParse(parsed)`. If validation fails, it throws with a formatted error listing all issues:

```
Schema validation failed:
  - services.api.scale.replica: Expected number, received string
  - services.api.ports.0: Expected number or string
```

Additionally, it checks that `scale.replica` tuples have `min <= max`:

```
Service "api": scale.replica min (5) cannot exceed max (3)
```
