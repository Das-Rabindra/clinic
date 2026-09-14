import { one, all, run } from './base.js';

export async function write(entry) {
  await run(
    `INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, summary,
       before_json, after_json, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.user_id ?? null, entry.user_email ?? null, entry.action,
    entry.entity ?? null, entry.entity_id != null ? String(entry.entity_id) : null,
    entry.summary ?? null, entry.before_json ?? null, entry.after_json ?? null,
    entry.ip ?? null, entry.user_agent ?? null
  );
}

export async function list({ q, entity, userId, limit = 100, offset = 0 } = {}) {
  const rows = await all(
    `SELECT a.*, u.name AS user_name FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE (?::text IS NULL OR a.entity = ?)
       AND (?::int IS NULL OR a.user_id = ?)
       AND (?::text IS NULL OR a.action LIKE ? OR a.summary LIKE ?)
     ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    entity ?? null, entity ?? null,
    userId ?? null, userId ?? null,
    q ?? null, `%${q ?? ''}%`, `%${q ?? ''}%`,
    limit, offset);
  const total = (await one(
    `SELECT COUNT(*) AS c FROM audit_logs a
     WHERE (?::text IS NULL OR a.entity = ?) AND (?::int IS NULL OR a.user_id = ?)
       AND (?::text IS NULL OR a.action LIKE ? OR a.summary LIKE ?)`,
    entity ?? null, entity ?? null, userId ?? null, userId ?? null,
    q ?? null, `%${q ?? ''}%`, `%${q ?? ''}%`)).c;
  return { rows, total };
}

export const forEntity = async (entity, entityId, limit = 50) =>
  await all(`SELECT a.*, u.name AS user_name FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT ?`,
    entity, String(entityId), limit);
