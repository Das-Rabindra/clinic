import { Router } from 'express';
import { z } from 'zod';
import { validate, partialUpdate, zBool } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireRole } from '../../middleware/auth.js';
import * as reviewsRepo from '../../repositories/reviews.repo.js';
import * as reviewsService from '../../services/google/reviews.service.js';
import * as oauth from '../../services/google/oauth.js';
import * as jobsRepo from '../../repositories/jobs.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { ROLES } from '../../config/constants.js';

const router = Router();

/* ── Manually added patient testimonials ────────────────────────────────── */

const testimonialSchema = z.object({
  author_name: z.string().trim().min(2, 'Enter the patient\'s name.').max(120),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(4, 'Enter what the patient said.').max(2000),
  reviewed_at: z.string().trim().max(40).optional().or(z.literal('')),
  collected_via: z.string().trim().max(200).optional().or(z.literal('')),
  consent_note: z.string().trim().max(500).optional().or(z.literal('')),
  // Publishing a named person's words requires an explicit attestation that
  // they are a real patient who agreed to it.
  consent_confirmed: zBool,
  is_visible: zBool.default(true),
  is_featured: zBool.default(false),
});

router.post('/testimonials', validate(testimonialSchema), async (req, res) => {
  const b = req.body;
  if (b.is_visible && !b.consent_confirmed) {
    return res.status(422).json({
      code: 'CONSENT_REQUIRED',
      error: 'Confirm that this is a real patient who agreed to have their words published.',
    });
  }
  const created = await reviewsRepo.createManual({ ...b, added_by: req.user.id });
  await audit(ctxFrom(req), {
    action: 'review.testimonial.create', entity: 'review', entity_id: created.id,
    summary: `Added a patient testimonial from ${created.author_name} (${created.rating}★)`
      + `${b.collected_via ? ` — collected via ${b.collected_via}` : ''}`,
  });
  res.status(201).json({ ok: true, review: created });
});

router.put('/testimonials/:id', validate(partialUpdate(testimonialSchema)), async (req, res) => {
  const id = Number(req.params.id);
  const before = await reviewsRepo.findById(id);
  if (!before || before.source !== 'manual') {
    return res.status(404).json({ error: 'Testimonial not found.', code: 'NOT_FOUND' });
  }
  const visible = req.body.is_visible ?? Boolean(before.is_visible);
  const consent = req.body.consent_confirmed ?? Boolean(before.consent_confirmed);
  if (visible && !consent) {
    return res.status(422).json({
      code: 'CONSENT_REQUIRED',
      error: 'Confirm that this is a real patient who agreed to have their words published.',
    });
  }
  await reviewsRepo.updateManual(id, req.body);
  const after = await reviewsRepo.findById(id);
  await audit(ctxFrom(req), {
    action: 'review.testimonial.update', entity: 'review', entity_id: id,
    summary: `Updated the testimonial from ${after.author_name}`,
    before: { text: before.text, rating: before.rating, is_visible: before.is_visible },
    after: { text: after.text, rating: after.rating, is_visible: after.is_visible },
  });
  res.json({ ok: true, review: after });
});

router.delete('/testimonials/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = await reviewsRepo.findById(id);
  if (!before || before.source !== 'manual') {
    return res.status(404).json({
      error: 'Only testimonials added here can be deleted. A Google review would '
        + 'return on the next sync — hide it instead.',
      code: 'NOT_FOUND',
    });
  }
  await reviewsRepo.deleteManual(id);
  await audit(ctxFrom(req), {
    action: 'review.testimonial.delete', entity: 'review', entity_id: id,
    summary: `Deleted the testimonial from ${before.author_name}`,
  });
  res.json({ ok: true });
});

router.get('/', async (_req, res) => {
  res.json({
    reviews: await reviewsRepo.listAdmin(),
    aggregate: await reviewsRepo.aggregate(),
    aggregate_verified: await reviewsRepo.aggregateVerified(),
    connection: await reviewsService.connectionStatus(),
  });
});

