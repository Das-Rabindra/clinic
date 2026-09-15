/**
 * Deployment diagnostics.
 *
 * Reports which configuration the *running* deployment can actually see, so a
 * misconfigured environment can be diagnosed from the admin panel rather than
 * by guessing from a 500. Owner-only, and it never returns a secret's value —
 * only whether one is present and, where it is safe, a masked fingerprint.
 */
import { Router } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/error.js';
import { config } from '../../config/env.js';
import * as storage from '../../services/storage/index.js';
import { ping } from '../../db/index.js';
import { ROLES } from '../../config/constants.js';

const router = Router();

/** Never reveal a secret; show only that it exists and how long it is. */
const present = (name) => {
  const v = process.env[name];
  if (!v) return { set: false };
  return { set: true, length: v.length, starts: v.slice(0, 4) + '…' };
};

router.get('/diagnostics', requireRole(ROLES.OWNER), asyncHandler(async (_req, res) => {
  const checks = {};

  // Database
  try { checks.database = { ok: await ping(), url_host: new URL(config.database.url).host }; }
  catch (err) { checks.database = { ok: false, error: err.message }; }

  // Storage: actually exercise it rather than just reporting the token.
  const probe = `diagnostics/${Date.now()}.txt`;
  try {
    await storage.put(probe, Buffer.from('ok'), 'text/plain');
    await storage.remove(probe);
    checks.storage = { driver: storage.driverName(), ok: true };
  } catch (err) {
    checks.storage = {
      driver: storage.driverName(),
      ok: false,
      code: err.code || null,
      error: String(err.message).slice(0, 400),
    };
  }

  // Surface the problems worth acting on rather than leaving them to be
  // inferred from the raw values below.
  const warnings = [];
  if (config.publicUrl.includes('localhost')) {
    warnings.push('PUBLIC_URL is not set: canonical and Open Graph tags point at localhost, '
      + 'so search engines index the wrong URL and shared links will not preview.');
  }
  if (!process.env.CRON_SECRET) {
    warnings.push('CRON_SECRET is not set: /api/cron can be triggered by anyone who finds it.');
  }
  if (!checks.storage.ok) {
    warnings.push(`Image uploads will fail: ${checks.storage.error}`);
  }
  if (!checks.database.ok) warnings.push('The database is unreachable.');

  res.json({
    warnings,
    runtime: {
      serverless: config.isServerless,
      env: config.env,
      public_url: config.publicUrl,
      public_url_is_localhost: config.publicUrl.includes('localhost'),
    },
    env_vars: {
      APP_SECRET: present('APP_SECRET'),
      DATABASE_URL: present('DATABASE_URL'),
      BLOB_READ_WRITE_TOKEN: present('BLOB_READ_WRITE_TOKEN'),
      PUBLIC_URL: present('PUBLIC_URL'),
      CRON_SECRET: present('CRON_SECRET'),
      STORAGE_DRIVER: present('STORAGE_DRIVER'),
    },
    checks,
  });
}));

export default router;
