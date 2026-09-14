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

/* APP_SECRET encrypts integration credentials at rest and signs OAuth state.
   In production we refuse to boot without one rather than silently falling back
   to an ephemeral key that would make stored secrets unreadable after restart. */
let APP_SECRET = process.env.APP_SECRET || '';
if (!APP_SECRET) {
  if (isProd) {
    console.error('FATAL: APP_SECRET is required in production. Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  APP_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[config] APP_SECRET not set — using an ephemeral development key. Stored integration secrets will not survive a restart.');
}

const root = path.resolve(process.cwd());
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || './uploads');
for (const d of [dataDir, uploadDir]) fs.mkdirSync(d, { recursive: true });

export const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 8090),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${int(process.env.PORT, 8090)}`).replace(/\/+$/, ''),
  trustProxy: bool(process.env.TRUST_PROXY),
  appSecret: APP_SECRET,

  paths: Object.freeze({ root, dataDir, uploadDir, db: path.join(dataDir, 'clinic.sqlite') }),

  storage: Object.freeze({
    driver: process.env.STORAGE_DRIVER || 'local',
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
