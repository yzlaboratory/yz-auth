# ADR-0006: Manage infrastructure and Porkbun DNS with Terraform

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

SES requires a verified identity, DKIM records, sending configuration, and least-privilege credentials. The chosen domains use Porkbun's authoritative DNS servers. These resources should be reproducible and reviewed as code rather than created through undocumented console changes.

## Decision

Keep Terraform configuration inside this repository under `infra/`.

Use Terraform to manage:

- The SES domain identity, Easy DKIM, custom MAIL FROM configuration, and configuration set in `eu-central-1`.
- The yz-auth SES sending IAM identity and least-privilege policy.
- Required Porkbun DNS records for SES verification, DKIM, MAIL FROM/SPF, and DMARC.
- yz-auth application DNS records when the VPS addresses are supplied as inputs.

Use the AWS provider and the community [`jianyuan/porkbun`](https://registry.terraform.io/providers/jianyuan/porkbun/latest/docs) provider, pinned to reviewed versions. Porkbun credentials will come from environment variables, with an API key restricted to DNS permission and only the required domain. API access must be enabled for that domain as a one-time Porkbun account operation.

Use an encrypted S3 remote state backend with state locking. Bootstrap the state storage separately from the main configuration. Mark secret outputs as sensitive and never commit credentials, state files, or local override files. Because IAM access-key material can appear in Terraform state, state access is restricted to the operator.

## Consequences

- SES and its DNS dependencies can be reproduced and reviewed together.
- DNS automation depends on a community Terraform provider and Porkbun API availability; provider upgrades require review and testing.
- Remote state avoids keeping the only state copy on a disposable VPS or developer machine, but adds a small AWS bootstrap step.
- Manual SES production-access approval and initial Porkbun API-key setup remain documented operator prerequisites.
