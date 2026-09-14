/**
 * Durable job runner.
 *
 * Reminders must fire whether or not anyone has a browser open, so they live in
 * the `jobs` table rather than in a timer's memory. Two ways to drain them:
 *
 *   long-running server — start() polls on an interval
 *   serverless (Vercel) — /api/cron calls runOnce() on a schedule, since a
 *                         function stops the moment it responds
 *
 * Either way the queue is the source of truth, so a missed tick only delays
 * work rather than losing it.
 */
import crypto from 'node:crypto';
import * as jobsRepo from '../repositories/jobs.repo.js';
import * as sessionsRepo from '../repositories/sessions.repo.js';
import * as notifications from '../services/notification/index.js';
import { config } from '../config/env.js';
import { handlers } from './handlers/index.js';

const workerId = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
let timer = null;
let running = false;
let ticks = 0;

async function tick() {
  if (running) return { skipped: 'already running' };
  running = true;
  const summary = { jobs: 0, failed: 0, notifications: null };
  try {
    await jobsRepo.requeueStale(10);

    const claimed = await jobsRepo.claimDue(workerId, 10);
    for (const job of claimed) {
      const handler = handlers[job.kind];
      if (!handler) {
        await jobsRepo.fail(job.id, `No handler for job kind "${job.kind}"`);
        continue;
      }
      try {
        let payload = {};
        try { payload = JSON.parse(job.payload_json || '{}'); } catch { /* keep {} */ }
        await handler(payload, job);
        await jobsRepo.complete(job.id);
        summary.jobs++;
      } catch (err) {
        console.error(`[jobs] ${job.kind}#${job.id} failed:`, err.message);
        await jobsRepo.fail(job.id, err.message);
        summary.failed++;
      }
    }

    // Drain queued notifications (including retries with remaining attempts).
    summary.notifications = await notifications.processQueue(20);

    // Housekeeping: every 30 minutes on a server, every run on a cron tick.
    const every = Math.max(1, Math.round(1800000 / config.jobs.pollMs));
    if (config.isServerless || ++ticks % every === 0) {
      await sessionsRepo.purgeExpired();
      await jobsRepo.purgeDone(14);
    }
  } catch (err) {
    console.error('[jobs] tick error:', err.message);
    summary.error = err.message;
  } finally {
    running = false;
  }
  return summary;
}

export async function start() {
  if (!config.jobs.enabled) {
    console.log('[jobs] runner disabled (RUN_JOBS=false)');
    return null;
  }
  if (timer) return timer;
  timer = setInterval(tick, config.jobs.pollMs);
  timer.unref();
  console.log(`[jobs] runner started (worker ${workerId}, every ${config.jobs.pollMs / 1000}s)`);
  setTimeout(tick, 2000).unref();   // first pass shortly after boot
  return timer;
}

export async function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Exposed for tests and for the admin "run now" action. */
export const runOnce = tick;
