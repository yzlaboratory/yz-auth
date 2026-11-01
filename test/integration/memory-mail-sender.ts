import type { DeliveryResult, EmailMessage, MailSender } from '../../src/email/sender.js'

export class MemoryMailSender implements MailSender {
  readonly messages: EmailMessage[] = []

  async send(message: EmailMessage): Promise<DeliveryResult> {
    this.messages.push(message)
    return { providerMessageId: null }
  }
}
