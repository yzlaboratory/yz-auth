# yz-auth

yz-auth is a self-hosted, multi-tenant OpenID Connect authentication service for independent SaaS products. Each SaaS is an isolated tenant with separate accounts, clients, signing keys, issuer URLs, and hosted authentication pages.

## Included

- Email/password signup with mandatory email verification.
- Login, consent, logout, authorization code + PKCE, refresh-token rotation, UserInfo, introspection, and revocation.
- Five-minute RFC 9068 JWT access tokens for explicitly registered API resource URIs.
- Forgot-password workflow with hashed, expiring, single-use tokens and session/grant revocation.
- VPS-only tenant/client administration CLI.
- PostgreSQL-backed OIDC state and transactional email outbox.
- AWS SES delivery in production and Mailpit in development.
- Terraform for SES, IAM, Porkbun DNS, and remote state.
- Docker Compose deployment behind the shared Traefik proxy, with PostgreSQL.

Architectural decisions and deferred scope are recorded in [`docs/adr/`](docs/adr/README.md).

## Development setup

Requirements: Node.js 22 or newer and Docker Compose.

```sh
npm ci
cp .env.example .env
npm run cli -- secrets generate
```

Copy the generated `cookieKey` and `encryptionKey` into `COOKIE_KEYS` and `KEY_ENCRYPTION_KEY` in `.env`, then start PostgreSQL and Mailpit:

```sh
docker compose -f compose.dev.yaml up -d
npm run cli -- db migrate
npm run dev
```

The application listens on `http://localhost:3000`. Mailpit is available at `http://localhost:8025` and accepts SMTP on port 1025.

Create a tenant:

```sh
npm run cli -- tenants create --slug acme --name "Acme"
```

Register a public OIDC client:

```sh
npm run cli -- clients create \
  --tenant acme \
  --name "Acme Web" \
  --redirect-uri http://localhost:5173/callback \
  --post-logout-redirect-uri http://localhost:5173 \
  --resource-uri http://localhost:4000 \
  --public
```

The client ID is printed as JSON. Confidential clients omit `--public` and print their secret only through the deliberate creation/rotation output. Redirect and resource URIs must use HTTPS except on loopback hosts.

Other administration commands:

```sh
npm run cli -- tenants list
npm run cli -- tenants disable --slug acme
npm run cli -- clients list --tenant acme
npm run cli -- clients disable --tenant acme --client-id <client-id>
npm run cli -- clients rotate-secret --tenant acme --client-id <client-id>
```

On the VPS, invoke the same CLI through the application container, for example:

```sh
docker compose exec yz-auth node dist/cli.js tenants list
```

## OIDC integration

Tenant discovery is available at:

```text
http://localhost:3000/t/acme/.well-known/openid-configuration
```

Use any compliant OIDC client in the consuming SaaS language. Use Authorization Code Flow with PKCE S256. Do not send passwords to the SaaS backend.

Requested scopes can include `openid`, `profile`, `email`, `offline_access`, and `api`. Request `offline_access` together with `prompt=consent` when refresh tokens are needed. To receive a JWT access token for an API, send the exact registered resource URI in the `resource` authorization parameter. Resource servers must validate `typ: at+jwt`, signature, issuer, audience, and expiry.

Hosted account pages are available under the tenant namespace:

```text
/t/acme/signup
/t/acme/resend-verification
/t/acme/forgot-password
```

Login and consent pages are entered through the OIDC authorization flow.

## Checks

```sh
npm run check
npm test
npm audit
```

The integration suite requires a running disposable PostgreSQL database:

```sh
docker compose -f compose.dev.yaml up -d postgres
TEST_DATABASE_URL=postgres://yz_auth:yz_auth@localhost:5432/yz_auth npm run test:integration
```

**The integration suite truncates its configured database. Never point `TEST_DATABASE_URL` at a database containing data you need.**

## Container images

Every successful CI run on `main` builds and publishes the application image to GitHub Container Registry as `ghcr.io/<owner>/yz-auth`, tagged `latest`, `main`, and `sha-<commit>`. Pull requests build the same image without pushing it. Set the `DOCKER_PLATFORMS` repository variable to change the target platforms; the default is `linux/amd64`.

## Production

1. Provision and verify SES/DNS using [`infra/README.md`](infra/README.md). SES production access, AWS/Porkbun credentials, domain values, and the initial state-bucket bootstrap are operator tasks.
2. Copy `.env.production.example` to `.env` on the VPS and replace every secret and domain value. Use the SES outputs from Terraform.
3. Restrict SSH and ensure the VPS has current security updates. Back up `.env` and encryption keys securely; losing `KEY_ENCRYPTION_KEY` makes stored signing keys and client secrets unreadable.
4. Deploy with the `Deploy` GitHub Actions workflow. It calls the reusable workflow in `yz-infra`, pulls the pinned `sha-<7>` image from GHCR, and runs `docker compose up -d --remove-orphans --wait`.

For a manual deploy, set the image explicitly:

```sh
IMAGE_REF=ghcr.io/yzlaboratory/yz-auth:sha-<7> docker compose up -d --remove-orphans
```

Traefik terminates HTTPS for `DOMAIN` through the external `proxy` network and Docker labels. Only Traefik publishes ports 80 and 443; PostgreSQL and yz-auth remain on the private Compose network. Migrations run as a one-shot Compose dependency before application startup. Use a URI-encoded password in `DATABASE_URL`.

The repository's `backup.sh` writes a consistent PostgreSQL dump into the app directory; the host restic job includes it in the encrypted off-box backup. A single VPS is deliberately a single point of failure.
