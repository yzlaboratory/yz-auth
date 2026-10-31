# ADR-0002: Isolate identities by SaaS tenant

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

yz-auth is central infrastructure for several SaaS products, but each product needs its own isolated user population. The word *tenant* must not be conflated with either an OAuth client or a customer organization inside a SaaS product. We also need to decide whether the same email address represents one person globally or separate accounts per product.

## Decision

In the first version, **one tenant represents one SaaS product**.

- Each tenant has its own accounts, authentication configuration, hosted interaction namespace, and OIDC issuer URL, for example `https://auth.example.com/t/acme`.
- A tenant may have multiple registered OIDC clients, such as production, staging, web, or native clients. Every client belongs to exactly one tenant.
- Accounts are tenant-scoped. Email uniqueness is enforced on `(tenant_id, normalized_email)`, so the same email may represent unrelated accounts in different tenants.
- There is no shared global identity, tenant membership model, or cross-SaaS SSO session in the first version.
- Tenant-owned rows carry `tenant_id`. Database uniqueness and foreign-key constraints, together with tenant-scoped data access, enforce isolation rather than relying only on UI or controller checks.
- Tenant context is resolved from the issuer and registered client configuration. Token validators must check `iss`, `aud`, signature, and expiry; a caller-supplied tenant claim alone never establishes tenant context.

Tenants and clients will share the yz-auth deployment and PostgreSQL database; separate databases or deployments per tenant are not initially required. Customer organizations and application authorization roles remain the responsibility of each SaaS and are deferred.

## Consequences

- Account and session boundaries are easy to reason about, and the same person can use different credentials in different products.
- Per-tenant issuer URLs give clients an unambiguous discovery and validation context.
- Sharing an identity or enabling SSO later will require an explicit identity-linking design and a superseding ADR.
- Isolation is logical rather than physical. All tenant-scoped repositories, OIDC adapters, background jobs, and tests must preserve the boundary.
