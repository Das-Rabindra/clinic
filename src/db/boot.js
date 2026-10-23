/**
 * Bring the database up to date for this build of the code, cheaply.
 *
 * Every serverless cold start used to run every migration check and the
 * whole seed: 135 sequential queries and a transaction that serialised
 * concurrent instances. Combined with a migration lock that could be left
 * held (see migrate.js), the first requests after a deploy sometimes waited
 * out the platform's 30-second limit and returned 504.
 *
 * Now:
 *   1. Fast path, one query: if the database records the fingerprint of
 *      exactly this code's migrations and seed, there is nothing to do.
 *   2. Otherwise, one transaction takes a transaction-level advisory lock,
 *      waiting at most LOCK_WAIT. It checks again, since another instance
 *      may just have finished, then runs migrations and the seed and records
 *      the fingerprint. Only the first cold start after a change to those
 *      files does this work.
 *   3. If another instance holds the lock longer than LOCK_WAIT, this one
 *      does not wait for the platform to kill the request. It carries on and
 *      serves, because the other instance is already doing the work.
 *
 * The fingerprint covers everything the seed's outcome depends on that
 * ships with the code: the migration files, the seed modules, the bundled
 * gallery photos, and whether a first-admin email is configured. Data the
 * seed would only recreate if someone deleted it (the settings row, say) is
 * no longer recreated on every boot; `npm run seed` still does that.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, one, run, exec_raw } from './index.js';
import { migrate, migrationFiles, MIGRATIONS_DIR } from './migrate.js';
import { seed } from './seed.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_SOURCES = ['seed.js', 'content.js', 'testimonials.js', 'gallery-content.js'];
const GALLERY_DIR = path.resolve(HERE, '../../content/gallery');
const LOCK_KEY = 3318406;          // distinct from migrate's and the gallery's
const LOCK_WAIT = '15s';           // waiting for another booting instance
const WORK_LOCK_WAIT = '10s';      // any lock the migrations or seed then need

/** A hash of everything that decides what migrate() and seed() would do. */
export function fingerprint() {
  const h = crypto.createHash('sha256');
  const add = (label, data) => { h.update(label); h.update('\0'); h.update(data); h.update('\0'); };
  for (const f of migrationFiles()) add(`migration:${f}`, fs.readFileSync(path.join(MIGRATIONS_DIR, f)));
  for (const f of SEED_SOURCES) add(`seed:${f}`, fs.readFileSync(path.join(HERE, f)));
  let photos = [];
  try { photos = fs.readdirSync(GALLERY_DIR).sort(); } catch { /* not bundled: nothing to add */ }
  for (const f of photos) add(`photo:${f}`, fs.readFileSync(path.join(GALLERY_DIR, f)));
  add('admin-env', process.env.SEED_ADMIN_EMAIL ? 'set' : 'unset');
  add('env', process.env.NODE_ENV === 'test' ? 'test' : 'other');   // the seed skips photos under test
  return h.digest('hex');
}

async function storedFingerprint() {
  try {
    return (await one('SELECT fingerprint FROM boot_state WHERE id = 1'))?.fingerprint ?? null;
  } catch (err) {
    if (err.code === '42P01') return null;       // boot_state does not exist yet
    throw err;
  }
}

/**
 * Returns 'current' (nothing to do), 'updated' (migrated and seeded), or
 * 'busy' (another instance is doing it; this one serves meanwhile).
 */
export async function ensureDatabase({ log = console.log, lockWait = LOCK_WAIT } = {}) {
  const fp = fingerprint();
  if ((await storedFingerprint()) === fp) return 'current';

  try {
    return await tx(async () => {
      await exec_raw(`SET LOCAL lock_timeout = '${lockWait}'`);
      await run('SELECT pg_advisory_xact_lock(?)', LOCK_KEY);
      /* Still bounded afterwards: a wait the request cannot survive should
         fail fast and be retried by the next request, not hit the 504. */
      await exec_raw(`SET LOCAL lock_timeout = '${WORK_LOCK_WAIT}'`);

      await exec_raw(`CREATE TABLE IF NOT EXISTS boot_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fingerprint TEXT NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      if ((await storedFingerprint()) === fp) return 'current';

      await migrate({ log });
      await seed({ log });
      await run(`INSERT INTO boot_state (id, fingerprint) VALUES (1, ?)
        ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, completed_at = NOW()
        RETURNING id`, fp);
      log('[boot] database brought up to date for this build');
      return 'updated';
    });
  } catch (err) {
    if (err.code === '55P03') {                  // lock_not_available
      log(`[boot] another instance is updating the database; serving without waiting`);
      return 'busy';
    }
    throw err;
  }
}
