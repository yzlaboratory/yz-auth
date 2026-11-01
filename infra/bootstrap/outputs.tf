output "state_bucket_name" {
  description = "S3 bucket to use in the main backend configuration."
  value       = aws_s3_bucket.state.bucket
}
