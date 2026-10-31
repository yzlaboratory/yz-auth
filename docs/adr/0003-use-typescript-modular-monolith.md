# ADR-0003: Use a TypeScript modular monolith

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The availability of a capable Node.js OIDC provider makes TypeScript a suitable implementation language. The first version has a small functional scope and will run on one VPS, so distributed services would add operational cost without solving a current scaling problem. OIDC also requires browser interaction pages even when no administration dashboard is desired.

## Decision

Build yz-auth as a **TypeScript modular monolith on Node.js**, with PostgreSQL as its system of record.

Keep clear internal module boundaries for:

- Tenants and OIDC clients.
- Accounts and credentials.
- Email verification and password recovery.
- OIDC persistence and signing-key management.
- Browser sessions and authentication interactions.
- Transactional email delivery.
- Audit events and administrative commands.

Host a small, same-origin web UI within yz-auth for tenant-scoped signup, login, email verification, password recovery, and OIDC consent/interaction pages. No hosted administration dashboard will be built initially. These pages are part of the trusted authentication boundary; they are not a general-purpose frontend platform.

Use PostgreSQL for account data, OIDC adapter state, sessions, one-time-token records, and audit data. Do not introduce microservices, a separate cache, or a message broker until a measured requirement justifies them.

## Consequences

- One deployable application and one database keep local development and VPS operation straightforward.
- Internal modules can be tested independently and extracted later if a real scaling boundary emerges.
- Hosting the authentication pages keeps passwords within yz-auth and permits standard OIDC redirects.
- A single process and database are initially scaling and availability limits, accepted for the first version.
