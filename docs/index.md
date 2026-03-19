# PCTL

Declarative pod orchestrator for multi-cloud container deployments.

Define your services in a single YAML file and deploy to AWS EKS, Google Cloud GKE, or Docker (local and remote) with one command.

## Features

- **Declarative** - Define services, scaling, storage, and health checks in YAML
- **Multi-provider** - Deploy to AWS, GCP, or Docker from the same config
- **Resolvers** - Dynamic values with `${env:KEY}`, `${ssm:/path}`, `${cfn:export}`, `${self:path}`
- **Plugins** - Extensible pipeline for custom transformations
- **Diff-based** - Only redeploys what changed
- **State tracking** - JSON state file for clean destroy
- **Registry agnostic** - ECR, Artifact Registry, GHCR, Docker Hub

## Quick Start

```bash
npm install -g @arcaelas/pctl
pctl deploy -c pctl.yaml
pctl destroy -c pctl.yaml
```
