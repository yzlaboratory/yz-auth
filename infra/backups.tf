resource "aws_s3_bucket" "backups" {
  bucket = var.backup_bucket_name
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-yz-auth-backups"
    status = "Enabled"

    filter {
      prefix = "yz-auth/"
    }

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "backup_write" {
  statement {
    sid       = "ListBackupPrefix"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["yz-auth/*"]
    }
  }

  statement {
    sid    = "WriteBackups"
    effect = "Allow"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.backups.arn}/yz-auth/*"]
  }
}

resource "aws_iam_user" "backup" {
  name = "yz-auth-backup"
  path = "/system/"
}

resource "aws_iam_policy" "backup_write" {
  name   = "yz-auth-backup-write"
  path   = "/system/"
  policy = data.aws_iam_policy_document.backup_write.json
}

resource "aws_iam_user_policy_attachment" "backup_write" {
  user       = aws_iam_user.backup.name
  policy_arn = aws_iam_policy.backup_write.arn
}

resource "aws_iam_access_key" "backup" {
  user = aws_iam_user.backup.name
}
