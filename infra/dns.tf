resource "porkbun_dns_record" "ses_dkim" {
  count = 3

  domain    = var.dns_zone
  subdomain = "${aws_sesv2_email_identity.sender.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.mail_subdomain}"
  type      = "CNAME"
  content   = "${aws_sesv2_email_identity.sender.dkim_signing_attributes[0].tokens[count.index]}.${var.dkim_hosted_zone}"
  ttl       = 600
}

resource "porkbun_dns_record" "ses_mail_from_mx" {
  domain    = var.dns_zone
  subdomain = local.mail_from_subdomain
  type      = "MX"
  content   = "feedback-smtp.eu-central-1.amazonses.com"
  priority  = 10
  ttl       = 600
}

resource "porkbun_dns_record" "ses_mail_from_spf" {
  domain    = var.dns_zone
  subdomain = local.mail_from_subdomain
  type      = "TXT"
  content   = "v=spf1 include:amazonses.com ~all"
  ttl       = 600
}

resource "porkbun_dns_record" "dmarc" {
  domain    = var.dns_zone
  subdomain = "_dmarc.${var.mail_subdomain}"
  type      = "TXT"
  content   = var.dmarc_value
  ttl       = 600
}

resource "porkbun_dns_record" "app_a" {
  count = var.app_ipv4_address == null ? 0 : 1

  domain    = var.dns_zone
  subdomain = var.app_subdomain
  type      = "A"
  content   = var.app_ipv4_address
  ttl       = 600
}

resource "porkbun_dns_record" "app_aaaa" {
  count = var.app_ipv6_address == null ? 0 : 1

  domain    = var.dns_zone
  subdomain = var.app_subdomain
  type      = "AAAA"
  content   = var.app_ipv6_address
  ttl       = 600
}
