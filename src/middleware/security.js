/** Security response headers. CSP is tuned to what the pages actually load. */
import { config } from '../config/env.js';

/**
 * Origins that may serve images.
 *
 * `blob:` is the URI *scheme* used by client-side object URLs — it has nothing
 * to do with Vercel Blob, which serves from its own https host. Without that
 * host listed, every uploaded photo was fetched successfully and then refused
 * by the browser: the site showed empty frames while curl reported 200, and an
 * admin who had just uploaded a photo had no way to tell why it never appeared.
 *
 * The bucket subdomain is generated per store, so the wildcard is the only
 * stable way to express it. An explicit BLOB_BASE_URL narrows it to one origin.
 */
export function imageSources(driver, blobBaseUrl = '') {
  const sources = ["'self'", 'data:', 'blob:',
    // Google review author avatars.
    'https://*.googleusercontent.com', 'https://*.ggpht.com'];

  if (driver === 'blob') {
    let origin = 'https://*.public.blob.vercel-storage.com';
    if (blobBaseUrl) {
      try { origin = new URL(blobBaseUrl).origin; } catch { /* keep the wildcard */ }
    }
    sources.push(origin);
  }
  return sources.join(' ');
}

const CSP_PUBLIC = [
  "default-src 'self'",
  // Inline styles/scripts are used by the original design; hashes would break
  // on every content edit, so the inline allowance is scoped and no remote
  // script origins are permitted beyond the font/maps hosts below.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src ${imageSources(config.storage.driver, config.storage.blobBaseUrl)}`,
  // Google Maps, and the OpenStreetMap embed used when the clinic has set
  // exact coordinates.
  "frame-src https://www.google.com https://maps.google.com https://www.openstreetmap.org",
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
