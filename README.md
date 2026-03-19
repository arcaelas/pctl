![Arcaelas Insiders Banner](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/dark.svg#gh-dark-mode-only)
![Arcaelas Insiders Banner](https://raw.githubusercontent.com/arcaelas/dist/main/banner/svg/light.svg#gh-light-mode-only)

# @arcaelas/pctl

**Declarative pod orchestrator for multi-cloud container deployments.**

[![npm version](https://badge.fury.io/js/@arcaelas%2Fpctl.svg)](https://www.npmjs.com/package/@arcaelas/pctl)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Custom-orange.svg)](LICENSE)

One YAML. Multiple providers. Zero vendor lock-in.

## What is PCTL?

PCTL takes a single configuration file and deploys your containerized services to **AWS EKS**, **Google Cloud GKE**, or **Docker** (local and remote via SSH). It handles building images, pushing to registries, creating Kubernetes manifests, managing state, and cleaning up resources.

## Features

- **Declarative** - Define services, scaling, storage, and health checks in YAML
- **Multi-provider** - Deploy to AWS, GCP, or Docker from the same config
- **Resolvers** - Dynamic values with `${env:KEY}`, `${ssm:/path}`, `${cfn:export}`, `${self:path}`
- **Plugins** - Extensible pipeline for custom transformations
- **Diff-based** - Only redeploys what changed (fingerprinting)
- **State tracking** - JSON state file for clean destroy
- **Registry agnostic** - ECR, Artifact Registry, GHCR, Docker Hub
- **Auto-scaling** - HPA support for Kubernetes providers
- **RBAC** - ServiceAccount, Role, and RoleBinding management

## Quick Start

```bash
npm install -g @arcaelas/pctl
```

Create `pctl.yaml`:

```yaml
name: my-app

services:
  api:
    image: ./Dockerfile
    scale:
      replica: 1
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
    provider:
      name: docker
      options: {}
```

Deploy and destroy:

```bash
pctl deploy
pctl destroy
```

## Providers

| Provider | Target | Auth | Storage |
|---|---|---|---|
| `aws` | EKS (Kubernetes) | IAM / STS / env vars | EBS / EFS |
| `gcp` | GKE (Kubernetes) | gcloud CLI | PD / Filestore |
| `docker` | Local or SSH | Docker socket / SSH key | Docker volumes |

## Configuration

```yaml
name: my-stack

resolver: []                    # Custom resolver modules
plugin: []                      # Custom plugin modules
custom: {}                      # Reusable values store

services:
  my-service:
    image: ./Dockerfile         # or nginx:latest
    registry: ghcr.io/org/repo  # or { url, username, password }
    command: "node server.js"   # Override CMD
    env:
      NODE_ENV: production
    scale:
      replica: [2, 10]          # Auto-scaling range
      cpu: 256m
      memory: 512Mi
    ports:
      - 3000
      - "8080:3000"
    health:
      interval: 30
      command: "curl -f localhost:3000/health"
      retries: 3
      onfailure: restart        # or stop
    volumes:
      - path: /data
    provider:
      name: aws
      options:
        cluster: my-cluster
        namespace: production
```

## Documentation

Full documentation available at [https://arcaelas.github.io/pctl/](https://arcaelas.github.io/pctl/)

- [Installation](https://arcaelas.github.io/pctl/installation/)
- [Getting Started](https://arcaelas.github.io/pctl/guides/getting-started/)
- [Configuration](https://arcaelas.github.io/pctl/guides/configuration/)
- [AWS Provider](https://arcaelas.github.io/pctl/providers/aws/)
- [GCP Provider](https://arcaelas.github.io/pctl/providers/gcp/)
- [Docker Provider](https://arcaelas.github.io/pctl/providers/docker/)
- [API Reference](https://arcaelas.github.io/pctl/api/schema/)

## License

Custom License with Commercial Use Restrictions. See [LICENSE](LICENSE) for details.

**Built by [Arcaelas Insiders](https://github.com/arcaelas)**
