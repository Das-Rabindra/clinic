/**
 * Fixed-window rate limiter, in-process. Adequate for a single-instance clinic
 * deployment; swap the Map for Redis if the app is ever scaled horizontally.
 */
const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60000).unref();

export function rateLimit({ windowMs, max, key, message }) {
  return (req, res, next) => {
    const id = `${key}:${(req.ip || 'unknown')}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(id, b); }
    b.count++;
    const remaining = Math.max(0, max - b.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
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
export const apiLimiter = rateLimit({
  windowMs: 60000, max: 120, key: 'api',
});
export const lookupLimiter = rateLimit({
  windowMs: 10 * 60000, max: 20, key: 'lookup',
  message: 'Too many lookups. Please try again later.',
});

/** Test helper. */
export const _reset = () => buckets.clear();
