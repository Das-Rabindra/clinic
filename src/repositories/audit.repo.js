import { one, all, run } from './base.js';

export function write(entry) {
  run(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, summary,
       before_json, after_json, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.user_id ?? null, entry.user_email ?? null, entry.action,
    entry.entity ?? null, entry.entity_id != null ? String(entry.entity_id) : null,
    entry.summary ?? null, entry.before_json ?? null, entry.after_json ?? null,
    entry.ip ?? null, entry.user_agent ?? null
  );
}

export function list({ q, entity, userId, limit = 100, offset = 0 } = {}) {
  const rows = all(
    `SELECT a.*, u.name AS user_name FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE (? IS NULL OR a.entity = ?)
       AND (? IS NULL OR a.user_id = ?)
       AND (? IS NULL OR a.action LIKE ? OR a.summary LIKE ?)
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    entity ?? null, entity ?? null,
    userId ?? null, userId ?? null,
    q ?? null, `%${q ?? ''}%`, `%${q ?? ''}%`,
    limit, offset);
  const total = one(
    `SELECT COUNT(*) AS c FROM audit_logs a
     WHERE (? IS NULL OR a.entity = ?) AND (? IS NULL OR a.user_id = ?)
       AND (? IS NULL OR a.action LIKE ? OR a.summary LIKE ?)`,
    entity ?? null, entity ?? null, userId ?? null, userId ?? null,
    q ?? null, `%${q ?? ''}%`, `%${q ?? ''}%`).c;
  return { rows, total };
}

export const forEntity = (entity, entityId, limit = 50) =>
  all(`SELECT a.*, u.name AS user_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT ?`,
    entity, String(entityId), limit);
