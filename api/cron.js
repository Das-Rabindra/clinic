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

  // Vercel Cron sends the secret as a Bearer token automatically.
  if (secret && supplied !== secret) {
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
