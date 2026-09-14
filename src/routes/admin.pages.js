/**
 * Admin HTML shell. The console is a single page that talks to /api/admin;
 * these routes only decide login vs app and never embed data in the markup.
 */
import { Router } from 'express';
import { requireAuthPage } from '../middleware/auth.js';
import { issuePublicToken } from '../middleware/csrf.js';
import * as settingsRepo from '../repositories/settings.repo.js';
import * as mediaRepo from '../repositories/media.repo.js';
import { jsonForScript } from '../utils/format.js';

const router = Router();

const brand = async () => {
  const s = await settingsRepo.get();
  const favicon = s.favicon_media_id ? await mediaRepo.findById(s.favicon_media_id) : null;
  return { clinicName: s.name, faviconUrl: favicon?.url || '/img/logo-64.png' };
};

router.get('/login', async (req, res) => {
  if (req.user) return res.redirect('/admin');
  issuePublicToken(req, res);
  res.render('admin/login', {
    ...(await brand()),
    next: typeof req.query.next === 'string' ? req.query.next : '/admin',
    mode: 'login',
  });
});

router.get('/reset-password', async (req, res) => {
  issuePublicToken(req, res);
  res.render('admin/login', {
    ...(await brand()),
    next: '/admin',
    mode: 'reset',
    token: typeof req.query.token === 'string' ? req.query.token : '',
  });
});

/* Every other /admin path renders the console; the client router takes over. */
router.get(/.*/, requireAuthPage, async (req, res) => {
  res.render('admin/app', {
    ...(await brand()),
    // Serialised for a data-attribute; jsonForScript prevents any tag breakout.
    userJson: jsonForScript({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }),
  });
});

export default router;
