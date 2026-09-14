/**
 * Test harness.
 *
 * Each test file gets its own PostgreSQL database, created before the suite and
 * dropped afterwards, so files never see each other's rows. The admin database
 * URL is derived from TEST_DATABASE_URL (or a local docker default).
 */
import pg from 'pg';

const ADMIN_URL = process.env.TEST_DATABASE_URL
  || 'postgres://postgres:devpass@localhost:55432/postgres';

const dbNameFor = (name) =>
  `sdc_test_${name}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`.toLowerCase();

function urlWithDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Create an isolated database and point the app at it. Call before importing app modules. */
export async function setupEnv(name) {
  const database = dbNameFor(name);
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();

  process.env.NODE_ENV = 'test';
  process.env.APP_SECRET = 'test-secret-'.padEnd(64, 'x');
  process.env.DATABASE_URL = urlWithDatabase(ADMIN_URL, database);
  process.env.RUN_JOBS = 'false';
  process.env.STORAGE_DRIVER = 'local';
  process.env.SEED_ADMIN_EMAIL = '';
  process.env.SEED_ADMIN_PASSWORD = '';
  process.env.PUBLIC_URL = 'http://localhost:9999';
  delete process.env.VERCEL;

  // Uploads still go to a temp directory for media tests.
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sdc-test-${name}-`));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.DATA_DIR = path.join(dir, 'data');

  return { database, dir };
}

export async function bootDb() {
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  await migrate({ log: () => {} });
  await seed({ log: () => {} });
}

/** Start the real Express app on an ephemeral port; returns a fetch helper. */
export async function startServer() {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

  async function call(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (jar.size) headers.Cookie = cookieHeader();
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.json);
      options.method = options.method || 'POST';
    }
    const res = await fetch(base + pathname, { ...options, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
    let body = null;
    const type = res.headers.get('content-type') || '';
    body = type.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text();
    return { status: res.status, body, headers: res.headers };
  }

  return {
    base, server, call, jar,
    csrf: () => jar.get('sdc_csrf'),
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * Run a callback against a throwaway server, always closing it — even when the
 * callback throws. Without this a failed assertion leaks a listening handle and
 * the test process never exits.
 */
export async function withServer(fn) {
  const srv = await startServer();
  try { return await fn(srv); }
  finally { await srv.close(); }
}

/** Close the pool and drop the test database. */
export async function cleanup(ctx) {
  try {
    const { closeDb } = await import('../src/db/index.js');
    await closeDb();
  } catch { /* pool may never have opened */ }

  if (ctx?.database) {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    try {
      await admin.connect();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [ctx.database]
      );
      await admin.query(`DROP DATABASE IF EXISTS ${ctx.database}`);
    } catch { /* best effort */ }
    finally { await admin.end().catch(() => {}); }
  }

  if (ctx?.dir) {
    const fs = await import('node:fs');
    try { fs.rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
