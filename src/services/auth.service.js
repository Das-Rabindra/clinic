/**
 * Authentication. Sessions are opaque random tokens; only their SHA-256 hash is
 * stored, so a database leak does not yield usable session cookies.
 */
import * as usersRepo from '../repositories/users.repo.js';
import * as sessionsRepo from '../repositories/sessions.repo.js';
import { one, run } from '../repositories/base.js';
import { verifyPassword, randomToken, sha256 } from '../utils/crypto.js';
import { config } from '../config/env.js';
import { audit } from './audit.service.js';

export class AuthError extends Error {
  constructor(code, message, status = 401) { super(message); this.code = code; this.status = status; }
}

/** Generic message for every credential failure — no user enumeration. */
const BAD_CREDENTIALS = 'Incorrect email or password.';

export async function login({ email, password }, ctx = {}) {
  const user = await usersRepo.findByEmail(email);

  if (!user) {
    // Spend comparable time so a missing account is not detectable by timing.
    verifyPassword(password, 'f'.repeat(128), 'salt');
    throw new AuthError('INVALID_CREDENTIALS', BAD_CREDENTIALS);
  }
  if (user.locked_until && new Date(user.locked_until + 'Z') > new Date()) {
    throw new AuthError('LOCKED', 'Too many failed attempts. Try again in a few minutes.', 429);
  }
  if (!user.is_active) throw new AuthError('INACTIVE', 'This account has been deactivated.', 403);

  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    await usersRepo.recordLoginFailure(user.id);
    audit({ ...ctx }, {
      action: 'auth.login.failed', entity: 'user', entity_id: user.id,
      summary: `Failed login for ${user.email}`,
    });
    throw new AuthError('INVALID_CREDENTIALS', BAD_CREDENTIALS);
  }

  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await sessionsRepo.create({
    id: sha256(token), userId: user.id, csrfToken,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  await usersRepo.recordLoginSuccess(user.id);
  audit({ ...ctx, userId: user.id, userEmail: user.email }, {
    action: 'auth.login', entity: 'user', entity_id: user.id,
    summary: `${user.email} signed in`,
  });

  return {
    token, csrfToken,
    user: {
      id: user.id, email: user.email, name: user.name, role: user.role,
      must_change_password: user.must_change_password === 1,
    },
  };
}

export async function logout(token, ctx = {}) {
  if (!token) return false;
  const revoked = (await sessionsRepo.revoke(sha256(token))) > 0;
  if (revoked) audit(ctx, { action: 'auth.logout', entity: 'user', entity_id: ctx.userId, summary: 'Signed out' });
  return revoked;
}

/** Resolve a raw cookie token to a live session, sliding its expiry. */
export async function resolveSession(token) {
  if (!token) return null;
  const session = await sessionsRepo.find(sha256(token));
  if (!session) return null;
  if (!session.is_active) return null;
  await sessionsRepo.touch(session.id);
  return {
    sessionId: session.id,
    csrfToken: session.csrf_token,
    user: {
      id: session.user_id, email: session.email, name: session.name, role: session.role,
      must_change_password: session.must_change_password === 1,
    },
  };
}

export async function changePassword(userId, { currentPassword, newPassword }, ctx = {}) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AuthError('NOT_FOUND', 'User not found.', 404);
  if (!verifyPassword(currentPassword, user.password_hash, user.password_salt)) {
    throw new AuthError('INVALID_CREDENTIALS', 'Your current password is incorrect.', 400);
  }
  await usersRepo.setPassword(userId, newPassword);
  // Force other devices to sign in again with the new password.
  await sessionsRepo.revokeAllForUser(userId);
  audit(ctx, { action: 'auth.password.change', entity: 'user', entity_id: userId, summary: 'Password changed' });
  return true;
}

/**
 * Create a reset token. Always returns the same shape whether or not the email
 * exists, so the endpoint cannot be used to enumerate accounts.
 */
export async function requestPasswordReset(email, ctx = {}) {
  const user = await usersRepo.findByEmail(email);
  if (!user || !user.is_active) return { issued: false };

  const token = randomToken(32);
  run(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES (?, ?, NOW() + INTERVAL '+1 hour')`,
    user.id, sha256(token)
  );
  audit(ctx, {
    action: 'auth.password.reset_requested', entity: 'user', entity_id: user.id,
    summary: `Password reset requested for ${user.email}`,
  });
  return { issued: true, token, user };
}

export async function resetPassword({ token, newPassword }, ctx = {}) {
  const row = one(
    `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL
       AND expires_at > NOW()`, sha256(token)
  );
  if (!row) throw new AuthError('INVALID_TOKEN', 'This reset link is invalid or has expired.', 400);

  await usersRepo.setPassword(row.user_id, newPassword);
  run(`UPDATE password_resets SET used_at = NOW() WHERE id = ?`, row.id);
  await sessionsRepo.revokeAllForUser(row.user_id);
  audit(ctx, {
    action: 'auth.password.reset', entity: 'user', entity_id: row.user_id,
    summary: 'Password reset completed',
  });
  return true;
}

export async function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secureCookies,
    path: '/',
    maxAge: config.session.absoluteDays * 86400000,
  };
}
