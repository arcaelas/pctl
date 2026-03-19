# Installation

```bash
npm install -g @arcaelas/pctl
```

## Requirements

| Dependency | Required | Purpose |
|---|:---:|---|
| Node.js 20+ | Yes | Runtime |
| Docker | Yes | Build and run containers |
| AWS CLI | No | Only for AWS EKS provider |
| gcloud CLI | No | Only for GCP GKE provider |
| SSH access | No | Only for remote Docker provider |

## Verify Installation

```bash
pctl --help
```

Expected output:

```
Options:
  --config, -c  Path to the configuration file    [string] [default: "./pctl.yaml"]
  --name        Override the stack name defined in the config file       [string]
  --help        Show help                                              [boolean]
```

## First Deploy

Create `pctl.yaml`:

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

Deploy and verify:

```bash
pctl deploy
docker ps  # nginx running on port 8080
pctl destroy
```
