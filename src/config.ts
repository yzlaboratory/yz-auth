import { z } from 'zod'

const booleanValue = z.enum(['true', 'false']).transform((value) => value === 'true')
const portValue = z.coerce.number().int().min(1).max(65535)

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: portValue.default(3000),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
  TRUST_PROXY: booleanValue.default(false),
  DATABASE_URL: z.string().min(1),
  COOKIE_KEYS: z.string().min(32),
  KEY_ENCRYPTION_KEY: z.string().min(1),
  EMAIL_DRIVER: z.enum(['ses', 'smtp']).default('smtp'),
  EMAIL_FROM: z.string().default('yz-auth <no-reply@localhost>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: portValue.default(1025),
  SMTP_SECURE: booleanValue.default(false),
  AWS_REGION: z.string().default('eu-central-1'),
  SES_FROM_ADDRESS: z.string().optional(),
  SES_CONFIGURATION_SET_NAME: z.string().default('yz-auth-transactional'),
  EMAIL_OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
})

export interface SmtpEmailConfig {
  driver: 'smtp'
  from: string
  host: string
  port: number
  secure: boolean
}

export interface SesEmailConfig {
  driver: 'ses'
  from: string
  region: string
  configurationSetName: string
}

export type EmailConfig = SmtpEmailConfig | SesEmailConfig

export interface AppConfig {
  environment: 'development' | 'test' | 'production'
  host: string
  port: number
  publicBaseUrl: string
  trustProxy: boolean
  databaseUrl: string
  cookieKeys: string[]
  encryptionKey: Buffer
  email: EmailConfig
  emailOutboxPollMs: number
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = environmentSchema.parse(source)
  const publicBaseUrl = environment.PUBLIC_BASE_URL.replace(/\/$/, '')
  const encryptionKey = Buffer.from(environment.KEY_ENCRYPTION_KEY, 'base64')
  const cookieKeys = environment.COOKIE_KEYS.split(',').map((key) => key.trim())

  if (encryptionKey.length !== 32) {
    throw new Error('KEY_ENCRYPTION_KEY must encode exactly 32 bytes with base64')
  }

  if (cookieKeys.some((key) => key.length < 32)) {
    throw new Error('Every COOKIE_KEYS entry must contain at least 32 characters')
  }

  if (environment.NODE_ENV === 'production' && !publicBaseUrl.startsWith('https://')) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production')
  }

  if (environment.NODE_ENV === 'production' && environment.EMAIL_DRIVER !== 'ses') {
    throw new Error('EMAIL_DRIVER must be ses in production')
  }

  return {
    environment: environment.NODE_ENV,
    host: environment.HOST,
    port: environment.PORT,
    publicBaseUrl,
    trustProxy: environment.TRUST_PROXY,
    databaseUrl: environment.DATABASE_URL,
    cookieKeys,
    encryptionKey,
    email: loadEmailConfig(environment),
    emailOutboxPollMs: environment.EMAIL_OUTBOX_POLL_MS,
  }
}

function loadEmailConfig(environment: z.infer<typeof environmentSchema>): EmailConfig {
  if (environment.EMAIL_DRIVER === 'ses') {
    if (!environment.SES_FROM_ADDRESS) {
      throw new Error('SES_FROM_ADDRESS is required when EMAIL_DRIVER is ses')
    }

    return {
      driver: 'ses',
      from: environment.SES_FROM_ADDRESS,
      region: environment.AWS_REGION,
      configurationSetName: environment.SES_CONFIGURATION_SET_NAME,
    }
  }

  return {
    driver: 'smtp',
    from: environment.EMAIL_FROM,
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
  }
}
