data "aws_iam_policy_document" "yz_auth_send" {
  statement {
    sid     = "SendTransactionalEmail"
    effect  = "Allow"
    actions = ["ses:SendEmail"]

    resources = [
      aws_sesv2_email_identity.sender.arn,
      aws_sesv2_configuration_set.transactional.arn,
    ]
  }
}

resource "aws_iam_user" "yz_auth" {
  name = "yz-auth-ses"
  path = "/system/"
}

resource "aws_iam_policy" "yz_auth_send" {
  name   = "yz-auth-ses-send"
  path   = "/system/"
  policy = data.aws_iam_policy_document.yz_auth_send.json
}

resource "aws_iam_user_policy_attachment" "yz_auth_send" {
  user       = aws_iam_user.yz_auth.name
  policy_arn = aws_iam_policy.yz_auth_send.arn
}

resource "aws_iam_access_key" "yz_auth" {
  user = aws_iam_user.yz_auth.name
}
