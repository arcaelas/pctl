# CLI Reference

## Commands

### deploy

```bash
pctl deploy [-c path] [--name override]
```

Reads the config file, runs the pipeline (resolve, validate, plugins, providers), and deploys all services.

### destroy

```bash
pctl destroy [-c path] [--name override]
```

Reads the config file, runs the pipeline, and destroys all resources tracked in the state file.

## Options

| Flag | Alias | Type | Default | Description |
|---|---|---|---|---|
| `--config` | `-c` | `string` | `./pctl.yaml` | Path to the configuration file. |
| `--name` | -- | `string` | -- | Override the stack name defined in the config file. |
| `--help` | -- | -- | -- | Show help. |

## Default Behavior

When no flags are provided:

```bash
pctl deploy
```

Reads `./pctl.yaml` from the current working directory and uses the `name` field from the config.

## Name Override

```bash
pctl deploy --name staging
```

Overrides `parsed.name` regardless of what the YAML file declares. All resource names, labels, and the state file use this name.

This allows deploying the same config to multiple environments:

```bash
pctl deploy -c pctl.yaml --name production
pctl deploy -c pctl.yaml --name staging
```

Creates separate state files: `pctl.production.json` and `pctl.staging.json`.

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (schema validation, provider failure, missing options, etc.) |

All errors print to stderr via `console.error(err.message)` and exit with code 1.

## Environment Variables Used by Resolvers

| Variable | Used By | Description |
|---|---|---|
| `AWS_REGION` | `ssm`, `cfn`, `aws` provider | AWS region for SDK clients. |
| `AWS_ACCESS_KEY_ID` | `aws` provider | AWS access key (fallback when no explicit credentials). |
| `AWS_SECRET_ACCESS_KEY` | `aws` provider | AWS secret key. |
| `AWS_SESSION_TOKEN` | `aws` provider | AWS session token (optional). |

The `env` resolver reads any environment variable by name. The above are specifically required by other built-in resolvers and providers.

## Pipeline Execution Order

```
1. Parse YAML + validate against Zod schema
2. Apply --name override
3. resolve plugin    (replace ${...} expressions)
4. validate plugin   (re-validate after resolution)
5. User plugins      (from `plugin` array, in order)
6. aws provider      (if any service uses provider.name: aws)
7. docker provider   (if any service uses provider.name: docker)
8. gcp provider      (if any service uses provider.name: gcp)
```

Each step is an async function that receives the `parsed` object. The pipeline runs sequentially.

## Config File Path Resolution

The `-c` path is resolved relative to `process.cwd()`:

```bash
cd /app
pctl deploy -c infra/pctl.yaml    # Reads /app/infra/pctl.yaml
```

Dockerfile paths in `image` fields are resolved relative to the config file's directory:

```yaml
# Config at /app/infra/pctl.yaml
services:
  api:
    image: ./Dockerfile    # Resolves to /app/infra/Dockerfile
```
