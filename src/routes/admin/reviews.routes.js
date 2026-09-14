import { Router } from 'express';
import { z } from 'zod';
import { validate, zBool } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireRole } from '../../middleware/auth.js';
import * as reviewsRepo from '../../repositories/reviews.repo.js';
import * as reviewsService from '../../services/google/reviews.service.js';
import * as oauth from '../../services/google/oauth.js';
import * as jobsRepo from '../../repositories/jobs.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { ROLES } from '../../config/constants.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    reviews: reviewsRepo.listAdmin(),
    aggregate: reviewsRepo.aggregate(),
    connection: reviewsService.connectionStatus(),
  });
});

/** Starts the OAuth flow. Returns the URL for the admin to visit. */
router.post('/connect', requireRole(ROLES.ADMIN), (req, res) => {
  if (!oauth.isConfigured()) {
    return res.status(400).json({
      code: 'NOT_CONFIGURED',
      error: 'Add a Google OAuth client ID and secret in Settings → Integrations first.',
      redirect_uri: oauth.redirectUri(),
    });
  }
  audit(ctxFrom(req), {
    action: 'google.connect.start', entity: 'integration', entity_id: 'google_business',
    summary: 'Started Google Business Profile connection',
  });
  res.json({ ok: true, auth_url: oauth.authUrl() });
});

router.post('/disconnect', requireRole(ROLES.ADMIN), (req, res) => {
  oauth.disconnect();
  reviewsRepo.setSyncState({ connected: false, last_error: null });
  audit(ctxFrom(req), {
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
})), (req, res) => {
  const state = reviewsService.selectLocation({
    accountName: req.body.account_name,
    locationName: req.body.location_name,
    locationTitle: req.body.location_title,
  });
  audit(ctxFrom(req), {
    action: 'google.location.select', entity: 'integration', entity_id: 'google_business',
    summary: `Selected Google location ${req.body.location_title || req.body.location_name}`,
  });
  res.json({ ok: true, state });
});

router.post('/sync', asyncHandler(async (req, res) => {
  const result = await reviewsService.sync();
  audit(ctxFrom(req), {
    action: 'reviews.sync', entity: 'review', entity_id: 'all',
    summary: result.ok ? `Synced ${result.synced} Google review(s)` : `Google review sync failed: ${result.error}`,
  });
  // A failed sync is a 200 with ok:false — it is a reportable state, not a
  // server error, and the UI shows the last successful sync time.
  res.json(result);
}));

/** Schedule a daily background sync. */
router.post('/sync/schedule', requireRole(ROLES.ADMIN), (req, res) => {
  const id = jobsRepo.enqueue({
    kind: 'sync_reviews', payload: {},
    runAt: new Date(Date.now() + 60000),
    dedupeKey: `sync_reviews:${new Date().toISOString().slice(0, 10)}`,
  });
  res.json({ ok: true, job_id: id });
});

router.post('/:id/visibility', validate(z.object({ visible: zBool })), (req, res) => {
  const id = Number(req.params.id);
  const review = reviewsRepo.findById(id);
  if (!review) return res.status(404).json({ error: 'Review not found.', code: 'NOT_FOUND' });
  reviewsRepo.setVisible(id, req.body.visible);
  audit(ctxFrom(req), {
    action: req.body.visible ? 'review.show' : 'review.hide', entity: 'review', entity_id: id,
    summary: `${req.body.visible ? 'Showed' : 'Hid'} review by ${review.author_name}`,
  });
  res.json({ ok: true });
});

router.post('/:id/feature', validate(z.object({ featured: zBool })), (req, res) => {
  const id = Number(req.params.id);
  if (!reviewsRepo.findById(id)) return res.status(404).json({ error: 'Review not found.', code: 'NOT_FOUND' });
  reviewsRepo.setFeatured(id, req.body.featured);
  res.json({ ok: true });
});

export default router;
