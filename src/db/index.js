/**
 * PostgreSQL connection and query adapter.
 *
 * Replaces the previous synchronous better-sqlite3 layer. Three adapter
 * decisions keep the repositories readable and close to their original shape:
 *
 *   1. Named `@param` and positional `?` placeholders are rewritten to `$n`,
 *      so repository SQL reads the same as before.
 *   2. `run()` returns `{ changes, lastInsertRowid }`, matching the shape the
 *      repositories already destructure. INSERTs get `RETURNING id` appended
 *      automatically unless the statement already has a RETURNING clause.
 *   3. Transactions propagate their client through AsyncLocalStorage, so a
 *      repository function called inside tx() transparently uses the
 *      transaction's connection without every signature growing a `client`
 *      argument.
 *
 * Timestamps are TIMESTAMPTZ in the database but are parsed back into
 * 'YYYY-MM-DD HH:MM:SS' UTC strings, exactly matching what SQLite returned,
 * so date handling throughout the application is unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config } from '../config/env.js';

const { Pool, types } = pg;

/* ── Type parsers ─────────────────────────────────────────────────────────
   Render timestamps as the UTC string format the app already expects, and
   keep bigint/numeric as JS numbers rather than strings. */
const toUtcString = (raw) => {
  if (raw == null) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace('T', ' ').slice(0, 19);
};
types.setTypeParser(1114, toUtcString);          // timestamp
types.setTypeParser(1184, toUtcString);          // timestamptz
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

/* ── Pool ─────────────────────────────────────────────────────────────────
   Kept small: serverless invocations each hold their own pool, and Neon's
   pooled endpoint multiplexes behind the scenes. */
export const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  max: config.database.poolMax,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 15_000,
  allowExitOnIdle: true,
});

pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/** Holds the active transaction client for the duration of tx(). */
const txStore = new AsyncLocalStorage();
const activeClient = () => txStore.getStore()?.client ?? null;

/**
 * Rewrite `@name` / `?` placeholders into `$n` and build the value array.
 * Accepts either a single object of named params or positional arguments.
 */
export function prepare(sql, params) {
  const named = params.length === 1
    && params[0] !== null
    && typeof params[0] === 'object'
    && !Array.isArray(params[0])
    && !(params[0] instanceof Date);

  if (named) {
    const source = params[0];
    const values = [];
    const seen = new Map();
    const text = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      if (!seen.has(key)) {
        values.push(normalise(source[key]));
        seen.set(key, values.length);
      }
      return `$${seen.get(key)}`;
    });
    return { text, values };
  }

  let i = 0;
  const values = params.map(normalise);
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values };
}

/** SQLite accepted booleans and undefined; Postgres does not. */
function normalise(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

async function exec(sql, params) {
  const { text, values } = prepare(sql, params);
  const client = activeClient();
  if (client) return client.query(text, values);
  return pool.query(text, values);
}

/* ── Query helpers (async counterparts of the previous sync API) ─────────── */

export async function one(sql, ...params) {
  const res = await exec(sql, params);
  return res.rows[0];
}

export async function all(sql, ...params) {
  const res = await exec(sql, params);
  return res.rows;
}

/**
 * Execute a write. Returns `{ changes, lastInsertRowid }`.
 * An INSERT without an explicit RETURNING gets `RETURNING id` appended so the
 * generated key is available, matching better-sqlite3's lastInsertRowid.
 */
export async function run(sql, ...params) {
  let text = sql;
  const isInsert = /^\s*INSERT\s/i.test(sql);
  const hasReturning = /\bRETURNING\b/i.test(sql);
  if (isInsert && !hasReturning) text = `${sql.replace(/;\s*$/, '')} RETURNING id`;

  let res;
  try {
    res = await exec(text, params);
  } catch (err) {
    // A table without an `id` column (none currently) would fail on the
    // appended RETURNING; fall back to the original statement.
    if (isInsert && !hasReturning && err.code === '42703') {
      res = await exec(sql, params);
    } else {
      throw err;
    }
  }
  return {
    changes: res.rowCount ?? 0,
    lastInsertRowid: res.rows?.[0]?.id ?? null,
  };
}

/** Run raw SQL (migrations). No placeholder rewriting. */
export async function exec_raw(sql) {
  const client = activeClient();
  if (client) return client.query(sql);
  return pool.query(sql);
}

/**
 * Run fn inside a transaction.
 *
 * Postgres does not need SQLite's BEGIN IMMEDIATE: under the default READ
 * COMMITTED isolation, two concurrent inserts of the same unique key cause one
 * to block until the other commits and then fail with a unique violation —
 * which is exactly the double-booking guarantee the booking path relies on.
 */
export async function tx(fn) {
  const existing = activeClient();
  if (existing) return fn();            // already inside a transaction

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStore.run({ client }, () => fn());
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/** True when an error is a unique-constraint violation. */
export const isUniqueViolation = (err) => err?.code === '23505';

/**
 * True when the violation is specifically the appointment slot index.
 *
 * Distinguishing this matters: reporting *any* unique violation as
 * "that slot was just taken" would mislead the patient when the real cause was
 * something else entirely.
 */
export const isSlotConflict = (err) =>
  isUniqueViolation(err) && /appointment_slots/.test(err?.constraint || err?.detail || '');

export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export async function closeDb() {
  try { await pool.end(); } catch { /* already closed */ }
}

/** Verify connectivity; used by the health check and at boot. */
export async function ping() {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}
