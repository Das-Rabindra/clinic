/**
 * Central configuration. Everything the app needs from the environment is read
 * here once, validated, and exported frozen. No other module reads process.env.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Fail loudly, but in the way that suits the runtime.
 *
 * A long-running process should exit so the container restarts. A serverless
 * function must throw instead: process.exit() there aborts the invocation with
 * no explanation, leaving only "FUNCTION_INVOCATION_FAILED" in the log.
 */
function fatal(message) {
  console.error(message);
  if (IS_SERVERLESS) throw new Error(message.split('\n')[0]);
  process.exit(1);
}

/* APP_SECRET encrypts integration credentials at rest and signs OAuth state.
   In production we refuse to boot without one rather than silently falling back
   to an ephemeral key that would make stored secrets unreadable after restart. */
let APP_SECRET = process.env.APP_SECRET || '';
if (!APP_SECRET) {
  if (isProd) {
    fatal('FATAL: APP_SECRET is required in production. Generate one with: openssl rand -hex 32');
  }
  APP_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[config] APP_SECRET not set — using an ephemeral development key. Stored integration secrets will not survive a restart.');
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
if (!DATABASE_URL) {
  fatal(
    'FATAL: DATABASE_URL is not set.\n' +
    '  Local:  postgres://postgres:devpass@localhost:55432/clinic\n' +
    '  Vercel: add a Neon/Postgres integration, which sets DATABASE_URL for you.'
  );
}

const root = path.resolve(process.cwd());
/*
 * Serverless filesystems are read-only apart from /tmp, and creating these
 * directories at import time threw EROFS before anything else could run — the
 * function crashed with no usable message. Uploads go to Blob there anyway, so
 * the directories are only needed (and only created) for the local driver.
 */
const writableRoot = IS_SERVERLESS ? '/tmp' : root;
const dataDir = path.resolve(writableRoot, process.env.DATA_DIR || './data');
const uploadDir = path.resolve(writableRoot, process.env.UPLOAD_DIR || './uploads');

const usingLocalStorage =
  (process.env.STORAGE_DRIVER || (IS_SERVERLESS ? 'blob' : 'local')) === 'local';
if (usingLocalStorage) {
  for (const d of [dataDir, uploadDir]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (err) {
      console.warn(`[config] could not create ${d}: ${err.message}`);
    }
  }
}

export const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 8090),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${int(process.env.PORT, 8090)}`).replace(/\/+$/, ''),
  trustProxy: bool(process.env.TRUST_PROXY),
  appSecret: APP_SECRET,

  paths: Object.freeze({ root, dataDir, uploadDir }),

  database: Object.freeze({
    url: DATABASE_URL,
    // Neon and most managed Postgres require TLS; a local docker instance does not.
    ssl: /sslmode=require|neon\.tech|supabase|amazonaws/.test(DATABASE_URL),
    // Serverless invocations each hold their own pool, so keep it small and
    // let the provider's pooler do the multiplexing.
    poolMax: int(process.env.PG_POOL_MAX, IS_SERVERLESS ? 1 : 10),
  }),

  isServerless: IS_SERVERLESS,

  storage: Object.freeze({
    // Vercel's filesystem is ephemeral, so default to Blob there.
    driver: process.env.STORAGE_DRIVER || (IS_SERVERLESS ? 'blob' : 'local'),
    blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
    blobBaseUrl: process.env.BLOB_BASE_URL || '',
    maxUploadBytes: int(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
  }),

  seedAdmin: Object.freeze({
    email: (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.SEED_ADMIN_PASSWORD || '',
  }),

  whatsapp: Object.freeze({
    enabled: bool(process.env.WHATSAPP_ENABLED),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    token: process.env.WHATSAPP_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    useTemplates: bool(process.env.WHATSAPP_USE_TEMPLATES, true),
    lang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
  }),

  google: Object.freeze({
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    get configured() { return Boolean(this.clientId && this.clientSecret); },
  }),

  smtp: Object.freeze({
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Samal Dental Care <noreply@example.com>',
    get configured() { return Boolean(this.host); },
  }),

  jobs: Object.freeze({
    enabled: bool(process.env.RUN_JOBS, true),
    pollMs: int(process.env.JOB_POLL_MS, 20000),
    reminder24h: bool(process.env.REMINDER_24H, true),
    reminder2h: bool(process.env.REMINDER_2H, true),
  }),

  session: Object.freeze({
    cookieName: 'sdc_session',
    csrfCookie: 'sdc_csrf',
    slidingHours: 8,
    absoluteDays: 30,
    /*
     * Only mark cookies Secure when the site is genuinely reached over HTTPS
     * (directly, or behind a TLS-terminating proxy). Keying this off NODE_ENV
     * instead would set Secure on a plain-HTTP production deployment, and every
     * browser silently discards such a cookie - making login appear to succeed
     * while no session is ever stored.
     */
    secureCookies: bool(process.env.TRUST_PROXY)
      || /^https:/i.test(process.env.PUBLIC_URL || ''),
  }),
});
