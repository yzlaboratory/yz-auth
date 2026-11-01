module "backups" {
  source = "./modules/private-bucket"
  bucket = var.backup_bucket_name
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = module.backups.id

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
    resources = [module.backups.arn]

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
    resources = ["${module.backups.arn}/yz-auth/*"]
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
