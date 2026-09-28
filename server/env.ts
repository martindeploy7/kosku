import { z } from 'zod'

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  /** Public origin tenants reach for signing links, e.g. https://kos.example.com */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Jakarta'),
  DATA_DIR: z.string().default('./data'),
  MIGRATIONS_DIR: z.string().default('./drizzle'),
  STATIC_DIR: z.string().default('./dist'),
  SERVE_STATIC: bool(true),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  UPLOAD_MAX_MB: z.coerce.number().default(10),
  /** Login attempts per IP per 15 minutes (raise only for automated tests). */
  LOGIN_IP_LIMIT: z.coerce.number().int().min(5).default(20),

  /** `baileys` links a real WhatsApp number via QR; `mock` simulates it for development. */
  WA_DRIVER: z.enum(['baileys', 'mock']).default('baileys'),
  /** Minimum/maximum pause between outgoing messages per number (anti-ban pacing). */
  WA_MIN_DELAY_MS: z.coerce.number().default(4000),
  WA_MAX_DELAY_MS: z.coerce.number().default(9000),

  /** Trust X-Forwarded-For / CF-Connecting-IP (true behind Caddy or Cloudflare Tunnel). */
  TRUST_PROXY: bool(false),
  SESSION_IDLE_HOURS: z.coerce.number().default(72),
  SESSION_MAX_DAYS: z.coerce.number().default(30),

  JOBS_ENABLED: bool(true),
  /** healthchecks.io-style URL pinged after each successful daily run (dead-man's switch). */
  HEALTHCHECK_URL: z.string().optional(),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Konfigurasi environment tidak valid:')
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  /** Cookies are Secure whenever the public origin is https. */
  cookieSecure: parsed.data.PUBLIC_URL.startsWith('https://'),
}

export type Env = typeof env
