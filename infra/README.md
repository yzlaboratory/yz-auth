# yz-auth infrastructure

This directory contains two independent Terraform root modules:

- `bootstrap/` creates the versioned, encrypted, private S3 bucket used for Terraform state.
- The root `infra/` module manages SESv2, runtime IAM identities, encrypted PostgreSQL backup storage, and Porkbun DNS in `eu-central-1`.

The main module uses an S3 backend with server-side encryption and native S3 lockfiles. It does not require DynamoDB. The bootstrap module uses local state so that the state bucket does not depend on itself.

## Managed resources

The main module manages:

- A domain SESv2 identity with Easy DKIM and RSA 2048-bit keys.
- Three DKIM CNAME records.
- A dedicated `bounce.<mail-subdomain>.<dns-zone>` MAIL FROM domain with one MX record and one SPF TXT record.
- A DMARC TXT record for the sending domain.
- A configuration set with sending enabled, VDM engagement metrics disabled, no custom tracking domain, and no open/click event destinations.
- An IAM user, policy, policy attachment, and access key limited to `ses:SendEmail` on the identity and configuration set.
- Optional application A and AAAA records when the corresponding VPS addresses are supplied.
- A private, versioned, AES256-encrypted backup bucket with 30-day current-object retention and separate lifecycle cleanup for old versions and incomplete uploads.
- A dedicated backup IAM user limited to listing and writing the `yz-auth/` backup prefix; it cannot read backups or access SES.

With the default variables and `dns_zone = "example.com"`, the names are:

- Sender identity and From domain: `mail.example.com`
- From address: `no-reply@mail.example.com`
- MAIL FROM domain: `bounce.mail.example.com`
- DMARC name: `_dmarc.mail.example.com`
- Application name: `auth.example.com`

## Prerequisites

1. Install Terraform 1.11 or newer within the supported 1.x range.
2. Use AWS operator credentials that can manage the bootstrap and main resources. Do not use the send-only runtime access key for Terraform.
3. Create a Porkbun API key restricted to DNS management for the required domain. Enable API access for that domain in Porkbun.
4. Confirm that the domain uses Porkbun authoritative nameservers.
5. Choose globally unique S3 state and backup bucket names.
6. Request SES production access separately if the account is still in the SES sandbox.

Supply Porkbun credentials through the environment whenever planning or applying the main module:

```bash
export PORKBUN_API_KEY='pk1_replace_me'
export PORKBUN_SECRET_KEY='sk1_replace_me'
```

Do not write either value to Terraform files. AWS credentials use the standard AWS provider chain, such as an operator profile or AWS environment variables.

## 1. Bootstrap the state bucket

Run this module first and only once for a given state bucket:

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and replace `replace-with-your-unique-state-bucket` with the chosen bucket name. Then run:

```bash
terraform init -input=false
terraform validate
terraform plan -var-file=terraform.tfvars -out=bootstrap.tfplan
terraform apply bootstrap.tfplan
terraform output -raw state_bucket_name
```

The bucket has versioning, AES256 server-side encryption, and all S3 public-access blocks enabled. Preserve the bootstrap state if the bucket will remain managed. Never destroy the bucket while the main module still uses it.

## 2. Configure and apply the main module

```bash
cd ..
cp backend.tfvars.example backend.tfvars
cp terraform.tfvars.example terraform.tfvars
```

Edit `backend.tfvars` and set `bucket` to the exact bootstrap output. Keep `key` and `region` unchanged unless a separate state layout is intentionally required.

Edit `terraform.tfvars`:

- Set `dns_zone` to the actual zone without a trailing dot.
- Set `backup_bucket_name` to a new, globally unique bucket for PostgreSQL backups and adjust `backup_retention_days` only when a different retention period is required.
- Set `app_ipv4_address` and/or `app_ipv6_address` to create application records. Leave them `null` to omit those records.
- Adjust the mail/application subdomains or DMARC policy only when required.
- Initially leave `dkim_hosted_zone = "dkim.amazonses.com"`, which is the documented value for `eu-central-1`. Compare it with SES after the first apply as described below.

Initialize the partial S3 backend, review a plan, and apply only that reviewed plan:

```bash
terraform init -input=false -backend-config=backend.tfvars
terraform validate
terraform plan -var-file=terraform.tfvars -out=yz-auth.tfplan
terraform apply yz-auth.tfplan
```

If this directory was previously initialized with `-backend=false`, use `-reconfigure` on the first real backend initialization:

```bash
terraform init -input=false -backend-config=backend.tfvars -reconfigure
```

The backend operator needs `s3:ListBucket` on the bucket, `s3:GetObject` and `s3:PutObject` on the state object, and those two actions plus `s3:DeleteObject` on `<key>.tflock`.

## 3. Capture runtime configuration

The main module exports the configuration-set name, sender address, access-key ID, and sensitive secret access key:

```bash
terraform output -raw ses_configuration_set_name
terraform output -raw ses_from_address
terraform output -raw ses_aws_access_key_id
terraform output -raw ses_aws_secret_access_key
terraform output -raw backup_bucket_name
terraform output -raw backup_aws_access_key_id
terraform output -raw backup_aws_secret_access_key
```

Map them into the deployment environment as follows:

```dotenv
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=<ses_aws_access_key_id output>
AWS_SECRET_ACCESS_KEY=<ses_aws_secret_access_key output>
SES_FROM_ADDRESS=<ses_from_address output>
SES_CONFIGURATION_SET_NAME=<ses_configuration_set_name output>
BACKUP_BUCKET=<backup_bucket_name output>
BACKUP_AWS_ACCESS_KEY_ID=<backup_aws_access_key_id output>
BACKUP_AWS_SECRET_ACCESS_KEY=<backup_aws_secret_access_key output>
```

