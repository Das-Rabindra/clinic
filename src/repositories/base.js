/**
 * Helpers shared by repositories. Everything is a parameterised query — there
 * is no string-built SQL anywhere in this directory.
 *
 * `one`, `all` and `run` are async (PostgreSQL). Most repository functions are
 * one-line arrow expressions that simply return the promise, so callers await
 * the repository rather than the repository awaiting internally.
 */
export { one, all, run, tx, isUniqueViolation } from '../db/index.js';

import { one, run } from '../db/index.js';

/** Build `SET a=@a, b=@b` from an allow-list. Keys are never user-supplied. */
export async function buildUpdate(table, id, fields, allowed) {
  const keys = Object.keys(fields).filter(k => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return 0;
  const set = keys.map(k => `${k} = @${k}`).join(', ');
  const params = { __id: id };
  for (const k of keys) {
    // Postgres rejects JS booleans for integer columns; normalise here, at the
    // single boundary where values reach a statement.
    params[k] = typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k];
  }
  const res = await run(
    `UPDATE ${table} SET ${set}, updated_at = NOW() WHERE id = @__id`,
    params
  );
  return res.changes;
}

/** SQLite stored booleans as 0/1 and Postgres keeps that convention here. */
export const bool = (v) => (v ? 1 : 0);
export const toBool = (v) => v === 1 || v === true;

/**
 * Next zero-padded human-facing code, drawn from a Postgres sequence.
 *
 * The previous SELECT MAX(...)+1 approach was not concurrency-safe: two
 * bookings committing at the same instant computed the same reference and one
 * failed on the unique index, even when they were for different slots. nextval
 * is atomic. Numbers may skip when a transaction rolls back, which is fine for
 * a reference code.
 */
export async function nextSeq(sequence, prefix, width) {
  const row = await one(`SELECT nextval($1)::bigint AS n`, sequence);
  return prefix + String(row.n).padStart(width, '0');
}
