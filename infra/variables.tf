variable "aws_region" {
  description = "AWS region for SES, IAM, and the S3 backup bucket."
  type        = string
  default     = "eu-central-1"
}

variable "dns_zone" {
  description = "Porkbun authoritative DNS zone without a trailing dot."
  type        = string
}

variable "mail_subdomain" {
  description = "Relative subdomain used for the SES sending identity."
  type        = string
  default     = "mail"
}

variable "app_subdomain" {
  description = "Relative subdomain used for the yz-auth application."
  type        = string
  default     = "auth"
}

variable "app_ipv4_address" {
  description = "Optional VPS IPv4 address for the application A record."
  type        = string
  default     = null
}

variable "app_ipv6_address" {
  description = "Optional VPS IPv6 address for the application AAAA record."
  type        = string
  default     = null
}

variable "dmarc_value" {
  description = "DMARC TXT value for the SES sending identity."
  type        = string
  default     = "v=DMARC1; p=none"
}

variable "dkim_hosted_zone" {
  description = "DKIM hosted zone reported by SES as DkimAttributes.SigningHostedZone."
  type        = string
  default     = "dkim.amazonses.com"
}

variable "backup_bucket_name" {
  description = "Globally unique S3 bucket name for encrypted yz-auth PostgreSQL backups."
  type        = string
}

variable "backup_retention_days" {
  description = "Number of days to retain current PostgreSQL backup objects."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 3650
    error_message = "Backup retention must be between 1 and 3650 days."
  }
}
