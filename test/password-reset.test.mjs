/**
 * Password reset — the route reported success while changing nothing,
 * because the token lookup was not awaited (a Promise is always truthy).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, usersRepo, auth;
const EMAIL = 'owner-reset@example.com';

before(async () => {
  ctx = await setupEnv('pwreset');
  await bootDb();
  usersRepo = await import('../src/repositories/users.repo.js');
  auth = await import('../src/services/auth.service.js');
  await usersRepo.create({ email: EMAIL, name: 'Owner', password: 'original-password-123', role: 'owner' });
  srv = await startServer();
});
after(async () => { await srv.close(); await cleanup(ctx); });

const login = (password) => srv.call('/api/auth/login', { json: { email: EMAIL, password } });

describe('password reset', () => {
  test('a valid link changes the password; the old one stops working', async () => {
    const { token } = await auth.requestPasswordReset(EMAIL);
    const r = await srv.call('/api/auth/reset-password', { json: { token, new_password: 'brand-new-password-456' } });
    assert.equal(r.status, 200);
    assert.equal((await login('brand-new-password-456')).status, 200);
    assert.equal((await login('original-password-123')).status, 401);
  });

  test('a link works once only', async () => {
    const { token } = await auth.requestPasswordReset(EMAIL);
    assert.equal((await srv.call('/api/auth/reset-password', { json: { token, new_password: 'second-password-789' } })).status, 200);
    const again = await srv.call('/api/auth/reset-password', { json: { token, new_password: 'third-password-000' } });
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'INVALID_TOKEN');
  });

  test('an invented token is rejected instead of "succeeding"', async () => {
    const r = await srv.call('/api/auth/reset-password', { json: { token: 'not-a-real-token-at-all', new_password: 'whatever-password-1' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('the command-line reset sets a new password and clears a lockout', async () => {
    const u = await usersRepo.findByEmail(EMAIL);
    const { run } = await import('../src/db/index.js');
    await run(`UPDATE users SET locked_until = NOW() + INTERVAL '1 hour', failed_attempts = 9 WHERE id = ?`, u.id);
    const accounts = await usersRepo.list();
    const pick = accounts.findIndex((a) => a.email === EMAIL) + 1;
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/reset-admin-password.js'], {
        env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { text += d; });
      child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(text))));
      child.stdin.end(`${pick}\nfrom-the-cli-password-1\nfrom-the-cli-password-1\n`);
    });
    assert.match(out, /Password updated for owner-reset@example\.com/);
    assert.ok(!out.includes('from-the-cli-password-1'), 'the password is never printed');
    assert.equal((await login('from-the-cli-password-1')).status, 200);
  });
});
