/** SMTP provider via nodemailer. Unconfigured => reports notConfigured. */
import nodemailer from 'nodemailer';
import { config } from '../../../config/env.js';
import * as integrationsRepo from '../../../repositories/integrations.repo.js';

export const name = 'smtp';

function settings() {
  const stored = integrationsRepo.getSecrets('smtp');
  const row = integrationsRepo.get('smtp');
  const cfg = row?.config || {};
  return {
    host: cfg.host || config.smtp.host,
    port: Number(cfg.port || config.smtp.port || 587),
    secure: cfg.secure !== undefined ? Boolean(cfg.secure) : config.smtp.secure,
    user: stored.user || config.smtp.user,
    pass: stored.pass || config.smtp.pass,
    from: cfg.from || config.smtp.from,
    enabled: row ? row.is_enabled : Boolean(config.smtp.host),
  };
}

export const isConfigured = () => {
  const s = settings();
  return Boolean(s.enabled && s.host);
};

let cached = null, cachedKey = '';
function transport(s) {
  const key = `${s.host}:${s.port}:${s.user}`;
  if (cached && cachedKey === key) return cached;
  cached = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  });
  cachedKey = key;
  return cached;
}

export async function send({ to, subject, text }) {
  const s = settings();
  if (!isConfigured()) return { ok: false, notConfigured: true, error: 'SMTP is not configured.' };
  try {
    const info = await transport(s).sendMail({ from: s.from, to, subject, text });
    return { ok: true, messageId: info.messageId, body: info.response };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function verify() {
  const s = settings();
  if (!s.host) return { ok: false, error: 'No SMTP host configured.' };
  try { await transport(s).verify(); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
}
