# Changelog

## 1.0.0

- Initial release
- Providers: AWS (EKS), GCP (GKE), Docker (local + SSH)
- Resolvers: env, ssm, self, cfn
- Schema validation with Zod
- Diff-based deployments with fingerprinting
- State tracking with JSON
- Health checks with onfailure and retries
- HPA auto-scaling for Kubernetes providers
- RBAC support for Kubernetes providers
- EBS/EFS storage for AWS, PD/Filestore for GCP
- Registry support: ECR, Artifact Registry, GHCR, Docker Hub
- imagePullSecret for private registries
