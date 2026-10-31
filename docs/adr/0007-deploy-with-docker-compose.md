# ADR-0007: Deploy with Docker Compose

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The initial production target is one Hetzner VPS. The workload does not currently justify Kubernetes, multiple application nodes, or a separate managed database. We nevertheless need reproducible services, TLS, persistent data, and a straightforward upgrade path.

## Decision

Deploy with **Docker Compose** on the VPS:

- `yz-auth`: the TypeScript application and minimal hosted authentication UI.
- `postgres`: PostgreSQL with a persistent volume, reachable only on the private Compose network.
- `caddy`: the public HTTPS reverse proxy with automated certificate issuance and renewal.

Only Caddy exposes public HTTP/HTTPS ports; PostgreSQL and the application are not directly public. SSH remains separately restricted for VPS administration and CLI access. Run database migrations as a controlled deployment step rather than allowing unconstrained concurrent schema changes.

Use health checks, restart policies, resource limits appropriate to the VPS, persistent volumes, and pinned application images. Establish automated PostgreSQL backups, offsite backup copies, and a tested restore procedure before production use. Local development will use the same container boundaries where practical, with a catch-all email service replacing SES.

## Consequences

- Deployment remains understandable and operable by one person.
- Caddy centralizes public TLS and proxy configuration.
- A single VPS and PostgreSQL instance are deliberate single points of failure. High availability and horizontal scaling require a later design.
- Backups and VPS patching remain essential operational responsibilities even with containers.
