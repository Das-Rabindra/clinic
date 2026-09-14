/**
 * Test harness: every test file gets a fresh, isolated database and upload dir
 * so tests never interfere with each other or with real data.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function setupEnv(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sdc-test-${name}-`));
  process.env.NODE_ENV = 'test';
  process.env.APP_SECRET = 'test-secret-'.padEnd(64, 'x');
  process.env.DATA_DIR = path.join(dir, 'data');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.RUN_JOBS = 'false';
  process.env.SEED_ADMIN_EMAIL = '';
  process.env.SEED_ADMIN_PASSWORD = '';
  process.env.PUBLIC_URL = 'http://localhost:9999';
  return dir;
}

export async function bootDb() {
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  migrate({ log: () => {} });
  seed({ log: () => {} });
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
    if (type.includes('application/json')) body = await res.json().catch(() => null);
    else body = await res.text();
    return { status: res.status, body, headers: res.headers };
  }

  return {
    base, server, call, jar,
    csrf: () => jar.get('sdc_csrf'),
    close: () => new Promise((r) => server.close(r)),
  };
}

export const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };

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
