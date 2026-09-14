/**
 * Admin API. Everything mounted here requires an authenticated session
 * (requireAuth), a valid CSRF token on writes, and writes an audit row.
 */
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';

import dashboard from './dashboard.routes.js';
import clinic from './clinic.routes.js';
import services from './services.routes.js';
import doctors from './doctors.routes.js';
import appointments from './appointments.routes.js';
import patients from './patients.routes.js';
import enquiries from './enquiries.routes.js';
import gallery from './gallery.routes.js';
import reviews from './reviews.routes.js';
import content from './content.routes.js';
import notifications from './notifications.routes.js';
import settings from './settings.routes.js';

const router = Router();

router.use(requireAuth);
router.use(requireCsrf);

router.use('/', dashboard);
router.use('/clinic', clinic);
router.use('/services', services);
router.use('/doctors', doctors);
router.use('/appointments', appointments);
router.use('/patients', patients);
router.use('/enquiries', enquiries);
router.use('/gallery', gallery);
router.use('/reviews', reviews);
router.use('/', content);
router.use('/notifications', notifications);
router.use('/', settings);

export default router;
