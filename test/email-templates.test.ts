import assert from 'node:assert/strict'
import test from 'node:test'
import { createPasswordResetEmail, createVerificationEmail } from '../src/email/templates.js'

test('verification email contains the tenant-scoped link and escaped content', () => {
  const email = createVerificationEmail({
    tenantName: 'Acme <script>',
    recipient: 'person@example.com',
    verificationUrl: 'https://auth.example.com/t/acme/verify?token=secret&interaction=abc',
  })

  assert.equal(email.recipient, 'person@example.com')
  assert.match(email.textBody, /token=secret&interaction=abc/)
  assert.match(email.htmlBody, /token=secret&amp;interaction=abc/)
  assert.match(email.htmlBody, /Acme &lt;script&gt;/)
  assert.doesNotMatch(email.htmlBody, /Acme <script>/)
})

test('password reset email explains expiry and avoids tracking markup', () => {
  const email = createPasswordResetEmail({
    tenantName: 'Acme',
    recipient: 'person@example.com',
    resetUrl: 'https://auth.example.com/t/acme/reset-password?token=secret',
  })

  assert.match(email.textBody, /expires in 1 hour/)
  assert.doesNotMatch(email.htmlBody, /<img|tracking|unsubscribe/)
})
