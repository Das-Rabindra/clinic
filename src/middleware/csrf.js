/**
 * Double-submit CSRF protection for cookie-authenticated writes.
 * The token lives in the session row and is echoed in a readable cookie; a
 * cross-site page can send the cookie but cannot read it to set the header.
 */
import { config } from '../config/env.js';
import { randomToken } from '../utils/crypto.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Public (unauthenticated) forms get a cookie-only token pair. */
export function issuePublicToken(req, res) {
  let token = req.cookies?.[config.session.csrfCookie];
  if (!token) {
    token = randomToken(24);
    res.cookie(config.session.csrfCookie, token, {
      httpOnly: false, sameSite: 'lax', secure: config.session.secureCookies,
      path: '/', maxAge: 12 * 3600000,
    });
  }
  return token;
}

/** Mirror the session's CSRF token into a readable cookie after login. */
export function setSessionCsrfCookie(res, token) {
  res.cookie(config.session.csrfCookie, token, {
    httpOnly: false, sameSite: 'lax', secure: config.session.secureCookies,
    path: '/', maxAge: config.session.absoluteDays * 86400000,
  });
}

const headerToken = (req) =>
  req.get('x-csrf-token') || req.body?._csrf || null;

/** Authenticated writes must match the token stored on the session row. */
export function requireCsrf(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const supplied = headerToken(req);
  const expected = req.session?.csrfToken;
  if (!expected || !supplied || supplied !== expected) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token. Please reload and try again.', code: 'CSRF' });
  }
  next();
}

/** Public writes (booking, enquiry) match against the cookie token. */
export function requirePublicCsrf(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const supplied = headerToken(req);
  const cookie = req.cookies?.[config.session.csrfCookie];
  if (!cookie || !supplied || supplied !== cookie) {
    return res.status(403).json({ error: 'Your session expired. Please reload the page and try again.', code: 'CSRF' });
  }
  next();
}
