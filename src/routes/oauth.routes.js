/** Google OAuth callback. Kept outside /api so the redirect URI stays clean. */
import { Router } from 'express';
import * as oauth from '../services/google/oauth.js';
import * as reviewsService from '../services/google/reviews.service.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuthPage } from '../middleware/auth.js';
import { audit, ctxFrom } from '../services/audit.service.js';

const router = Router();

/**
 * The callback requires an authenticated admin session in addition to the
 * signed state parameter, so a stray callback URL cannot connect an account.
 */
router.get('/google/callback', requireAuthPage, asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  const fail = (message) =>
    res.redirect('/admin/reviews?google_error=' + encodeURIComponent(message));

  if (error) return fail(String(error));
  if (!code || !state) return fail('Google did not return an authorisation code.');
  if (!oauth.verifyState(state)) return fail('The connection request could not be verified. Please start again.');

  try {
    await oauth.exchangeCode(String(code));
    audit(ctxFrom(req), {
      action: 'google.connect.complete', entity: 'integration', entity_id: 'google_business',
      summary: 'Connected Google Business Profile',
    });
    // Next step is choosing which location this clinic is.
    const accounts = await reviewsService.listAccounts().catch(() => []);
    return res.redirect('/admin/reviews?google_connected=1&accounts=' + accounts.length);
  } catch (err) {
    return fail(err.message);
  }
}));

export default router;
