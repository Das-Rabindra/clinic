/**
 * Rate limiting.
 *
 * A serverless invocation is short-lived and isolated, so an in-process Map
 * resets constantly and provides no real protection. On Vercel the counters
 * live in Postgres; on a long-running server the in-process path is kept
 * because it avoids a database round trip per request.
 */
import { one, run } from '../db/index.js';
import { config } from '../config/env.js';

/* ── In-process backend (long-running server) ───────────────────────────── */
const buckets = new Map();
if (!config.isServerless) {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }, 60000).unref();
}

function hitMemory(id, windowMs, max) {
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(id, b); }
  b.count++;
  return { count: b.count, resetAt: b.resetAt, limited: b.count > max };
}

/* ── Postgres backend (serverless) ──────────────────────────────────────── */
async function hitDb(id, windowMs, max) {
  const row = await one(
    `INSERT INTO rate_limits (id, count, reset_at)
     VALUES (@id, 1, NOW() + (@window)::interval)
     ON CONFLICT (id) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= NOW() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= NOW()
                       THEN NOW() + (@window)::interval ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    { id, window: `${Math.round(windowMs / 1000)} seconds` }
  );
  return {
    count: row.count,
    resetAt: new Date(row.reset_at + 'Z').getTime(),
    limited: row.count > max,
  };
}

export function rateLimit({ windowMs, max, key, message }) {
  return async (req, res, next) => {
    const id = `${key}:${req.ip || 'unknown'}`;
    let hit;
    try {
      hit = config.isServerless
        ? await hitDb(id, windowMs, max)
        : hitMemory(id, windowMs, max);
    } catch (err) {
      // Never let the limiter's own failure block a patient from booking.
      console.error('[ratelimit] backend error, allowing request:', err.message);
      return next();
    }

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - hit.count)));
    if (hit.limited) {
      const retry = Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({
        error: message || 'Too many requests. Please try again shortly.',
        code: 'RATE_LIMITED', retry_after: retry,
      });
    }
    next();
  };
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60000, max: 8, key: 'login',
  message: 'Too many sign-in attempts. Please wait a few minutes.',
});
export const bookingLimiter = rateLimit({
  windowMs: 60 * 60000, max: 6, key: 'booking',
  message: 'Too many booking attempts from this device. Please call the clinic instead.',
});
export const enquiryLimiter = rateLimit({
  windowMs: 60 * 60000, max: 5, key: 'enquiry',
  message: 'Too many enquiries from this device. Please call the clinic instead.',
});
export const apiLimiter = rateLimit({ windowMs: 60000, max: 120, key: 'api' });
export const lookupLimiter = rateLimit({
  windowMs: 10 * 60000, max: 20, key: 'lookup',
  message: 'Too many lookups. Please try again later.',
});

/** Test helper. */
export const _reset = async () => {
  buckets.clear();
  if (config.isServerless) { try { await run('DELETE FROM rate_limits'); } catch { /* table may not exist yet */ } }
};
