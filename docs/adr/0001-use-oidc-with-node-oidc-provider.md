# ADR-0001: Use OIDC with `node-oidc-provider`

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

yz-auth will authenticate users for multiple independently developed SaaS products. Those products may use different programming languages, so authentication cannot depend on a shared TypeScript library or direct database access. We need a standard protocol and a maintained server implementation rather than custom token cryptography.

## Decision

Use yz-auth as an **OpenID Connect (OIDC) provider and OAuth 2.0 authorization server**, built into the TypeScript backend with [`panva/node-oidc-provider`](https://github.com/panva/node-oidc-provider). Pin and review the library version during implementation.

Integrations will use:

- Authorization Code Flow with PKCE for browser and native applications.
- Standard discovery, authorization, token, JWKS, UserInfo, revocation, and introspection endpoints where applicable.
- Short-lived, audience-restricted signed access tokens, with public verification keys exposed through JWKS.
- Rotating refresh tokens when a client requires offline renewal.

Implicit flow and Resource Owner Password Credentials flow will not be offered. SaaS products will integrate over language-neutral HTTP/OIDC endpoints and may use any compliant client library. They will not call a custom REST login endpoint or send user passwords through their own backends.

The library provides protocol primitives, not the complete account system. yz-auth remains responsible for accounts, tenant resolution, persistence adapters, hosted interactions, key management, and secure configuration.

## Consequences

- Consumers can integrate from any language without a yz-auth-specific SDK.
- Protocol conformance and security-sensitive token handling build on an OpenID Certified, MIT-licensed implementation.
- Using the library correctly still requires OIDC expertise, conformance tests, secure defaults, and dependency updates.
- Resource servers can validate short-lived tokens locally through JWKS. Already-issued JWTs are not instantly revocable, so token lifetime and grant revocation must be considered together.

## References

- [`node-oidc-provider` repository and certification](https://github.com/panva/node-oidc-provider)
- [OpenID Foundation certified implementations](https://openid.net/certification/certified-openid-connect-implementations/)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700)
