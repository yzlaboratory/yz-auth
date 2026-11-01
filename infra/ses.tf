resource "aws_sesv2_configuration_set" "transactional" {
  configuration_set_name = "yz-auth-transactional"

  sending_options {
    sending_enabled = true
  }

  vdm_options {
    dashboard_options {
      engagement_metrics = "DISABLED"
    }
  }
}

resource "aws_sesv2_email_identity" "sender" {
  email_identity         = local.sender_domain
  configuration_set_name = aws_sesv2_configuration_set.transactional.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_sesv2_email_identity_mail_from_attributes" "sender" {
  email_identity         = aws_sesv2_email_identity.sender.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "REJECT_MESSAGE"

  depends_on = [porkbun_dns_record.ses_mail_from_mx]
}
