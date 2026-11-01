import type { DeliveryResult, EmailMessage, MailSender } from '../../src/email/sender.js'

export class MemoryMailSender implements MailSender {
  readonly messages: EmailMessage[] = []

  send(message: EmailMessage): Promise<DeliveryResult> {
    this.messages.push(message)
    return Promise.resolve({ providerMessageId: null })
  }
}
