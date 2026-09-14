import { one, all, run } from './base.js';

export const findById = (id) => one('SELECT * FROM notifications WHERE id = ?', id);

/**
 * Enqueue. `dedupe_key` makes reminders idempotent: re-running the scheduler
 * cannot produce a second "24h reminder" for the same appointment.
 * Returns the existing row's id when the key is already present.
 */
export function enqueue(n) {
  try {
    const info = run(
      `INSERT INTO notifications (channel, template, recipient, recipient_role, payload_json,
         body_preview, appointment_id, enquiry_id, scheduled_for, dedupe_key, max_attempts)
       VALUES (@channel, @template, @recipient, @recipient_role, @payload_json,
         @body_preview, @appointment_id, @enquiry_id, @scheduled_for, @dedupe_key, @max_attempts)`,
      {
        channel: n.channel, template: n.template, recipient: n.recipient,
        recipient_role: n.recipient_role || 'patient',
        payload_json: JSON.stringify(n.payload || {}),
        body_preview: n.body_preview ?? null,
        appointment_id: n.appointment_id ?? null, enquiry_id: n.enquiry_id ?? null,
        scheduled_for: n.scheduled_for ?? null,
        dedupe_key: n.dedupe_key ?? null,
        max_attempts: n.max_attempts ?? 3,
      }
    );
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (String(err.code).includes('CONSTRAINT_UNIQUE') && n.dedupe_key) {
      const existing = one('SELECT id FROM notifications WHERE dedupe_key = ?', n.dedupe_key);
      return existing ? existing.id : null;
    }
    throw err;
  }
}

/** Queued notifications whose scheduled time has arrived. */
export const dueNow = (limit = 25) =>
  all(`SELECT * FROM notifications
       WHERE status IN ('queued')
         AND (scheduled_for IS NULL OR scheduled_for <= datetime('now'))
         AND attempts < max_attempts
       ORDER BY id LIMIT ?`, limit);

export const markSending = (id) =>
  run(`UPDATE notifications SET status = 'sending', attempts = attempts + 1,
       updated_at = datetime('now') WHERE id = ?`, id).changes;

export const markSent = (id, provider, msgId) =>
  run(`UPDATE notifications SET status = 'sent', provider = ?, provider_msg_id = ?,
       sent_at = datetime('now'), last_error = NULL, updated_at = datetime('now') WHERE id = ?`,
    provider, msgId ?? null, id).changes;

/** Failed but retryable stays 'queued'; exhausted attempts become 'failed'. */
export const markFailed = (id, error, provider) =>
  run(`UPDATE notifications SET
       status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
       provider = COALESCE(?, provider), last_error = ?, updated_at = datetime('now')
       WHERE id = ?`, provider ?? null, String(error).slice(0, 1000), id).changes;

/** Provider deliberately not configured - recorded honestly, never as "sent". */
export const markNotConfigured = (id, note) =>
  run(`UPDATE notifications SET status = 'not_configured', last_error = ?,
       updated_at = datetime('now') WHERE id = ?`, note, id).changes;

export const resetForRetry = (id) =>
  run(`UPDATE notifications SET status = 'queued', attempts = 0, last_error = NULL,
       max_attempts = MAX(max_attempts, 3), scheduled_for = NULL,
       updated_at = datetime('now') WHERE id = ?`, id).changes;

export function log(notificationId, entry) {
  run(
    `INSERT INTO notification_logs (notification_id, attempt, status, http_status, response_body, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    notificationId, entry.attempt ?? 0, entry.status,
    entry.http_status ?? null,
    entry.response_body ? String(entry.response_body).slice(0, 4000) : null,
    entry.error ? String(entry.error).slice(0, 1000) : null
  );
}

export const logsFor = (id) =>
  all('SELECT * FROM notification_logs WHERE notification_id = ? ORDER BY id DESC', id);

export function list({ status, channel, limit = 100, offset = 0 } = {}) {
  const rows = all(
    `SELECT n.*, a.ref AS appointment_ref FROM notifications n
     LEFT JOIN appointments a ON a.id = n.appointment_id
     WHERE (? IS NULL OR n.status = ?) AND (? IS NULL OR n.channel = ?)
     ORDER BY n.id DESC LIMIT ? OFFSET ?`,
    status ?? null, status ?? null, channel ?? null, channel ?? null, limit, offset);
  const total = one(
    `SELECT COUNT(*) AS c FROM notifications
     WHERE (? IS NULL OR status = ?) AND (? IS NULL OR channel = ?)`,
    status ?? null, status ?? null, channel ?? null, channel ?? null).c;
  return { rows, total };
}

export const failedCount = () =>
  one(`SELECT COUNT(*) AS c FROM notifications WHERE status = 'failed'`).c;

/* In-dashboard admin alerts */
export function pushAdmin(a) {
  run('INSERT INTO admin_notifications (type, title, body, link, severity) VALUES (?, ?, ?, ?, ?)',
    a.type, a.title, a.body ?? null, a.link ?? null, a.severity || 'info');
}
export const listAdmin = (limit = 30) =>
  all('SELECT * FROM admin_notifications ORDER BY id DESC LIMIT ?', limit);
export const unreadAdminCount = () =>
  one('SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read = 0').c;
export const markAdminRead = (id) =>
  run(`UPDATE admin_notifications SET is_read = 1, read_at = datetime('now') WHERE id = ?`, id).changes;
export const markAllAdminRead = () =>
  run(`UPDATE admin_notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0`).changes;
