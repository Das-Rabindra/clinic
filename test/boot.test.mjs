/**
 * Cold-start database work (src/db/boot.js and the migration lock).
 *
 * Covers the causes of the 504s seen on the first requests after a deploy:
 * every cold start used to run the full migrate + seed, and the migration
 * lock was session-level, so it could be left held behind a transaction-mode
 * pooler and block the next boot until the platform timed out.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { setupEnv, cleanup } from './helpers.mjs';

let ctx, boot, db;

before(async () => {
  ctx = await setupEnv('boot');
  boot = await import('../src/db/boot.js');
  db = await import('../src/db/index.js');
});
after(async () => { await cleanup(ctx); });

/** Count queries sent through the app's pool while fn runs. */
async function countQueries(fn) {
  let n = 0;
  const orig = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...a) { n++; return orig.apply(this, a); };
  try { await fn(); } finally { pg.Client.prototype.query = orig; }
  return n;
}

/** A separate connection, outside the app's pool, to hold locks with. */
async function otherConnection() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

describe('ensureDatabase', () => {
  test('a fresh database is migrated and seeded once, then costs one query per boot', async () => {
    assert.equal(await boot.ensureDatabase({ log: () => {} }), 'updated');
    assert.ok(await db.one('SELECT id FROM clinic_settings WHERE id = 1'), 'seeded');
    let state;
    const n = await countQueries(async () => { state = await boot.ensureDatabase({ log: () => {} }); });
    assert.equal(state, 'current');
    assert.equal(n, 1, 'one query on the fast path');
  });

  test('a changed fingerprint runs the work again', async () => {
    await db.run("UPDATE boot_state SET fingerprint = 'stale' WHERE id = 1");
    assert.equal(await boot.ensureDatabase({ log: () => {} }), 'updated');
    assert.equal(await boot.ensureDatabase({ log: () => {} }), 'current');
  });

  test('concurrent boots: one does the work, the other finds it done', async () => {
    await db.run("UPDATE boot_state SET fingerprint = 'stale' WHERE id = 1");
    const states = await Promise.all([
      boot.ensureDatabase({ log: () => {} }),
      boot.ensureDatabase({ log: () => {} }),
    ]);
    assert.deepEqual(states.sort(), ['current', 'updated']);
  });

  test('while another instance holds the boot lock, it serves instead of waiting for a timeout', async () => {
    await db.run("UPDATE boot_state SET fingerprint = 'stale' WHERE id = 1");
    const other = await otherConnection();
    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock(3318406)');
      const t0 = Date.now();
      assert.equal(await boot.ensureDatabase({ log: () => {}, lockWait: '300ms' }), 'busy');
      assert.ok(Date.now() - t0 < 5000, 'gave up promptly');
    } finally {
      await other.query('ROLLBACK');
      await other.end();
    }
    assert.equal(await boot.ensureDatabase({ log: () => {} }), 'updated');
  });
});

describe('migrate', () => {
  test('a session lock left on the old key no longer blocks migrations', async () => {
    const { migrate } = await import('../src/db/migrate.js');
    const other = await otherConnection();
    try {
      // What a leaked lock from the previous runner looked like.
      await other.query('SELECT pg_advisory_lock(8472613)');
      const t0 = Date.now();
      assert.equal(await migrate({ log: () => {} }), 0);
      assert.ok(Date.now() - t0 < 5000);
    } finally {
      await other.end();
    }
  });

  test('takes no session-level lock, so nothing can be left held', async () => {
    const { migrate } = await import('../src/db/migrate.js');
    await migrate({ log: () => {} });
    const held = await db.one(
      "SELECT COUNT(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()");
    assert.equal(held.n, 0);
  });
});
