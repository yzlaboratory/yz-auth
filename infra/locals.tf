locals {
  sender_domain       = "${var.mail_subdomain}.${var.dns_zone}"
  mail_from_subdomain = "bounce.${var.mail_subdomain}"
  mail_from_domain    = "${local.mail_from_subdomain}.${var.dns_zone}"
  from_address        = "no-reply@${local.sender_domain}"
}
