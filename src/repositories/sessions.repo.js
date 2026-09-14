import { one, run, all } from './base.js';
import { config } from '../config/env.js';

/** id is sha256(token) — the raw token exists only in the user's cookie. */
export async function create({ id, userId, csrfToken, ip, userAgent }) {
  await run(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, absolute_expires_at, ip, user_agent)
     VALUES (?, ?, ?, NOW() + (?)::interval, NOW() + (?)::interval, ?, ?)`,
    id, userId, csrfToken,
    `+${config.session.slidingHours} hours`,
    `+${config.session.absoluteDays} days`,
    ip || null, userAgent || null
  );
}

export const find = async (id) =>
  await one(`SELECT s.*, u.email, u.name, u.role, u.is_active, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND s.absolute_expires_at > NOW()
         AND u.deleted_at IS NULL`, id);

/** Sliding expiry, capped by absolute_expires_at. */
export const touch = async (id) =>
  await run(`UPDATE sessions SET expires_at = LEAST(NOW() + (?)::interval, absolute_expires_at),
       updated_at = NOW() WHERE id = ?`,
    `+${config.session.slidingHours} hours`, id);

export const revoke = async (id) =>
  (await run(`UPDATE sessions SET revoked_at = NOW() WHERE id = ?`, id)).changes;

export const revokeAllForUser = async (userId) =>
  (await run(`UPDATE sessions SET revoked_at = NOW()
       WHERE user_id = ? AND revoked_at IS NULL`, userId)).changes;

export const listForUser = async (userId) =>
  await all(`SELECT id, ip, user_agent, created_at, expires_at FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`, userId);

export const purgeExpired = async () =>
  (await run(`DELETE FROM sessions WHERE absolute_expires_at < NOW()
        OR (revoked_at IS NOT NULL AND revoked_at < NOW() + INTERVAL '-7 days')`)).changes;
