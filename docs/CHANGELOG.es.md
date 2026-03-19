# Registro de Cambios

## 1.0.0

- Lanzamiento inicial
- Proveedores: AWS (EKS), GCP (GKE), Docker (local + SSH)
- Resolvers: env, ssm, self, cfn
- Validacion de schema con Zod
- Despliegues basados en diff con fingerprinting
- Rastreo de estado con JSON
- Health checks con onfailure y retries
- Auto-scaling HPA para proveedores Kubernetes
- Soporte RBAC para proveedores Kubernetes
- Almacenamiento EBS/EFS para AWS, PD/Filestore para GCP
- Soporte de registries: ECR, Artifact Registry, GHCR, Docker Hub
- imagePullSecret para registries privados
