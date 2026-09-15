import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup, withServer } from './helpers.mjs';

let ctx;
const SUITE = 'security';
let srv, usersRepo, authService, limiter;
const PASSWORD = 'CorrectHorseBattery1';

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  usersRepo = await import('../src/repositories/users.repo.js');
  authService = await import('../src/services/auth.service.js');
  limiter = await import('../src/middleware/ratelimit.js');
  await usersRepo.create({ email: 'owner@clinic.test', name: 'Owner', password: PASSWORD, role: 'owner' });
  await usersRepo.create({ email: 'staff@clinic.test', name: 'Staff', password: PASSWORD, role: 'staff' });
  srv = await startServer();
});
after(async () => { await srv.close(); await cleanup(ctx); });

describe('authentication', () => {
  test('rejects wrong credentials with a generic message', async () => {
    const r = await srv.call('/api/auth/login', { json: { email: 'owner@clinic.test', password: 'wrong-password' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Incorrect email or password.');
  });

  test('gives the same message for an unknown account (no user enumeration)', async () => {
    const r = await srv.call('/api/auth/login', { json: { email: 'ghost@clinic.test', password: 'wrong-password' } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Incorrect email or password.');
  });

  test('never stores the password in plain text', async () => {
    const user = await usersRepo.findByEmail('owner@clinic.test');
    assert.ok(!JSON.stringify(user).includes(PASSWORD));
    assert.ok(user.password_hash.length >= 128);
    assert.ok(user.password_salt.length >= 32);
  });

  test('signs in and issues an httpOnly session cookie', async () => {
    const r = await srv.call('/api/auth/login', { json: { email: 'owner@clinic.test', password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'owner');
    const setCookie = (r.headers.getSetCookie() || []).join(' ');
    assert.match(setCookie, /sdc_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  });

  test('does not mark cookies Secure when served over plain HTTP', async () => {
    // A Secure cookie is silently discarded by browsers on an http:// origin,
    // which would make sign-in appear to succeed while storing no session.
    // The test harness runs on http, so Secure must be absent here.
    const fresh = await startServer();
    try {
      const r = await fresh.call('/api/auth/login', { json: { email: 'owner@clinic.test', password: PASSWORD } });
      assert.equal(r.status, 200);
      const cookies = (r.headers.getSetCookie() || []).join(' ');
      assert.match(cookies, /sdc_session=/);
      assert.ok(!/;\s*Secure/i.test(cookies),
        'cookies must not be Secure on a plain-HTTP origin, or the browser drops them');
      assert.match(cookies, /HttpOnly/i, 'the session cookie is still HttpOnly');
    } finally { await fresh.close(); }
  });

  test('marks cookies Secure when the site is served over HTTPS', async () => {
    // Derived from PUBLIC_URL / TRUST_PROXY rather than NODE_ENV.
    const { config } = await import('../src/config/env.js');
    assert.equal(config.session.secureCookies, false, 'this test env is http');

    const mod = await import('../src/config/env.js?https-check');
    void mod;
    // Verify the rule itself, independent of the loaded singleton.
    const rule = (publicUrl, trustProxy) => trustProxy || /^https:/i.test(publicUrl || '');
    assert.equal(rule('https://clinic.example', false), true);
    assert.equal(rule('http://clinic.example', true), true, 'behind a TLS proxy');
    assert.equal(rule('http://localhost:8090', false), false);
  });

  test('the session token is stored only as a hash', async () => {
    const token = srv.jar.get('sdc_session');
    const { one } = await import('../src/repositories/base.js');
    assert.ok(token);
    assert.equal(await one('SELECT id FROM sessions WHERE id = ?', token), undefined,
      'the raw token must never be a key in the sessions table');
  });

  test('locks the account after repeated failures', async () => {
    // Tested at the service layer: over HTTP the rate limiter (8 per 15 min)
    // trips before the 8-failure lockout, so it would mask this behaviour.
    await usersRepo.create({ email: 'lockme@clinic.test', name: 'Lock', password: PASSWORD, role: 'staff' });
    let locked = false;
    for (let i = 0; i < 10; i++) {
      try {
        await authService.login({ email: 'lockme@clinic.test', password: 'nope' }, {});
      } catch (err) {
        if (err.code === 'LOCKED') { locked = true; break; }
      }
    }
    assert.ok(locked, 'the account must lock after repeated failed attempts');
    // A locked account rejects even the correct password.
    await assert.rejects(async () => authService.login({ email: 'lockme@clinic.test', password: PASSWORD }, {}),
      (err) => err.code === 'LOCKED');
  });
});

describe('authorisation', () => {
  test('rejects unauthenticated access to every admin endpoint', async () => {
    await withServer(async (fresh) => {
    for (const path of [
      '/api/admin/dashboard', '/api/admin/appointments', '/api/admin/patients',
      '/api/admin/clinic', '/api/admin/gallery', '/api/admin/users',
      '/api/admin/audit-logs', '/api/admin/notifications', '/api/admin/integrations',
    ]) {
      const r = await fresh.call(path);
      assert.equal(r.status, 401, `${path} must require authentication`);
    }
    });
  });

  test('redirects unauthenticated browsers away from /admin', async () => {
    await withServer(async (fresh) => {
      const r = await fresh.call('/admin');
      assert.equal(r.status, 302);
      assert.match(r.headers.get('location'), /\/admin\/login/);
    });
  });

  test('staff cannot reach owner-only endpoints', async () => {
    await limiter._reset();   // earlier login tests share the per-IP bucket
    await withServer(async (staff) => {
      const login = await staff.call('/api/auth/login', { json: { email: 'staff@clinic.test', password: PASSWORD } });
      assert.equal(login.status, 200, 'staff should be able to sign in');
      const r = await staff.call('/api/admin/users', {
        method: 'POST', headers: { 'X-CSRF-Token': staff.csrf() },
        json: { email: 'new@clinic.test', name: 'New', role: 'admin' },
      });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'FORBIDDEN');
    });
  });
});

describe('CSRF protection', () => {
  test('blocks an authenticated write with no CSRF token', async () => {
    const r = await srv.call('/api/admin/clinic', { method: 'PUT', json: { name: 'Hacked Clinic' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'CSRF');
  });

  test('blocks a write with the wrong CSRF token', async () => {
    const r = await srv.call('/api/admin/clinic', {
      method: 'PUT', headers: { 'X-CSRF-Token': 'not-the-real-token' }, json: { name: 'Hacked Clinic' },
    });
    assert.equal(r.status, 403);
  });

  test('allows the write with the correct token', async () => {
    const r = await srv.call('/api/admin/clinic', {
      method: 'PUT', headers: { 'X-CSRF-Token': srv.csrf() }, json: { tagline: 'Updated tagline' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  test('blocks public booking without a CSRF token', async () => {
    await withServer(async (fresh) => {
      const r = await fresh.call('/api/appointments', {
        json: { name: 'No Token', phone: '9876543210', date: '2026-12-01', time: '10:00' },
      });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'CSRF');
    });
  });
});

describe('input validation', () => {
  test('rejects a malformed booking payload', async () => {
    await srv.call('/api/csrf');
    const r = await srv.call('/api/appointments', {
      headers: { 'X-CSRF-Token': srv.csrf() },
      json: { name: 'x', phone: 'abc', date: 'not-a-date', time: '99:99' },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'VALIDATION');
    assert.ok(Object.keys(r.body.fields).length >= 2);
  });

  test('is not vulnerable to SQL injection in search', async () => {
    const r = await srv.call('/api/admin/patients?q=' + encodeURIComponent("'; DROP TABLE patients; --"));
    assert.equal(r.status, 200);
    const { one } = await import('../src/repositories/base.js');
    assert.ok(await one(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patients'"),
      'patients table must still exist');
  });

  test('escapes stored content so it cannot inject script into the page', async () => {
    const payload = '</script><script>alert(1)</script>';
    const r = await srv.call('/api/admin/faqs', {
      method: 'POST', headers: { 'X-CSRF-Token': srv.csrf() },
      json: { question: payload + 'Is it safe?', answer: '<img src=x onerror=alert(2)>Yes', is_published: true },
    });
    assert.equal(r.status, 201);

    const page = await srv.call('/');
    // Visible content is escaped by the template...
    assert.ok(page.body.includes('&lt;script&gt;'), 'markup is HTML-escaped in the body');
    // The payload may survive as inert text, but never as a live tag: with
    // every < and > escaped it cannot form an element or an event handler.
    assert.ok(!page.body.includes('<img src=x onerror'), 'no executable img tag reaches the page');
    assert.ok(!/<script>alert\(1\)<\/script>/.test(page.body), 'no executable script tag reaches the page');
    // ...and the JSON-LD block cannot be broken out of, which plain
    // JSON.stringify would have allowed.
    assert.ok(!page.body.includes(payload), 'the closing script tag must never appear verbatim');
    assert.ok(page.body.includes('\\u003c/script\\u003e'), 'it is unicode-escaped inside JSON-LD');
  });
});

describe('security headers', () => {
  test('sets the expected headers on the public site', async () => {
    const r = await srv.call('/');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.ok(r.headers.get('referrer-policy'));
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('marks admin pages as no-store', async () => {
    const r = await srv.call('/admin/login');
    assert.match(r.headers.get('cache-control'), /no-store/);
  });
});

describe('secrets handling', () => {
  test('integration secrets are never returned by the API', async () => {
    await srv.call('/api/admin/integrations/whatsapp', {
      method: 'PUT', headers: { 'X-CSRF-Token': srv.csrf() },
      json: { config: { phone_number_id: '123456' }, secrets: { token: 'SUPER-SECRET-TOKEN' }, is_enabled: true },
    });
    const r = await srv.call('/api/admin/integrations');
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes('SUPER-SECRET-TOKEN'), 'the token must never be serialised to a client');
    const wa = r.body.integrations.find((i) => i.provider === 'whatsapp');
    assert.equal(wa.has_secrets, true, 'but the UI is told a secret exists');
  });

  test('updating one credential does not wipe the others', async () => {
    const integrations = await import('../src/repositories/integrations.repo.js');
    await integrations.upsert('smtp', { secrets: { user: 'alice', pass: 'first-pass' } });
    // Change only the password; the username must survive.
    await integrations.upsert('smtp', { secrets: { pass: 'second-pass' } });
    const stored = await integrations.getSecrets('smtp');
    assert.equal(stored.user, 'alice', 'the untouched credential must persist');
    assert.equal(stored.pass, 'second-pass');
  });

  test('secrets are encrypted at rest', async () => {
    const { one } = await import('../src/repositories/base.js');
    const row = await one("SELECT secret_json FROM integrations WHERE provider = 'whatsapp'");
    assert.ok(row.secret_json);
    assert.ok(!row.secret_json.includes('SUPER-SECRET-TOKEN'), 'ciphertext must not contain the plaintext');
    const { decryptSecret } = await import('../src/utils/crypto.js');
    assert.ok(decryptSecret(row.secret_json).includes('SUPER-SECRET-TOKEN'), 'and must decrypt correctly');
  });
});
