/** FAQ management. */
import { Router } from 'express';
import { z } from 'zod';
import { validate, zId, zBool } from '../../middleware/validate.js';
import * as contentRepo from '../../repositories/content.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';

const router = Router();

router.get('/faqs', (_req, res) => res.json(contentRepo.listFaqs()));

const faqSchema = z.object({
  question: z.string().trim().min(4).max(300),
  answer: z.string().trim().min(2).max(4000),
  is_published: zBool.default(true),
});

router.post('/faqs', validate(faqSchema), (req, res) => {
  const created = contentRepo.createFaq(req.body);
  audit(ctxFrom(req), {
    action: 'faq.create', entity: 'faq', entity_id: created.id,
    summary: `Added FAQ "${created.question}"`,
  });
  res.status(201).json({ ok: true, faq: created });
});

router.put('/faqs/:id', validate(faqSchema.partial()), (req, res) => {
  const id = Number(req.params.id);
  const before = contentRepo.findFaq(id);
  if (!before) return res.status(404).json({ error: 'FAQ not found.', code: 'NOT_FOUND' });
  contentRepo.updateFaq(id, req.body);
  const after = contentRepo.findFaq(id);
  audit(ctxFrom(req), {
    action: 'faq.update', entity: 'faq', entity_id: id,
    summary: `Updated FAQ "${after.question}"`, before, after,
  });
  res.json({ ok: true, faq: after });
});

router.delete('/faqs/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = contentRepo.findFaq(id);
  if (!before) return res.status(404).json({ error: 'FAQ not found.', code: 'NOT_FOUND' });
  contentRepo.deleteFaq(id);
  audit(ctxFrom(req), {
    action: 'faq.delete', entity: 'faq', entity_id: id,
    summary: `Deleted FAQ "${before.question}"`,
  });
  res.json({ ok: true });
});

router.post('/faqs/reorder', validate(z.object({ ids: z.array(zId).min(1).max(100) })), (req, res) => {
  contentRepo.reorderFaqs(req.body.ids);
  audit(ctxFrom(req), { action: 'faq.reorder', entity: 'faq', entity_id: 'all', summary: 'Reordered FAQs' });
  res.json({ ok: true });
});

export default router;
