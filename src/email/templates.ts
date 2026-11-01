import type { EmailMessage } from './sender.js'

export function createVerificationEmail(input: {
  tenantName: string
  recipient: string
  verificationUrl: string
}): EmailMessage {
  const subject = `Verify your ${input.tenantName} email`
  const textBody = [
    `Verify your email for ${input.tenantName}.`,
    '',
    input.verificationUrl,
    '',
    'This link expires in 24 hours. If you did not create this account, ignore this email.',
  ].join('\n')

  return {
    recipient: input.recipient,
    subject,
    textBody,
    htmlBody: createSecurityEmailHtml(subject, 'Verify email', input.verificationUrl, textBody),
  }
}

export function createPasswordResetEmail(input: {
  tenantName: string
  recipient: string
  resetUrl: string
}): EmailMessage {
  const subject = `Reset your ${input.tenantName} password`
  const textBody = [
    `Reset your password for ${input.tenantName}.`,
    '',
    input.resetUrl,
    '',
    'This link expires in 1 hour. If you did not request a reset, ignore this email.',
  ].join('\n')

  return {
    recipient: input.recipient,
    subject,
    textBody,
    htmlBody: createSecurityEmailHtml(subject, 'Reset password', input.resetUrl, textBody),
  }
}

function createSecurityEmailHtml(
  title: string,
  action: string,
  actionUrl: string,
  fallbackText: string,
): string {
  return `<!doctype html><html><body><h1>${escapeHtml(title)}</h1><p><a href="${escapeHtml(actionUrl)}">${escapeHtml(action)}</a></p><p>If the link does not work, copy this address into your browser:</p><p>${escapeHtml(actionUrl)}</p><pre>${escapeHtml(fallbackText)}</pre></body></html>`
}

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEscapes[character] ?? character)
}
