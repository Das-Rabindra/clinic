import { one, run, all } from './base.js';
import { config } from '../config/env.js';

/** id is sha256(token) — the raw token exists only in the user's cookie. */
export function create({ id, userId, csrfToken, ip, userAgent }) {
  run(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, absolute_expires_at, ip, user_agent)
     VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?), ?, ?)`,
    id, userId, csrfToken,
    `+${config.session.slidingHours} hours`,
    `+${config.session.absoluteDays} days`,
    ip || null, userAgent || null
  );
}

export const find = (id) =>
  one(`SELECT s.*, u.email, u.name, u.role, u.is_active, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL
         AND s.expires_at > datetime('now')
         AND s.absolute_expires_at > datetime('now')
         AND u.deleted_at IS NULL`, id);

/** Sliding expiry, capped by absolute_expires_at. */
export const touch = (id) =>
  run(`UPDATE sessions SET expires_at = MIN(datetime('now', ?), absolute_expires_at),
       updated_at = datetime('now') WHERE id = ?`,
    `+${config.session.slidingHours} hours`, id);

export const revoke = (id) =>
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?`, id).changes;

export const revokeAllForUser = (userId) =>
  run(`UPDATE sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`, userId).changes;

export const listForUser = (userId) =>
  all(`SELECT id, ip, user_agent, created_at, expires_at FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
       ORDER BY created_at DESC`, userId);

export const purgeExpired = () =>
  run(`DELETE FROM sessions WHERE absolute_expires_at < datetime('now')
        OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))`).changes;
