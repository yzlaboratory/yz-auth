variable "aws_region" {
  description = "AWS region for SES, IAM, and the S3 backup bucket."
  type        = string
  default     = "eu-central-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for yz-auth Terraform state."
  type        = string
}
