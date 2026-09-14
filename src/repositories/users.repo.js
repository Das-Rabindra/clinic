import { one, all, run, buildUpdate } from './base.js';
import { hashPassword } from '../utils/crypto.js';

const SAFE = 'id, email, name, role, is_active, must_change_password, last_login_at, created_at, locked_until';

export const findByEmail = (email) =>
  one('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', String(email).toLowerCase().trim());

export const findById = (id) => one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', id);
export const findPublicById = (id) => one(`SELECT ${SAFE} FROM users WHERE id = ? AND deleted_at IS NULL`, id);
export const list = () => all(`SELECT ${SAFE} FROM users WHERE deleted_at IS NULL ORDER BY id`);
export const count = () => one('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL').c;

export function create({ email, name, password, role = 'staff', mustChange = 0 }) {
  const { hash, salt } = hashPassword(password);
  const info = run(
    `INSERT INTO users (email, name, password_hash, password_salt, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    String(email).toLowerCase().trim(), name, hash, salt, role, mustChange ? 1 : 0
  );
  return findPublicById(info.lastInsertRowid);
}

export function setPassword(id, password) {
  const { hash, salt } = hashPassword(password);
  return run(
    `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0,
     failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`,
    hash, salt, id
  ).changes;
}

export const update = (id, fields) =>
  buildUpdate('users', id, fields, ['email', 'name', 'role', 'is_active']);

export const softDelete = (id) =>
  run(`UPDATE users SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?`, id).changes;

export const recordLoginSuccess = (id) =>
  run(`UPDATE users SET last_login_at = datetime('now'), failed_attempts = 0,
       locked_until = NULL, updated_at = datetime('now') WHERE id = ?`, id);

/** Lock for 15 minutes after 8 consecutive failures. */
export function recordLoginFailure(id) {
  run(`UPDATE users SET failed_attempts = failed_attempts + 1,
       locked_until = CASE WHEN failed_attempts + 1 >= 8
         THEN datetime('now', '+15 minutes') ELSE locked_until END,
       updated_at = datetime('now') WHERE id = ?`, id);
}
