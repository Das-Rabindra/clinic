/**
 * SQLite connection. WAL mode + busy_timeout give us concurrent readers with a
 * single writer, and `BEGIN IMMEDIATE` transactions (see tx()) give the booking
 * path a real serialised write lock.
 */
import Database from 'better-sqlite3';
import { config } from '../config/env.js';

export const db = new Database(config.paths.db);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

/**
 * Run fn inside an IMMEDIATE transaction — the write lock is taken up front,
 * so two concurrent bookings serialise instead of one failing at COMMIT.
 */
export function tx(fn) {
  return db.transaction(fn).immediate();
}
/** Same, but returns a reusable transactional function taking arguments. */
export function txFn(fn) {
  const t = db.transaction(fn);
  return (...args) => t.immediate(...args);
}

export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function closeDb() {
  try { db.close(); } catch { /* already closed */ }
}
