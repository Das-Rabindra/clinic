/** Security response headers. CSP is tuned to what the pages actually load. */
import { config } from '../config/env.js';

const CSP_PUBLIC = [
  "default-src 'self'",
  // Inline styles/scripts are used by the original design; hashes would break
  // on every content edit, so the inline allowance is scoped and no remote
  // script origins are permitted beyond the font/maps hosts below.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
  "frame-src https://www.google.com https://maps.google.com",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.set('Content-Security-Policy', CSP_PUBLIC);
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd && config.trustProxy) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // The admin console must never be framed or cached.
  if (req.path.startsWith('/admin')) {
    res.set('Cache-Control', 'no-store, must-revalidate');
  }
  res.removeHeader('X-Powered-By');
  next();
}
