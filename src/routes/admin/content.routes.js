/** FAQ management. */
import { Router } from 'express';
import { z } from 'zod';
import { validate, partialUpdate, zId, zBool } from '../../middleware/validate.js';
import * as contentRepo from '../../repositories/content.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';

const router = Router();

router.get('/faqs', async (_req, res) => res.json(await contentRepo.listFaqs()));

const faqSchema = z.object({
  question: z.string().trim().min(4).max(300),
  answer: z.string().trim().min(2).max(4000),
  is_published: zBool.default(true),
});

router.post('/faqs', validate(faqSchema), async (req, res) => {
  const created = await contentRepo.createFaq(req.body);
  await audit(ctxFrom(req), {
    action: 'faq.create', entity: 'faq', entity_id: created.id,
    summary: `Added FAQ "${created.question}"`,
  });
  res.status(201).json({ ok: true, faq: created });
});

router.put('/faqs/:id', validate(partialUpdate(faqSchema)), async (req, res) => {
  const id = Number(req.params.id);
  const before = await contentRepo.findFaq(id);
  if (!before) return res.status(404).json({ error: 'FAQ not found.', code: 'NOT_FOUND' });
  await contentRepo.updateFaq(id, req.body);
  const after = await contentRepo.findFaq(id);
  await audit(ctxFrom(req), {
    action: 'faq.update', entity: 'faq', entity_id: id,
    summary: `Updated FAQ "${after.question}"`, before, after,
  });
  res.json({ ok: true, faq: after });
});

router.delete('/faqs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = await contentRepo.findFaq(id);
  if (!before) return res.status(404).json({ error: 'FAQ not found.', code: 'NOT_FOUND' });
  await contentRepo.deleteFaq(id);
  await audit(ctxFrom(req), {
    action: 'faq.delete', entity: 'faq', entity_id: id,
    summary: `Deleted FAQ "${before.question}"`,
  });
  res.json({ ok: true });
});

router.post('/faqs/reorder', validate(z.object({ ids: z.array(zId).min(1).max(100) })), async (req, res) => {
  await contentRepo.reorderFaqs(req.body.ids);
  await audit(ctxFrom(req), { action: 'faq.reorder', entity: 'faq', entity_id: 'all', summary: 'Reordered FAQs' });
  res.json({ ok: true });
});

export default router;
