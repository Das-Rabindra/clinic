import { one, all, run, buildUpdate } from './base.js';
import { hashPassword } from '../utils/crypto.js';

const SAFE = 'id, email, name, role, is_active, must_change_password, last_login_at, created_at, locked_until';

export const findByEmail = async (email) =>
  await one('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', String(email).toLowerCase().trim());

export const findById = async (id) => await one('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', id);
export const findPublicById = async (id) => await one(`SELECT ${SAFE} FROM users WHERE id = ? AND deleted_at IS NULL`, id);
export const list = async () => await all(`SELECT ${SAFE} FROM users WHERE deleted_at IS NULL ORDER BY id`);
export const count = async () => (await one('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL')).c;

export async function create({ email, name, password, role = 'staff', mustChange = 0 }) {
  const { hash, salt } = hashPassword(password);
  const info = await run(
    `INSERT INTO users (email, name, password_hash, password_salt, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    String(email).toLowerCase().trim(), name, hash, salt, role, mustChange ? 1 : 0
  );
  return await findPublicById(info.lastInsertRowid);
}

export async function setPassword(id, password) {
  const { hash, salt } = hashPassword(password);
  return (await run(
    `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0,
     failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ?`,
    hash, salt, id
  )).changes;
}

export const update = async (id, fields) =>
  await buildUpdate('users', id, fields, ['email', 'name', 'role', 'is_active']);

export const softDelete = async (id) =>
  (await run(`UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE id = ?`, id)).changes;

export const recordLoginSuccess = async (id) =>
  await run(`UPDATE users SET last_login_at = NOW(), failed_attempts = 0,
       locked_until = NULL, updated_at = NOW() WHERE id = ?`, id);

/** Lock for 15 minutes after 8 consecutive failures. */
export async function recordLoginFailure(id) {
  await run(`UPDATE users SET failed_attempts = failed_attempts + 1,
       locked_until = CASE WHEN failed_attempts + 1 >= 8
         THEN NOW() + INTERVAL '+15 minutes' ELSE locked_until END,
       updated_at = NOW() WHERE id = ?`, id);
}