/** Starts the OAuth flow. Returns the URL for the admin to visit. */
router.post('/connect', requireRole(ROLES.ADMIN), async (req, res) => {
  if (!await oauth.isConfigured()) {
    return res.status(400).json({
      code: 'NOT_CONFIGURED',
      error: 'Add a Google OAuth client ID and secret in Settings → Integrations first.',
      redirect_uri: oauth.redirectUri(),
    });
  }
  await audit(ctxFrom(req), {
    action: 'google.connect.start', entity: 'integration', entity_id: 'google_business',
    summary: 'Started Google Business Profile connection',
  });
  res.json({ ok: true, auth_url: await oauth.authUrl() });
});

router.post('/disconnect', requireRole(ROLES.ADMIN), async (req, res) => {
  await oauth.disconnect();
  await reviewsRepo.setSyncState({ connected: false, last_error: null });
  await audit(ctxFrom(req), {
    action: 'google.disconnect', entity: 'integration', entity_id: 'google_business',
    summary: 'Disconnected Google Business Profile',
  });
  res.json({ ok: true });
});

router.get('/google/accounts', requireRole(ROLES.ADMIN), asyncHandler(async (_req, res) => {
  try { res.json({ ok: true, accounts: await reviewsService.listAccounts() }); }
  catch (err) { res.status(502).json({ error: err.message, code: 'GOOGLE_API' }); }
}));

router.get('/google/locations', requireRole(ROLES.ADMIN), validate(z.object({
  account: z.string().trim().min(3).max(200),
}), 'query'), asyncHandler(async (req, res) => {
  try { res.json({ ok: true, locations: await reviewsService.listLocations(req.validatedQuery.account) }); }
  catch (err) { res.status(502).json({ error: err.message, code: 'GOOGLE_API' }); }
}));

router.post('/google/location', requireRole(ROLES.ADMIN), validate(z.object({
  account_name: z.string().trim().min(3).max(200),
  location_name: z.string().trim().min(3).max(200),
  location_title: z.string().trim().max(200).optional(),
})), async (req, res) => {
  const state = await reviewsService.selectLocation({
    accountName: req.body.account_name,
    locationName: req.body.location_name,
    locationTitle: req.body.location_title,
  });
  await audit(ctxFrom(req), {
    action: 'google.location.select', entity: 'integration', entity_id: 'google_business',
    summary: `Selected Google location ${req.body.location_title || req.body.location_name}`,
  });
  res.json({ ok: true, state });
});

router.post('/sync', asyncHandler(async (req, res) => {
  const result = await reviewsService.sync();
  await audit(ctxFrom(req), {
    action: 'reviews.sync', entity: 'review', entity_id: 'all',
    summary: result.ok ? `Synced ${result.synced} Google review(s)` : `Google review sync failed: ${result.error}`,
  });
  // A failed sync is a 200 with ok:false — it is a reportable state, not a
  // server error, and the UI shows the last successful sync time.
  res.json(result);
}));

/** Schedule a daily background sync. */
router.post('/sync/schedule', requireRole(ROLES.ADMIN), async (req, res) => {
  const id = await jobsRepo.enqueue({
    kind: 'sync_reviews', payload: {},
    runAt: new Date(Date.now() + 60000),
    dedupeKey: `sync_reviews:${new Date().toISOString().slice(0, 10)}`,
  });
  res.json({ ok: true, job_id: id });
});

router.post('/:id/visibility', validate(z.object({ visible: zBool })), async (req, res) => {
  const id = Number(req.params.id);
  const review = await reviewsRepo.findById(id);
  if (!review) return res.status(404).json({ error: 'Review not found.', code: 'NOT_FOUND' });
  await reviewsRepo.setVisible(id, req.body.visible);
  await audit(ctxFrom(req), {
    action: req.body.visible ? 'review.show' : 'review.hide', entity: 'review', entity_id: id,
    summary: `${req.body.visible ? 'Showed' : 'Hid'} review by ${review.author_name}`,
  });
  res.json({ ok: true });
});

router.post('/:id/feature', validate(z.object({ featured: zBool })), async (req, res) => {
  const id = Number(req.params.id);
  if (!await reviewsRepo.findById(id)) return res.status(404).json({ error: 'Review not found.', code: 'NOT_FOUND' });
  await reviewsRepo.setFeatured(id, req.body.featured);
  res.json({ ok: true });
});

export default router;
