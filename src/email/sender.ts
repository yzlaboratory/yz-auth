import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
import type { EmailConfig } from '../config.js'

export interface EmailMessage {
  recipient: string
  subject: string
  htmlBody: string
  textBody: string
}

export interface DeliveryResult {
  providerMessageId: string | null
}

export interface MailSender {
  send(message: EmailMessage): Promise<DeliveryResult>
}

export class MemoryMailSender implements MailSender {
  readonly messages: EmailMessage[] = []

  async send(message: EmailMessage): Promise<DeliveryResult> {
    this.messages.push(message)
    return { providerMessageId: null }
  }
}

export function createMailSender(config: EmailConfig): MailSender {
  if (config.driver === 'memory') {
    return new MemoryMailSender()
  }

  if (config.driver === 'ses') {
    const client = new SESv2Client({ region: config.region })

    return {
      async send(message) {
        const result = await client.send(new SendEmailCommand({
          FromEmailAddress: config.from,
          ConfigurationSetName: config.configurationSetName,
          Destination: { ToAddresses: [message.recipient] },
          Content: {
            Simple: {
              Subject: { Data: message.subject },
              Body: {
                Text: { Data: message.textBody },
                Html: { Data: message.htmlBody },
              },
            },
          },
        }))

        return { providerMessageId: result.MessageId ?? null }
      },
    }
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
  })

  return {
    async send(message) {
      const result = await transport.sendMail({
        from: config.from,
        to: message.recipient,
        subject: message.subject,
        text: message.textBody,
        html: message.htmlBody,
      })

      return { providerMessageId: result.messageId ?? null }
    },
  }
}
