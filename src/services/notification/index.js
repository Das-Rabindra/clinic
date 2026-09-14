/**
 * NotificationService — the single dispatch point.
 *
 * Controllers never call a provider. They emit an event (events.js), which
 * enqueues rows here; the job runner drains the queue. Adding a channel means
 * adding a provider to this map, nothing else changes.
 */
import * as notifRepo from '../../repositories/notifications.repo.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import * as whatsapp from './providers/whatsapp-cloud.js';
import * as email from './providers/email-smtp.js';
import { render } from './templates.js';
import { truncate } from '../../utils/format.js';

const providers = { whatsapp, email };

/** Queue a notification. Returns the row id (or an existing one if deduped). */
export function queue({ channel, template, recipient, payload = {}, appointmentId = null,
  enquiryId = null, scheduledFor = null, dedupeKey = null, recipientRole = 'patient',
  bodyPreview = null }) {
  if (!recipient) return null;
  return notifRepo.enqueue({
    channel, template, recipient, recipient_role: recipientRole,
    payload, appointment_id: appointmentId, enquiry_id: enquiryId,
    scheduled_for: scheduledFor, dedupe_key: dedupeKey,
    body_preview: bodyPreview,
  });
}

/**
 * Deliver one queued notification.
 * Never throws: every outcome is recorded on the row and in notification_logs
 * so the admin can see exactly what happened and retry.
 */
export async function deliver(notification) {
  const n = typeof notification === 'number' ? notifRepo.findById(notification) : notification;
  if (!n) return { ok: false, error: 'not found' };

  const provider = providers[n.channel];
  if (!provider) {
    notifRepo.markFailed(n.id, `No provider for channel "${n.channel}"`, null);
    return { ok: false, error: 'no provider' };
  }

  notifRepo.markSending(n.id);
  const attempt = (n.attempts ?? 0) + 1;

  let payload = {};
  try { payload = JSON.parse(n.payload_json || '{}'); } catch { /* keep {} */ }

  const clinic = settingsRepo.get();
  let content;
  try {
    content = render(n.template, payload.entity || {}, clinic, payload.extra || {});
  } catch (err) {
    notifRepo.markFailed(n.id, err.message, provider.name);
    notifRepo.log(n.id, { attempt, status: 'failed', error: err.message });
    return { ok: false, error: err.message };
  }

  if (!provider.isConfigured()) {
    const note = n.channel === 'whatsapp'
      ? 'WhatsApp Cloud API is not configured. Add credentials in Settings → Integrations.'
      : 'Email provider is not configured. Add SMTP details in Settings → Integrations.';
    notifRepo.markNotConfigured(n.id, note);
    notifRepo.log(n.id, { attempt, status: 'not_configured', error: note });
    return { ok: false, notConfigured: true };
  }

  const res = await provider.send({
    to: n.recipient,
    text: content.text,
    subject: content.subject,
    template: n.template,
    vars: content.vars,
  });

  if (res.ok) {
    notifRepo.markSent(n.id, provider.name, res.messageId);
    notifRepo.log(n.id, {
      attempt, status: 'sent', http_status: res.httpStatus, response_body: res.body,
    });
    return { ok: true };
  }

  if (res.notConfigured) {
    notifRepo.markNotConfigured(n.id, res.error);
    notifRepo.log(n.id, { attempt, status: 'not_configured', error: res.error });
    return { ok: false, notConfigured: true };
  }

  notifRepo.markFailed(n.id, res.error, provider.name);
  notifRepo.log(n.id, {
    attempt, status: 'failed', http_status: res.httpStatus,
    response_body: res.body, error: res.error,
  });
  return { ok: false, error: res.error };
}

/** Drain due notifications. Called by the job runner. */
export async function processQueue(limit = 20) {
  const due = notifRepo.dueNow(limit);
  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const n of due) {
    const r = await deliver(n);
    if (r.ok) results.sent++;
    else if (r.notConfigured) results.skipped++;
    else results.failed++;
  }
  return results;
}

/** Admin "Retry" button. */
export async function retry(id) {
  notifRepo.resetForRetry(id);
  return deliver(id);
}

/** Preview text without sending — used by the admin notification detail view. */
export function preview(template, entity, extra = {}) {
  const clinic = settingsRepo.get();
  try {
    const c = render(template, entity, clinic, extra);
    return truncate(c.text, 400);
  } catch { return null; }
}

export const status = () => ({
  whatsapp: { configured: whatsapp.isConfigured(), provider: whatsapp.name },
  email: { configured: email.isConfigured(), provider: email.name },
});
