/** Admin users, integrations, SEO preview and the audit log. */
import { Router } from 'express';
import { z } from 'zod';
import { validate, zEmail, zId, zBool } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireRole } from '../../middleware/auth.js';
import * as usersRepo from '../../repositories/users.repo.js';
import * as sessionsRepo from '../../repositories/sessions.repo.js';
import * as auditRepo from '../../repositories/audit.repo.js';
import * as integrationsRepo from '../../repositories/integrations.repo.js';
import * as whatsapp from '../../services/notification/providers/whatsapp-cloud.js';
import * as email from '../../services/notification/providers/email-smtp.js';
import * as oauth from '../../services/google/oauth.js';
import * as seo from '../../services/seo.service.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { ROLES } from '../../config/constants.js';
import { randomToken } from '../../utils/crypto.js';

const router = Router();

/* ── Admin users ── */
router.get('/users', requireRole(ROLES.ADMIN), async (_req, res) => res.json(await usersRepo.list()));

router.post('/users', requireRole(ROLES.OWNER), validate(z.object({
  email: zEmail,
  name: z.string().trim().min(2).max(120),
  role: z.enum([ROLES.ADMIN, ROLES.STAFF, ROLES.OWNER]).default(ROLES.STAFF),
  password: z.string().min(12, 'Use at least 12 characters.').max(200).optional(),
})), async (req, res) => {
  if (await usersRepo.findByEmail(req.body.email)) {
    return res.status(409).json({ error: 'An account with that email already exists.', code: 'DUPLICATE' });
  }
  // Without an explicit password, issue a temporary one the owner passes on.
  const temporary = req.body.password ? null : randomToken(9);
  const created = await usersRepo.create({
    email: req.body.email, name: req.body.name, role: req.body.role,
    password: req.body.password || temporary,
    mustChange: temporary ? 1 : 0,
  });
  await audit(ctxFrom(req), {
    action: 'user.create', entity: 'user', entity_id: created.id,
    summary: `Created ${created.role} account for ${created.email}`,
  });
  res.status(201).json({ ok: true, user: created, temporary_password: temporary });
});

router.put('/users/:id', requireRole(ROLES.OWNER), validate(z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum([ROLES.ADMIN, ROLES.STAFF, ROLES.OWNER]).optional(),
  is_active: zBool.optional(),
})), async (req, res) => {
  const id = Number(req.params.id);
  const before = await usersRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });

  // Never allow the last active owner to be demoted or disabled.
  const owners = (await usersRepo.list()).filter(u => u.role === ROLES.OWNER && u.is_active);
  const losingOwner = before.role === ROLES.OWNER
    && ((req.body.role && req.body.role !== ROLES.OWNER) || req.body.is_active === false);
  if (losingOwner && owners.length <= 1) {
    return res.status(409).json({ error: 'This is the only owner account. Promote another owner first.', code: 'LAST_OWNER' });
  }

  await usersRepo.update(id, {
    ...req.body,
    is_active: req.body.is_active === undefined ? undefined : (req.body.is_active ? 1 : 0),
  });
  if (req.body.is_active === false) await sessionsRepo.revokeAllForUser(id);

  const after = await usersRepo.findPublicById(id);
  await audit(ctxFrom(req), {
    action: 'user.update', entity: 'user', entity_id: id,
    summary: `Updated account ${after.email}`,
    before: { role: before.role, is_active: before.is_active },
    after: { role: after.role, is_active: after.is_active },
  });
  res.json({ ok: true, user: after });
});

router.post('/users/:id/reset-password', requireRole(ROLES.OWNER), async (req, res) => {
  const id = Number(req.params.id);
  const user = await usersRepo.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  const temporary = randomToken(9);
  await usersRepo.setPassword(id, temporary);
  await usersRepo.update(id, {});
  await sessionsRepo.revokeAllForUser(id);
  await audit(ctxFrom(req), {
    action: 'user.password.reset', entity: 'user', entity_id: id,
    summary: `Reset password for ${user.email}`,
  });
  res.json({ ok: true, temporary_password: temporary });
});

