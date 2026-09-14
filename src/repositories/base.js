/**
 * Tiny helpers shared by repositories. Everything is a prepared statement with
 * bound parameters — there is no string-built SQL anywhere in this directory.
 */
import { db } from '../db/index.js';

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

/** Build `SET a=@a, b=@b` from an allow-list. Keys are never user-supplied. */
export function buildUpdate(table, id, fields, allowed) {
  const keys = Object.keys(fields).filter(k => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return 0;
  const set = keys.map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE ${table} SET ${set}, updated_at = datetime('now') WHERE id = @__id`);
  const params = { __id: id };
  // SQLite cannot bind JS booleans; normalise them at the single boundary
  // where values reach a statement rather than at every call site.
  for (const k of keys) params[k] = typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k];
  return stmt.run(params).changes;
}

/** SQLite stores booleans as 0/1; convert at the repository boundary. */
export const bool = (v) => (v ? 1 : 0);
export const toBool = (v) => v === 1 || v === true;

/** Next zero-padded sequence for human-facing codes (patient/appointment refs). */
export function nextSeq(table, column, prefix, width) {
  const row = one(
    `SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`,
    prefix + '%'
  );
  const last = row ? parseInt(String(row.v).slice(prefix.length), 10) : 0;
  return prefix + String((Number.isFinite(last) ? last : 0) + 1).padStart(width, '0');
}
