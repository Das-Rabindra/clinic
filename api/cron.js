/**
 * Scheduled work for serverless deployments.
 *
 * The in-process job runner cannot exist on Vercel — a function stops as soon
 * as it responds — so this endpoint drains the queue instead. Vercel Cron calls
 * it on a schedule; any external pinger works equally well and gives finer
 * granularity than the Hobby plan's once-a-day limit.
 *
 * Protected by CRON_SECRET so it cannot be triggered by anyone who finds it.
 */
import { runOnce } from '../src/jobs/scheduler.js';
import { closeDb } from '../src/db/index.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    || req.query?.key;

  /*
   * Fail closed. Previously an unset CRON_SECRET left this endpoint open to
   * anyone who guessed the path, letting them drain the notification queue at
   * will. Two callers are now accepted:
   *
   *   1. A matching CRON_SECRET (Vercel Cron sends it as a Bearer token, and
   *      an external pinger can pass ?key=).
   *   2. Vercel's own scheduler, identified by x-vercel-cron. The platform
   *      strips inbound x-vercel-* headers, so this cannot be forged from
   *      outside — it just means the deployment works before the secret is set.
   */
  const fromVercelCron = Boolean(req.headers['x-vercel-cron']);
  const authorised = secret ? (supplied === secret || fromVercelCron) : fromVercelCron;
  if (!authorised) {
    return res.status(401).json({ error: 'Unauthorised.', code: 'UNAUTHENTICATED' });
  }

  try {
    const result = await runOnce();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron] tick failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (process.env.VERCEL) await closeDb();
  }
}
