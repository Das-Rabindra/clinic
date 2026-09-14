/**
 * Durable job queue backed by PostgreSQL.
 *
 * Survives restarts and needs no Redis. Unlike the SQLite version, which had to
 * claim jobs one at a time inside a transaction, Postgres can claim a batch
 * atomically in a single statement using FOR UPDATE SKIP LOCKED — two workers
 * racing the same queue simply take different rows.
 */
import { one, all, run, isUniqueViolation } from '../db/index.js';

export async function enqueue({ kind, payload = {}, runAt = new Date(), dedupeKey = null, maxAttempts = 5 }) {
  const runIso = (runAt instanceof Date ? runAt : new Date(runAt)).toISOString();
  try {
    const info = await run(
      `INSERT INTO jobs (kind, payload_json, run_at, dedupe_key, max_attempts)
       VALUES (?, ?, ?, ?, ?)`,
      kind, JSON.stringify(payload), runIso, dedupeKey, maxAttempts
    );
    return info.lastInsertRowid;
  } catch (err) {
    if (isUniqueViolation(err) && dedupeKey) {
      const existing = await one('SELECT id FROM jobs WHERE dedupe_key = ?', dedupeKey);
      return existing?.id ?? null;
    }
    throw err;
  }
}

/**
 * Atomically claim up to `limit` due jobs for this worker.
 * SKIP LOCKED means concurrent workers never block each other or double-claim.
 */
export async function claimDue(workerId, limit = 10) {
  return all(
    `UPDATE jobs SET
       status = 'running',
       attempts = attempts + 1,
       locked_at = NOW(),
       locked_by = @worker,
       updated_at = NOW()
     WHERE id IN (
       SELECT id FROM jobs
       WHERE status = 'pending' AND run_at <= NOW() AND attempts < max_attempts
       ORDER BY run_at
       LIMIT @limit
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    { worker: workerId, limit }
  );
}

export const complete = (id) =>
  run(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = NOW() WHERE id = ?`, id);

/** Exponential backoff: 1, 2, 4, 8… minutes, capped, until max_attempts. */
export async function fail(id, error) {
  const job = await one('SELECT attempts, max_attempts FROM jobs WHERE id = ?', id);
  if (!job) return;
  const exhausted = job.attempts >= job.max_attempts;
  const delayMin = Math.min(2 ** Math.max(0, job.attempts - 1), 60);
  await run(
    `UPDATE jobs SET status = ?, run_at = ?, last_error = ?, locked_by = NULL,
     updated_at = NOW() WHERE id = ?`,
    exhausted ? 'failed' : 'pending',
    new Date(Date.now() + delayMin * 60000).toISOString(),
    String(error).slice(0, 1000), id
  );
}

/** A worker that died mid-job leaves 'running' rows; reclaim them. */
export const requeueStale = async (minutes = 10) => (await run(
  `UPDATE jobs SET status = 'pending', locked_by = NULL, updated_at = NOW()
   WHERE status = 'running' AND locked_at < NOW() - (?)::interval`,
  `${minutes} minutes`
)).changes;

export const stats = () => all('SELECT status, COUNT(*)::int AS c FROM jobs GROUP BY status');

export const purgeDone = async (days = 14) => (await run(
  `DELETE FROM jobs WHERE status = 'done' AND updated_at < NOW() - (?)::interval`,
  `${days} days`
)).changes;
