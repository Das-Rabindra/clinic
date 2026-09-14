import { Router } from 'express';
import { z } from 'zod';
import { validate, zEmail } from '../../middleware/validate.js';
import { loginLimiter, rateLimit } from '../../middleware/ratelimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireCsrf, setSessionCsrfCookie } from '../../middleware/csrf.js';
import { asyncHandler } from '../../middleware/error.js';
import * as auth from '../../services/auth.service.js';
import * as sessionsRepo from '../../repositories/sessions.repo.js';
import { config } from '../../config/env.js';
import { ctxFrom } from '../../services/audit.service.js';

const router = Router();

const loginSchema = z.object({
  email: zEmail,
  password: z.string().min(1, 'Enter your password.').max(200),
});

router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { token, csrfToken, user } = await auth.login(req.body, {
      ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300),
    });
    res.cookie(config.session.cookieName, token, await auth.sessionCookieOptions());
    setSessionCsrfCookie(res, csrfToken);
    res.json({ ok: true, user, csrf_token: csrfToken });
  } catch (err) {
    if (err instanceof auth.AuthError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[config.session.cookieName], ctxFrom(req));
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.clearCookie(config.session.csrfCookie, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.', code: 'UNAUTHENTICATED' });
  res.json({ user: req.user, csrf_token: req.session.csrfToken });
});

const passwordSchema = z.string().min(12, 'Use at least 12 characters.').max(200);

router.post('/change-password', requireAuth, requireCsrf,
  validate(z.object({ current_password: z.string().min(1), new_password: passwordSchema })),
  async (req, res) => {
    try {
      await auth.changePassword(req.user.id, {
        currentPassword: req.body.current_password,
        newPassword: req.body.new_password,
      }, ctxFrom(req));
      res.clearCookie(config.session.cookieName, { path: '/' });
      res.json({ ok: true, message: 'Password changed. Please sign in again.' });
    } catch (err) {
      if (err instanceof auth.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
      throw err;
    }
  });

/**
 * Forgot password. Responds identically whether or not the address exists.
 * The link is emailed when SMTP is configured; otherwise an owner can still
 * reset from Settings → Admin Users, and the response says so honestly.
 */
const resetLimiter = rateLimit({ windowMs: 60 * 60000, max: 5, key: 'reset' });

router.post('/forgot-password', resetLimiter, validate(z.object({ email: zEmail })),
  asyncHandler(async (req, res) => {
    const result = await auth.requestPasswordReset(req.body.email, { ip: req.ip });
    if (result.issued) {
      const link = `${config.publicUrl}/admin/reset-password?token=${result.token}`;
      const email = await import('../../services/notification/providers/email-smtp.js');
      if (await email.isConfigured()) {
        await email.send({
          to: result.user.email,
          subject: 'Reset your Samal Dental Care admin password',
          text: `A password reset was requested for your admin account.\n\nOpen this link within one hour:\n${link}\n\nIf you did not request this, ignore this email.`,
        });
      } else {
        // No mail provider: the token must not be leaked in the HTTP response,
        // so it goes to the server log where only an operator can see it.
        console.warn(`[auth] SMTP not configured. Password reset link for ${result.user.email}: ${link}`);
      }
    }
    res.json({
      ok: true,
      message: 'If that email matches an admin account, a reset link has been sent.',
    });
  }));

router.post('/reset-password',
  validate(z.object({ token: z.string().min(10).max(200), new_password: passwordSchema })),
  async (req, res) => {
    try {
      await auth.resetPassword({ token: req.body.token, newPassword: req.body.new_password }, { ip: req.ip });
      res.json({ ok: true, message: 'Password updated. You can now sign in.' });
    } catch (err) {
      if (err instanceof auth.AuthError) return res.status(err.status).json({ error: err.message, code: err.code });
      throw err;
    }
  });

router.get('/sessions', requireAuth, async (req, res) => {
  res.json((await sessionsRepo.listForUser(req.user.id)).map(s => ({
    ...s, current: s.id === req.session.id,
  })));
});

router.post('/sessions/revoke-others', requireAuth, requireCsrf, async (req, res) => {
  const all = await sessionsRepo.listForUser(req.user.id);
  let n = 0;
  for (const s of all) if (s.id !== req.session.id) n += await sessionsRepo.revoke(s.id);
  res.json({ ok: true, revoked: n });
});

export default router;
