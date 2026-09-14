import { one, all, run, isUniqueViolation } from './base.js';

export const findById = async (id) => await one('SELECT * FROM notifications WHERE id = ?', id);

/**
 * Enqueue. `dedupe_key` makes reminders idempotent: re-running the scheduler
 * cannot produce a second "24h reminder" for the same appointment.
 * Returns the existing row's id when the key is already present.
 */
export async function enqueue(n) {
  try {
    const info = await run(
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
    if (isUniqueViolation(err) && n.dedupe_key) {
      const existing = await one('SELECT id FROM notifications WHERE dedupe_key = ?', n.dedupe_key);
      return existing ? existing.id : null;
    }
    throw err;
  }
}

/** Queued notifications whose scheduled time has arrived. */
export const dueNow = async (limit = 25) =>
  await all(`SELECT * FROM notifications
       WHERE status IN ('queued')
         AND (scheduled_for IS NULL OR scheduled_for <= NOW())
         AND attempts < max_attempts
       ORDER BY id LIMIT ?`, limit);

export const markSending = async (id) =>
  (await run(`UPDATE notifications SET status = 'sending', attempts = attempts + 1,
       updated_at = NOW() WHERE id = ?`, id)).changes;

export const markSent = async (id, provider, msgId) =>
  (await run(`UPDATE notifications SET status = 'sent', provider = ?, provider_msg_id = ?,
       sent_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = ?`,
    provider, msgId ?? null, id)).changes;

/** Failed but retryable stays 'queued'; exhausted attempts become 'failed'. */
export const markFailed = async (id, error, provider) =>
  (await run(`UPDATE notifications SET
       status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
       provider = COALESCE(?, provider), last_error = ?, updated_at = NOW()
       WHERE id = ?`, provider ?? null, String(error).slice(0, 1000), id)).changes;

/** Provider deliberately not configured - recorded honestly, never as "sent". */
export const markNotConfigured = async (id, note) =>
  (await run(`UPDATE notifications SET status = 'not_configured', last_error = ?,
       updated_at = NOW() WHERE id = ?`, note, id)).changes;

export const resetForRetry = async (id) =>
  (await run(`UPDATE notifications SET status = 'queued', attempts = 0, last_error = NULL,
       max_attempts = MAX(max_attempts, 3), scheduled_for = NULL,
       updated_at = NOW() WHERE id = ?`, id)).changes;

export async function log(notificationId, entry) {
  await run(
    `INSERT INTO notification_logs (notification_id, attempt, status, http_status, response_body, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    notificationId, entry.attempt ?? 0, entry.status,
    entry.http_status ?? null,
    entry.response_body ? String(entry.response_body).slice(0, 4000) : null,
    entry.error ? String(entry.error).slice(0, 1000) : null
  );
}

export const logsFor = async (id) =>
  await all('SELECT * FROM notification_logs WHERE notification_id = ? ORDER BY id DESC', id);

export async function list({ status, channel, limit = 100, offset = 0 } = {}) {
  const rows = await all(
    `SELECT n.*, a.ref AS appointment_ref FROM notifications n
     LEFT JOIN appointments a ON a.id = n.appointment_id
     WHERE (?::text IS NULL OR n.status = ?) AND (?::text IS NULL OR n.channel = ?)
     ORDER BY n.id DESC LIMIT ? OFFSET ?`,
    status ?? null, status ?? null, channel ?? null, channel ?? null, limit, offset);
  const total = (await one(
    `SELECT COUNT(*) AS c FROM notifications
     WHERE (?::text IS NULL OR status = ?) AND (?::text IS NULL OR channel = ?)`,
    status ?? null, status ?? null, channel ?? null, channel ?? null)).c;
  return { rows, total };
}

export const failedCount = async () =>
  (await one(`SELECT COUNT(*) AS c FROM notifications WHERE status = 'failed'`)).c;

/* In-dashboard admin alerts */
export async function pushAdmin(a) {
  await run('INSERT INTO admin_notifications (type, title, body, link, severity) VALUES (?, ?, ?, ?, ?)',
    a.type, a.title, a.body ?? null, a.link ?? null, a.severity || 'info');
}
export const listAdmin = async (limit = 30) =>
  await all('SELECT * FROM admin_notifications ORDER BY id DESC LIMIT ?', limit);
export const unreadAdminCount = async () =>
  (await one('SELECT COUNT(*) AS c FROM admin_notifications WHERE is_read = 0')).c;
export const markAdminRead = async (id) =>
  (await run(`UPDATE admin_notifications SET is_read = 1, read_at = NOW() WHERE id = ?`, id)).changes;
export const markAllAdminRead = async () =>
  (await run(`UPDATE admin_notifications SET is_read = 1, read_at = NOW() WHERE is_read = 0`)).changes;
