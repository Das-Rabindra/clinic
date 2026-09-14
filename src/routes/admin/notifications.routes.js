import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import * as notifRepo from '../../repositories/notifications.repo.js';
import * as notifications from '../../services/notification/index.js';
import * as jobsRepo from '../../repositories/jobs.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { NOTIFICATION_STATUS, NOTIFICATION_CHANNELS } from '../../config/constants.js';

const router = Router();

router.get('/', validate(z.object({
  status: z.enum(NOTIFICATION_STATUS).optional(),
  channel: z.enum(NOTIFICATION_CHANNELS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
}), 'query'), async (req, res) => {
  const q = req.validatedQuery;
  const { rows, total } = await notifRepo.list(q);
  res.json({
    rows, total,
    providers: await notifications.status(),
    failed_count: await notifRepo.failedCount(),
    jobs: await jobsRepo.stats(),
  });
});

router.get('/:id', async (req, res) => {
  const n = await notifRepo.findById(Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'Notification not found.', code: 'NOT_FOUND' });
  res.json({ notification: n, logs: await notifRepo.logsFor(n.id) });
});

/** Manual retry after fixing credentials or a transient provider outage. */
router.post('/:id/retry', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const n = await notifRepo.findById(id);
  if (!n) return res.status(404).json({ error: 'Notification not found.', code: 'NOT_FOUND' });

  const result = await notifications.retry(id);
  await audit(ctxFrom(req), {
    action: 'notification.retry', entity: 'notification', entity_id: id,
    summary: `Retried ${n.channel} "${n.template}" to ${n.recipient} — ${result.ok ? 'sent' : (result.notConfigured ? 'provider not configured' : 'failed')}`,
  });
  res.json({ ok: result.ok, result, notification: await notifRepo.findById(id) });
}));

/** Retry every failed notification at once. */
router.post('/retry-failed', asyncHandler(async (req, res) => {
  const { rows } = await notifRepo.list({ status: 'failed', limit: 100 });
  let sent = 0, failed = 0;
  for (const n of rows) {
    const r = await notifications.retry(n.id);
    if (r.ok) sent++; else failed++;
  }
  await audit(ctxFrom(req), {
    action: 'notification.retry_all', entity: 'notification', entity_id: 'failed',
    summary: `Retried ${rows.length} failed notification(s): ${sent} sent, ${failed} still failing`,
  });
  res.json({ ok: true, attempted: rows.length, sent, failed });
}));

export default router;