Perform the secret output and deployment injection only in a controlled environment. Do not leave the runtime credentials in the shell used for subsequent Terraform operations: the runtime user intentionally has no backend or infrastructure-management permissions. The application should use SESv2 `SendEmail` and pass `SES_CONFIGURATION_SET_NAME` explicitly.

## 4. Verify DNS and SES readiness

Terraform does not wait for SESv2 identity or MAIL FROM verification. DNS creation and a successful Terraform apply are not proof that sending is ready. `REJECT_MESSAGE` also means sends fail while the custom MAIL FROM configuration is pending or failed.

Set the names used in `terraform.tfvars`; these examples use the defaults:

```bash
DNS_ZONE=example.com
MAIL_DOMAIN="mail.${DNS_ZONE}"
MAIL_FROM_DOMAIN="bounce.${MAIL_DOMAIN}"
APP_DOMAIN="auth.${DNS_ZONE}"
CONFIGURATION_SET_NAME="$(terraform output -raw ses_configuration_set_name)"
```

Inspect the identity using AWS operator credentials:

```bash
aws sesv2 get-email-identity \
  --region eu-central-1 \
  --email-identity "$MAIL_DOMAIN" \
  --query '{
    Verification:VerificationStatus,
    VerifiedForSending:VerifiedForSendingStatus,
    Dkim:DkimAttributes.Status,
    SigningEnabled:DkimAttributes.SigningEnabled,
    CurrentKeyLength:DkimAttributes.CurrentSigningKeyLength,
    SigningHostedZone:DkimAttributes.SigningHostedZone,
    MailFrom:MailFromAttributes.MailFromDomainStatus
  }' \
  --output json
```

Before enabling runtime sending, require:

- `Verification` and `Dkim`: `SUCCESS`
- `VerifiedForSending` and `SigningEnabled`: `true`
- `CurrentKeyLength`: `RSA_2048_BIT`
- `MailFrom`: `SUCCESS`

Compare `SigningHostedZone` with `dkim_hosted_zone`. AWS provider 6.71.0 exposes DKIM tokens but not this hosted-zone value, so the DNS target is an explicit input. If SES reports a different value, update `terraform.tfvars`, plan, apply, and wait for verification again.

Verify the effective configuration-set settings:

```bash
aws sesv2 get-configuration-set \
  --region eu-central-1 \
  --configuration-set-name "$CONFIGURATION_SET_NAME" \
  --query '{
    SendingEnabled:SendingOptions.SendingEnabled,
    EngagementMetrics:VdmOptions.DashboardOptions.EngagementMetrics,
    TrackingOptions:TrackingOptions
  }' \
  --output json

aws sesv2 get-configuration-set-event-destinations \
  --region eu-central-1 \
  --configuration-set-name "$CONFIGURATION_SET_NAME" \
  --output json
```

Require `SendingEnabled = true`, `EngagementMetrics = DISABLED`, no custom tracking configuration, and no event destination matching `OPEN` or `CLICK`. Disabling VDM engagement alone does not suppress open/click publishing from an event destination, which is why this module creates none. Account-level VDM engagement is overridden by the configuration-set `DISABLED` value.

Inspect public DNS where applicable:

```bash
dig +short MX "$MAIL_FROM_DOMAIN"
dig +short TXT "$MAIL_FROM_DOMAIN"
dig +short TXT "_dmarc.${MAIL_DOMAIN}"
dig +short A "$APP_DOMAIN"
dig +short AAAA "$APP_DOMAIN"
```

Expected MAIL FROM answers are priority `10` with `feedback-smtp.eu-central-1.amazonses.com` and SPF value `v=spf1 include:amazonses.com ~all`. Keep exactly one MX record and one SPF TXT record at the MAIL FROM hostname. Application lookups return no records when both IP inputs are `null`.

## 5. Backup and restore verification

The Compose `backup` service writes a custom-format PostgreSQL dump immediately after startup and then every 24 hours. Failed uploads are retried after five minutes. Objects are stored under `yz-auth/YYYY/MM/DD/` and current versions expire after the configured retention period.

Use AWS operator credentials, not the write-only backup identity, to inspect backup objects:

```bash
aws s3 ls "s3://$BACKUP_BUCKET/yz-auth/" --recursive
```

Before production use, perform a restore into a disposable PostgreSQL instance and verify the restored tenants and accounts. A restore into an existing database is destructive. Stop `yz-auth`, `migrate`, and `backup` first, and use separate operator credentials with read access to the backup object. Then run `pg_restore --clean --if-exists --single-transaction` against the intended database. Do not test this procedure against production data.

## Operational notes

- The initial DMARC value is monitoring mode, `v=DMARC1; p=none`. Add a monitored reporting address and tighten to quarantine/reject only after confirming aligned legitimate mail. Do not add `aspf=s` to this MAIL FROM layout.
- The custom MAIL FROM domain is dedicated to SES and must not be used as a visible From domain or ordinary receiving domain.
- `next_signing_key_length` can be changed at most once per day. Recreating the identity also produces new DKIM DNS requirements.
- The IAM policy allows only SESv2 `SendEmail`; tracking overrides and other SES actions are not granted.
- A sensitive output hides normal display only. The IAM secret remains in Terraform state, so state read access must be restricted to the operator. Plan files and local state are ignored and must not be shared.
- SES sandbox restrictions and production-access approval are account operations outside this configuration.