router.delete('/users/:id', requireRole(ROLES.OWNER), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(409).json({ error: 'You cannot remove your own account.', code: 'SELF_DELETE' });
  }
  const user = await usersRepo.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  await usersRepo.softDelete(id);
  await sessionsRepo.revokeAllForUser(id);
  await audit(ctxFrom(req), {
    action: 'user.delete', entity: 'user', entity_id: id,
    summary: `Removed account ${user.email}`,
  });
  res.json({ ok: true });
});

/* ── Integrations ── */
router.get('/integrations', requireRole(ROLES.ADMIN), async (_req, res) => {
  res.json({
    integrations: await integrationsRepo.listPublic(),
    runtime: {
      whatsapp: { configured: await whatsapp.isConfigured() },
      email: { configured: await email.isConfigured() },
      google: { oauth_configured: await oauth.isConfigured(), redirect_uri: oauth.redirectUri() },
    },
  });
});

/**
 * Save integration credentials. Secrets are write-only: they are encrypted at
 * rest and never returned by any endpoint.
 */
router.put('/integrations/:provider', requireRole(ROLES.ADMIN), validate(z.object({
  is_enabled: zBool.optional(),
  config: z.record(z.string(), z.any()).optional(),
  secrets: z.record(z.string(), z.string().max(4000)).optional(),
})), async (req, res) => {
  const provider = String(req.params.provider);
  if (!['whatsapp', 'google_business', 'smtp'].includes(provider)) {
    return res.status(404).json({ error: 'Unknown integration.', code: 'NOT_FOUND' });
  }
  // Drop blank secret fields so "leave unchanged" works in the UI.
  const secrets = req.body.secrets
    ? Object.fromEntries(Object.entries(req.body.secrets).filter(([, v]) => v && v.trim()))
    : undefined;

  await integrationsRepo.upsert(provider, {
    config: req.body.config,
    secrets: secrets && Object.keys(secrets).length ? secrets : undefined,
    is_enabled: req.body.is_enabled,
    status: req.body.is_enabled === false ? 'disabled' : 'configured',
    last_error: null,
  });
  await audit(ctxFrom(req), {
    action: 'integration.update', entity: 'integration', entity_id: provider,
    summary: `Updated ${provider} integration${secrets && Object.keys(secrets).length ? ' (credentials changed)' : ''}`,
  });
  res.json({ ok: true, integration: (await integrationsRepo.listPublic()).find(i => i.provider === provider) });
});

router.post('/integrations/:provider/test', requireRole(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const provider = String(req.params.provider);
  let result;
  if (provider === 'whatsapp') result = await whatsapp.verify();
  else if (provider === 'smtp') result = await email.verify();
  else if (provider === 'google_business') {
    result = await oauth.isConfigured()
      ? { ok: true, details: { redirect_uri: oauth.redirectUri() } }
      : { ok: false, error: 'Client ID and secret are not set.' };
  } else return res.status(404).json({ error: 'Unknown integration.', code: 'NOT_FOUND' });

  await integrationsRepo.upsert(provider, {
    status: result.ok ? 'connected' : 'error',
    last_error: result.ok ? null : result.error,
  });
  res.json(result);
}));

router.delete('/integrations/:provider/secrets', requireRole(ROLES.OWNER), async (req, res) => {
  const provider = String(req.params.provider);
  await integrationsRepo.clearSecrets(provider);
  await audit(ctxFrom(req), {
    action: 'integration.clear_secrets', entity: 'integration', entity_id: provider,
    summary: `Cleared ${provider} credentials`,
  });
  res.json({ ok: true });
});

/* ── SEO preview ── */
router.get('/seo', requireRole(ROLES.ADMIN), async (_req, res) => {
  const settings = await settingsRepo.get();
  res.json({
    meta: seo.meta(settings),
    structured_data: await seo.structuredData(),
    robots_txt: seo.robotsTxt(seo.canonicalUrl(settings)),
  });
});

/* ── Audit log ── */
router.get('/audit-logs', requireRole(ROLES.ADMIN), validate(z.object({
  q: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(40).optional(),
  user_id: zId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}), 'query'), async (req, res) => {
  const q = req.validatedQuery;
  res.json(await auditRepo.list({
    q: q.q, entity: q.entity, userId: q.user_id, limit: q.limit, offset: q.offset,
  }));
});

export default router;
