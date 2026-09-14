/**
 * WhatsApp Cloud API (Meta Graph) provider.
 *
 * Real HTTP integration. Credentials come from the integrations table (admin
 * UI) or environment - never from the client. When they are absent the provider
 * reports `configured: false` and the notification is recorded as
 * `not_configured` rather than being silently dropped or faked as sent.
 */
import { config } from '../../../config/env.js';
import * as integrationsRepo from '../../../repositories/integrations.repo.js';

export const name = 'whatsapp_cloud';

/** Merge env defaults with admin-entered credentials (admin wins). */
export async function credentials() {
  const stored = await integrationsRepo.getSecrets('whatsapp');
  const row = await integrationsRepo.get('whatsapp');
  const cfg = row?.config || {};
  return {
    token: stored.token || config.whatsapp.token || '',
    phoneNumberId: stored.phone_number_id || cfg.phone_number_id || config.whatsapp.phoneNumberId || '',
    apiVersion: cfg.api_version || config.whatsapp.apiVersion || 'v21.0',
    useTemplates: cfg.use_templates !== undefined ? Boolean(cfg.use_templates) : config.whatsapp.useTemplates,
    lang: cfg.template_lang || config.whatsapp.lang || 'en',
    enabled: row ? row.is_enabled : config.whatsapp.enabled,
  };
}

export async function isConfigured() {
  const c = await credentials();
  return Boolean(c.enabled && c.token && c.phoneNumberId);
}

/**
 * Send a message.
 * @returns {Promise<{ok:boolean, messageId?:string, httpStatus?:number, body?:string, error?:string}>}
 */
export async function send({ to, text, template, vars = [] }) {
  const c = await credentials();
  if (!(await isConfigured())) {
    return { ok: false, notConfigured: true, error: 'WhatsApp Cloud API is not configured.' };
  }

  const url = `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`;

  /* Meta only permits free-form text inside a 24h customer service window.
     Outside it, a pre-approved template must be used - hence the two shapes. */
  const payload = c.useTemplates && template
    ? {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: c.lang },
        components: vars.length
          ? [{ type: 'body', parameters: vars.map(v => ({ type: 'text', text: String(v ?? '') })) }]
          : [],
      },
    }
    : {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(body)?.error?.message || msg; } catch { /* keep raw */ }
      return { ok: false, httpStatus: res.status, body, error: msg };
    }
    let messageId;
    try { messageId = JSON.parse(body)?.messages?.[0]?.id; } catch { /* optional */ }
    return { ok: true, httpStatus: res.status, body, messageId };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Request timed out' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Lightweight credential check for the Integrations screen. */
export async function verify() {
  const c = await credentials();
  if (!c.token || !c.phoneNumberId) return { ok: false, error: 'Missing token or phone number ID.' };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${c.token}` } }
    );
    const body = (await res.json()).catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error?.message || `HTTP ${res.status}` };
    return { ok: true, details: body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
