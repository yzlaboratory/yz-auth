# ADR-0004: Use a VPS-only administrative CLI

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Only the yz-auth operator will create and manage tenants and OIDC clients initially. A protected administrative REST API would require a separate authentication and bootstrap mechanism, increasing both implementation work and public attack surface. The operator already requires SSH access to administer the VPS.

## Decision

Provide a **local administrative CLI**, executed only on the yz-auth VPS, for tenant and client lifecycle operations.

- SSH access to the VPS is the administrative security boundary.
- Run the CLI inside the application container or as an equivalent one-off Compose command.
- Invoke application services and invariants from the CLI; do not implement it as independent SQL statements against the database.
- Support creating, inspecting, disabling, and rotating credentials for tenants and OIDC clients as the feature set requires.
- Display newly generated client credentials only through deliberate, sensitive CLI output and never log them.
- Do not expose an administrative HTTP API, public dynamic client registration, or a web administration dashboard in the first version.

Example invocation shape (the final command names are an implementation detail):

```sh
docker compose exec yz-auth cli tenants create --slug acme --name "Acme"
```

## Consequences

- No additional administrator identity system or public admin endpoint is needed.
- Administration can reuse the same validation and persistence code as the service.
- SSH access already implies broad control of the deployment and must therefore be secured and audited operationally.
- Remote administration requires SSH, and third-party automation cannot manage tenants without later introducing a deliberately protected API.
