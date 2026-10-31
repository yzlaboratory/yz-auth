# Architecture Decision Records

This directory records the architectural decisions for yz-auth. ADRs are immutable once accepted; changing a decision requires a new ADR that supersedes the earlier one.

| ADR | Decision |
| --- | --- |
| [0001](0001-use-oidc-with-node-oidc-provider.md) | Use OIDC with `node-oidc-provider` |
| [0002](0002-isolate-identities-by-saas-tenant.md) | Isolate identities by SaaS tenant |
| [0003](0003-use-typescript-modular-monolith.md) | Use a TypeScript modular monolith |
| [0004](0004-use-vps-only-administrative-cli.md) | Use a VPS-only administrative CLI |
| [0005](0005-use-aws-ses-for-transactional-email.md) | Use AWS SES for transactional email |
| [0006](0006-manage-infrastructure-and-dns-with-terraform.md) | Manage infrastructure and Porkbun DNS with Terraform |
| [0007](0007-deploy-with-docker-compose.md) | Deploy with Docker Compose |
| [0008](0008-secure-email-password-lifecycle.md) | Secure the email/password lifecycle |

## Initially deferred

The following are intentionally outside the first version:

- Cross-tenant identities and cross-SaaS SSO.
- Customer organizations within a tenant and application-level RBAC.
- Social login, MFA, and passkeys.
- A web-based administration dashboard.
- Public administrative APIs and dynamic client registration.
- Per-tenant sender domains and custom email templates.
- Multi-node deployment and high availability.
