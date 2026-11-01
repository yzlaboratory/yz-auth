output "ses_configuration_set_name" {
  description = "SES configuration set for SendEmail requests."
  value       = aws_sesv2_configuration_set.transactional.configuration_set_name
}

output "ses_from_address" {
  description = "Shared yz-auth sender address."
  value       = local.from_address
}

output "ses_aws_access_key_id" {
  description = "Access key ID for the yz-auth SES runtime user."
  value       = aws_iam_access_key.yz_auth.id
}

output "ses_aws_secret_access_key" {
  description = "Secret access key for the yz-auth SES runtime user."
  value       = aws_iam_access_key.yz_auth.secret
  sensitive   = true
}

output "backup_bucket_name" {
  description = "S3 bucket used for yz-auth PostgreSQL backups."
  value       = aws_s3_bucket.backups.bucket
}

output "backup_aws_access_key_id" {
  description = "Access key ID for the write-only backup user."
  value       = aws_iam_access_key.backup.id
}

output "backup_aws_secret_access_key" {
  description = "Secret access key for the write-only backup user."
  value       = aws_iam_access_key.backup.secret
  sensitive   = true
}
