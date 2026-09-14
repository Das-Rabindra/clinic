/**
 * Durable in-process job runner.
 *
 * Reminders must fire whether or not anyone has a browser open (spec §20), so
 * they live in the `jobs` table and are polled here. Setting RUN_JOBS=false
 * lets this be split into a dedicated worker container without code changes.
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
  if (running) return;
  running = true;
  try {
    jobsRepo.requeueStale(10);

    const claimed = jobsRepo.claimDue(workerId, 10);
    for (const job of claimed) {
      const handler = handlers[job.kind];
      if (!handler) {
        jobsRepo.fail(job.id, `No handler for job kind "${job.kind}"`);
        continue;
      }
      try {
        let payload = {};
        try { payload = JSON.parse(job.payload_json || '{}'); } catch { /* keep {} */ }
        await handler(payload, job);
        jobsRepo.complete(job.id);
      } catch (err) {
        console.error(`[jobs] ${job.kind}#${job.id} failed:`, err.message);
        jobsRepo.fail(job.id, err.message);
      }
    }

    // Drain queued notifications (including retries with remaining attempts).
    await notifications.processQueue(20);

    // Housekeeping roughly every 30 minutes.
    if (++ticks % Math.max(1, Math.round(1800000 / config.jobs.pollMs)) === 0) {
      sessionsRepo.purgeExpired();
      jobsRepo.purgeDone(14);
    }
  } catch (err) {
    console.error('[jobs] tick error:', err.message);
  } finally {
    running = false;
  }
}

export function start() {
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

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Exposed for tests and for the admin "run now" action. */
export const runOnce = tick;
