import { Router } from 'express';
import { z } from 'zod';
import { validate, partialUpdate, zId, zBool } from '../../middleware/validate.js';
import * as servicesRepo from '../../repositories/services.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';

const router = Router();

router.get('/', async (_req, res) => res.json({
  services: await servicesRepo.list(),
  categories: await servicesRepo.categories(),
}));

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).optional(),
  category_id: zId.nullish(),
  short_desc: z.string().trim().max(400).nullish(),
  long_desc: z.string().trim().max(4000).nullish(),
  icon: z.string().trim().max(60).nullish(),
  image_media_id: zId.nullish(),
  duration_min: z.coerce.number().int().min(5).max(480).default(30),
  price_from: z.coerce.number().min(0).max(1000000).nullish(),
  currency: z.string().trim().max(8).default('INR'),
  show_price: zBool.default(false),
  bookable: zBool.default(true),
  is_active: zBool.default(true),
  /* Treatment page content. */
  who_needs: z.string().trim().max(2000).nullish(),
  what_to_expect: z.string().trim().max(2000).nullish(),
  benefits: z.string().trim().max(2000).nullish(),
  seo_title: z.string().trim().max(120).nullish(),
  seo_description: z.string().trim().max(300).nullish(),
  is_featured: zBool.default(false),
  has_detail_page: zBool.default(true),
});

router.post('/', validate(serviceSchema), async (req, res) => {
  const b = { ...req.body };
  if (b.category && !b.category_id) b.category_id = (await servicesRepo.ensureCategory(b.category)).id;
  const created = await servicesRepo.create(b);
  await audit(ctxFrom(req), {
    action: 'service.create', entity: 'service', entity_id: created.id,
    summary: `Added service "${created.name}" (${created.duration_min} min)`, after: created,
  });
  res.status(201).json({ ok: true, service: created });
});

router.put('/:id', validate(partialUpdate(serviceSchema)), async (req, res) => {
  const id = Number(req.params.id);
  const before = await servicesRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Service not found.', code: 'NOT_FOUND' });

  const fields = { ...req.body };
  if (fields.category && !fields.category_id) {
    fields.category_id = (await servicesRepo.ensureCategory(fields.category)).id;
  }
  delete fields.category;
  await servicesRepo.update(id, fields);
  const after = await servicesRepo.findById(id);
  await audit(ctxFrom(req), {
    action: 'service.update', entity: 'service', entity_id: id,
    summary: `Updated service "${after.name}"`, before, after,
  });
  res.json({ ok: true, service: after });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = await servicesRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Service not found.', code: 'NOT_FOUND' });
  await servicesRepo.softDelete(id);
  await audit(ctxFrom(req), {
    action: 'service.delete', entity: 'service', entity_id: id,
    summary: `Removed service "${before.name}"`, before,
  });
  res.json({ ok: true });
});

router.post('/reorder', validate(z.object({ ids: z.array(zId).min(1).max(200) })), async (req, res) => {
  await servicesRepo.reorder(req.body.ids);
  await audit(ctxFrom(req), {
    action: 'service.reorder', entity: 'service', entity_id: 'all',
    summary: 'Reordered services',
  });
  res.json({ ok: true });
});

export default router;
