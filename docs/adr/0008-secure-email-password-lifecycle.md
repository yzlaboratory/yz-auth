# ADR-0008: Secure the email/password lifecycle

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The first user-facing scope is tenant-scoped signup, login, and forgotten-password recovery. These workflows are common targets for credential attacks and account enumeration. Email ownership must be established before an account can authenticate.

## Decision

Implement the following lifecycle uniformly for every tenant:

- Hash passwords with **Argon2id**, using reviewed parameters and a versioned hash format that permits future rehashing.
- Require email verification before login or token issuance. Verification links are tenant-scoped and expire after a bounded period.
- Generate verification and password-reset tokens with a cryptographically secure random generator. Store only hashes of these bearer tokens and enforce single use and expiry.
- Return generic forgot-password responses whether or not the email is registered, and avoid materially different timing or side channels between the two cases.
- Invalidate the used token and revoke the account's browser sessions and OIDC grants/refresh tokens after a successful password reset. Short access-token lifetimes bound the use of already-issued JWTs.
- Rate-limit signup, login, verification resend, and recovery attempts using tenant, account, and network signals where applicable. Add audit events without logging passwords, raw tokens, or secret-bearing URLs.
- Send security emails through yz-auth's shared SES sender with links pointing only to validated yz-auth tenant URLs.

Social login, MFA, passkeys, and organization/role workflows are deferred. Their later addition must preserve these account and tenant invariants.

## Consequences

- Verification establishes control of the mailbox before credentials can be used.
- Hashed, expiring, single-use recovery tokens reduce the impact of database disclosure and token replay.
- Password reset cannot instantly invalidate an already-issued self-contained access token; this residual window is controlled by short token lifetimes.
- Rate limits and generic responses require automated tests to ensure new workflows do not reintroduce enumeration or abuse paths.
