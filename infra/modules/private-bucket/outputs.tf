output "bucket" {
  description = "S3 bucket name."
  value       = aws_s3_bucket.this.bucket
}

output "id" {
  description = "S3 bucket ID."
  value       = aws_s3_bucket.this.id
}

output "arn" {
  description = "S3 bucket ARN."
  value       = aws_s3_bucket.this.arn
}
