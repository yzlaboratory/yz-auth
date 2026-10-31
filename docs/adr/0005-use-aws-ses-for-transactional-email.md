# ADR-0005: Use AWS SES for transactional email

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Signup verification and password recovery require reliable transactional email. Operating an SMTP server directly on the Hetzner VPS would make IP reputation and deliverability our responsibility. AWS SES has been selected as the provider, with European processing preferred but not treated as a broader compliance certification.

## Decision

Use **Amazon SES in `eu-central-1` (Frankfurt)** through the SES v2 API and the AWS SDK for JavaScript.

- Verify one shared sending identity with Easy DKIM and configure a custom MAIL FROM domain and DMARC.
- Send from a shared yz-auth address on a transactional sending subdomain, such as `no-reply@mail.example.com`.
- Insert the tenant's display name and tenant-scoped verification/reset links into shared templates. Do not support per-tenant sender domains or custom templates initially.
- Disable open and click tracking for authentication emails; password and verification links do not need marketing analytics.
- Use a dedicated IAM identity for yz-auth with only the SES permissions and resources required to send through the configured identity.
- Keep email delivery behind a small internal module so provider-specific behavior does not leak into account workflows.

Requesting SES production access and moving out of the SES sandbox is an operator task; Terraform cannot substitute for that AWS review. Local development should use a catch-all mailbox rather than sending real email.

## Consequences

- yz-auth avoids self-hosting mail delivery while keeping email processing in the selected AWS region.
- A shared identity minimizes cost and DNS work but also means tenants share sender reputation.
- SES sandbox restrictions apply until production access is approved.
- The VPS needs AWS credentials because Hetzner cannot provide an AWS instance role. Credential storage and rotation become deployment responsibilities.
