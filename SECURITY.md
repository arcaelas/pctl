# Security Policy for @arcaelas/pctl

## Introduction

This document outlines the security considerations, potential vulnerabilities, and best practices when using the `@arcaelas/pctl` orchestrator.

It is important to note that this tool interacts with cloud providers (AWS, GCP), container runtimes (Docker), remote servers (SSH), and container registries, making it inherently subject to external vulnerabilities that are beyond the direct control of the library's developers.

## Potential Vulnerabilities

### 1. Credential Management

- **Cloud Credentials Exposure**: AWS access keys, GCP service accounts, and registry tokens configured in YAML files or environment variables may be exposed if not properly secured.

- **Session Token Leakage**: STS temporary credentials used for EKS authentication are short-lived but could be intercepted during transmission.

- **Registry Passwords**: Docker registry credentials (GHCR, Docker Hub) are passed via stdin to avoid process list exposure, but are still present in memory during execution.

### 2. Container and Image Risks

- **Untrusted Images**: Deploying pre-built images (`nginx:latest`) without verification may introduce compromised or vulnerable software into your infrastructure.

- **Dockerfile Injection**: If the Dockerfile path is user-controlled, malicious build instructions could be executed during `docker build`.

- **Registry Poisoning**: Pushing to or pulling from compromised registries could result in deploying tampered images.

### 3. Remote Execution Risks

- **SSH Command Injection**: Commands executed on remote Docker hosts via SSH are constructed from YAML configuration. Malicious values in service names, environment variables, or commands could lead to command injection.

- **Sudo Escalation**: The `sudo: true` option grants root-level Docker access on remote servers. Misuse or compromise could affect the entire host system.

### 4. State File Risks

- **State File Exposure**: The `pctl.{name}.json` state file may contain cluster endpoints, namespace information, and resource identifiers that could aid reconnaissance.

- **State Tampering**: Modifying the state file could cause pctl to skip destroying resources or attempt to manage resources it did not create.

### 5. Kubernetes-Specific Risks

- **RBAC Over-Provisioning**: Broad RBAC rules in `provider.options.rbac` could grant excessive permissions to service accounts.

- **imagePullSecret Exposure**: Docker registry credentials stored as Kubernetes Secrets are base64-encoded, not encrypted.

- **Namespace Isolation**: Services in the same namespace can access each other's secrets and services. Use separate namespaces for isolation.

## Recommendations to Mitigate Risks

### 1. Credential Protection

- Never commit YAML files with hardcoded credentials to version control.
- Use `${env:VAR}` or `${ssm:/path}` resolvers for all sensitive values.
- Rotate AWS STS sessions and registry tokens regularly.
- Use IAM roles for EC2/ECS instead of explicit credentials when running pctl in AWS.

### 2. Container Security

- Pin image versions (`nginx:1.25.3`) instead of using `latest` tags.
- Scan Dockerfiles and images for vulnerabilities before deploying.
- Use private registries with access controls for production images.

### 3. Network and Access Control

- Restrict SSH access to deployment servers using key-based authentication only.
- Use VPCs and security groups to limit cluster access.
- Enable Kubernetes Network Policies to restrict pod-to-pod communication.

### 4. State File Protection

- Add `pctl.*.json` to `.gitignore` to prevent committing state files.
- Store state files in secure locations with restricted access.
- Verify state file integrity before running destroy operations.

### 5. Operational Security

- Review YAML configurations before deploying to production.
- Use `--name` flag to isolate test deployments from production stacks.
- Monitor cloud provider billing and resource usage for unexpected activity.
- Enable audit logging in Kubernetes clusters.

## Vulnerability Reporting Policy

### How to Report

If you discover a security vulnerability in `@arcaelas/pctl`, please report it immediately via the following channels:

- **Email**: [community@arcaelas.com](mailto:community@arcaelas.com) with the subject "[SECURITY] Vulnerability in @arcaelas/pctl"
- **GitHub**: Open a confidential issue at [https://github.com/arcaelas/pctl/security/advisories/new](https://github.com/arcaelas/pctl/security/advisories/new)

### Response Process

1. **Acknowledgment**: You will receive confirmation within 24 hours of reporting.
2. **Initial Assessment**: The security team will assess the reported issue within 72 hours.
3. **Mitigation Plan**: A plan will be created to fix the issue, and you will be informed of the expected timeline.
4. **Patch and Release**: Critical vulnerabilities will be addressed with top priority, with a target of releasing a fix within 7 days.

### Responsible Disclosure

We kindly request that you:

- Provide sufficient detail to reproduce and address the vulnerability.
- Allow reasonable time for a fix before disclosing publicly.
- Do not exploit the vulnerability to access unauthorized data or disrupt the service.

## User Responsibility

It is the responsibility of users of `@arcaelas/pctl` to implement secure and prudent practices in their deployments. This includes:

- Carefully reviewing all YAML configurations before deploying.
- Keeping dependencies and the library itself up to date.
- Implementing proper access controls for cloud providers, registries, and servers.
- Never deploying to production without testing in an isolated environment first.
- Monitoring deployed resources for unexpected behavior or cost.

---

This security policy will be updated periodically to address emerging risks and improve best practices.
**Last updated: 2026-03-19**
