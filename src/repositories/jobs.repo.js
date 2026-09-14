/**
 * Durable job queue backed by SQLite. Survives restarts, needs no Redis.
 * claimDue() uses a conditional UPDATE so two workers cannot take the same job.
 */
import { db } from '../db/index.js';
import { one, all, run } from './base.js';

export function enqueue({ kind, payload = {}, runAt = new Date(), dedupeKey = null, maxAttempts = 5 }) {
  const runIso = (runAt instanceof Date ? runAt : new Date(runAt)).toISOString();
  try {
    const info = run(
      `INSERT INTO jobs (kind, payload_json, run_at, dedupe_key, max_attempts)
       VALUES (?, ?, ?, ?, ?)`,
      kind, JSON.stringify(payload), runIso, dedupeKey, maxAttempts
    );
    return Number(info.lastInsertRowid);
  } catch (err) {
    if (String(err.code).includes('CONSTRAINT_UNIQUE') && dedupeKey) {
      return one('SELECT id FROM jobs WHERE dedupe_key = ?', dedupeKey)?.id ?? null;
    }
    throw err;
  }
}

/** Atomically claim up to `limit` due jobs for this worker. */
export function claimDue(workerId, limit = 10) {
  const claim = db.transaction(() => {
    const rows = all(
      `SELECT id FROM jobs WHERE status = 'pending' AND run_at <= ? AND attempts < max_attempts
       ORDER BY run_at LIMIT ?`, new Date().toISOString(), limit);
    const claimed = [];
    for (const { id } of rows) {
      const res = run(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1,
         locked_at = datetime('now'), locked_by = ?, updated_at = datetime('now')
         WHERE id = ? AND status = 'pending'`, workerId, id);
      if (res.changes === 1) claimed.push(one('SELECT * FROM jobs WHERE id = ?', id));
    }
    return claimed;
  });
  return claim.immediate();
}

export const complete = (id) =>
  run(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = datetime('now') WHERE id = ?`, id);

/** Exponential backoff: 1, 2, 4, 8... minutes, capped at max_attempts. */
export function fail(id, error) {
  const job = one('SELECT attempts, max_attempts FROM jobs WHERE id = ?', id);
  if (!job) return;
  const exhausted = job.attempts >= job.max_attempts;
  const delayMin = Math.min(2 ** Math.max(0, job.attempts - 1), 60);
  run(
    `UPDATE jobs SET status = ?, run_at = ?, last_error = ?, locked_by = NULL,
     updated_at = datetime('now') WHERE id = ?`,
    exhausted ? 'failed' : 'pending',
    new Date(Date.now() + delayMin * 60000).toISOString(),
    String(error).slice(0, 1000), id
  );
}

/** A worker that died mid-job leaves 'running' rows; reclaim them. */
export const requeueStale = (minutes = 10) =>
  run(`UPDATE jobs SET status = 'pending', locked_by = NULL, updated_at = datetime('now')
       WHERE status = 'running' AND locked_at < datetime('now', ?)`, `-${minutes} minutes`).changes;

export const stats = () =>
  all('SELECT status, COUNT(*) AS c FROM jobs GROUP BY status');

export const purgeDone = (days = 14) =>
  run(`DELETE FROM jobs WHERE status = 'done' AND updated_at < datetime('now', ?)`, `-${days} days`).changes;
