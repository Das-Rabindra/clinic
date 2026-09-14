/**
 * Gallery + media management, including the patient-consent workflow (§14).
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validate, partialUpdate, zId, zBool } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/error.js';
import * as galleryRepo from '../../repositories/gallery.repo.js';
import * as mediaRepo from '../../repositories/media.repo.js';
import * as mediaService from '../../services/media.service.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { config } from '../../config/env.js';
import { GALLERY_CATEGORIES, CONSENT_REQUIRED_CATEGORIES } from '../../config/constants.js';

const router = Router();

/** Memory storage: bytes are validated and re-encoded before ever hitting disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxUploadBytes, files: 2 },
});

router.get('/', validate(z.object({
  category: z.enum(GALLERY_CATEGORIES).optional(),
  published: z.enum(['0', '1']).optional(),
}), 'query'), (req, res) => {
  const { category, published } = req.validatedQuery;
  res.json({
    items: galleryRepo.listAdmin({
      category,
      published: published === undefined ? undefined : Number(published),
    }),
    categories: GALLERY_CATEGORIES,
    consent_required_for: CONSENT_REQUIRED_CATEGORIES,
    max_upload_mb: mediaService.maxUploadMb(),
  });
});

/* ── Media library ── */
router.get('/media', (req, res) => {
  const folder = typeof req.query.folder === 'string' ? req.query.folder : null;
  res.json(mediaRepo.list({ folder, limit: 200 }).map(m => ({
    ...m, thumb_url: mediaRepo.thumbFor(m.id)?.url || m.url,
  })));
});

router.post('/media', upload.single('file'), asyncHandler(async (req, res) => {
  const folder = String(req.body.folder || 'clinic');
  try {
    const media = await mediaService.ingestImage(req.file, {
      folder, alt: req.body.alt || null, userId: req.user.id,
    });
    audit(ctxFrom(req), {
      action: 'media.upload', entity: 'media', entity_id: media.id,
      summary: `Uploaded image to ${folder} (${Math.round(media.bytes / 1024)} KB)`,
    });
    res.status(201).json({ ok: true, media: { ...media, thumb_url: media.thumb.url } });
  } catch (err) {
    if (err instanceof mediaService.MediaError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}));

router.delete('/media/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const media = mediaRepo.findById(id);
  if (!media) return res.status(404).json({ error: 'Image not found.', code: 'NOT_FOUND' });
  await mediaService.deleteMedia(id);
  audit(ctxFrom(req), {
    action: 'media.delete', entity: 'media', entity_id: id,
    summary: `Deleted image ${media.key}`,
  });
  res.json({ ok: true });
}));

/* ── Gallery items ── */
const itemSchema = z.object({
  media_id: zId,
  after_media_id: zId.nullish(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullish(),
  category: z.enum(GALLERY_CATEGORIES).default('clinic'),
  taken_on: z.string().trim().max(20).nullish(),
  is_published: zBool.default(false),
  consent_confirmed: zBool.default(false),
  consent_note: z.string().trim().max(500).nullish(),
});

/**
 * Consent gate. Mirrors the CHECK constraint so the admin gets a clear message
 * instead of a raw database error, and records who confirmed it.
 */
function consentProblem(category, consentConfirmed, isPublished) {
  if (!CONSENT_REQUIRED_CATEGORIES.includes(category)) return null;
  if (isPublished && !consentConfirmed) {
    return 'Patient treatment photos can only be published once written patient consent has been confirmed.';
  }
  return null;
}

router.post('/', validate(itemSchema), (req, res) => {
  const b = req.body;
  const problem = consentProblem(b.category, b.consent_confirmed, b.is_published);
  if (problem) return res.status(422).json({ error: problem, code: 'CONSENT_REQUIRED' });

  if (!mediaRepo.findById(b.media_id)) {
    return res.status(400).json({ error: 'That image no longer exists.', code: 'BAD_MEDIA' });
  }

  const created = galleryRepo.create({ ...b, consent_by: req.user.id });
  audit(ctxFrom(req), {
    action: 'gallery.create', entity: 'gallery_item', entity_id: created.id,
    summary: `Added gallery item "${created.title}" (${created.category})${created.consent_confirmed ? ' — consent confirmed' : ''}`,
    after: { title: created.title, category: created.category, is_published: created.is_published },
  });
  res.status(201).json({ ok: true, item: created });
});

router.put('/:id', validate(partialUpdate(itemSchema).omit({ media_id: true })), (req, res) => {
  const id = Number(req.params.id);
  const before = galleryRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Gallery item not found.', code: 'NOT_FOUND' });

  const category = req.body.category ?? before.category;
  const consent = req.body.consent_confirmed ?? Boolean(before.consent_confirmed);
  const published = req.body.is_published ?? Boolean(before.is_published);
  const problem = consentProblem(category, consent, published);
  if (problem) return res.status(422).json({ error: problem, code: 'CONSENT_REQUIRED' });

  if (req.body.consent_confirmed !== undefined
      && Boolean(before.consent_confirmed) !== req.body.consent_confirmed) {
    galleryRepo.setConsent(id, req.body.consent_confirmed, req.user.id, req.body.consent_note);
  }
  const { consent_confirmed: _c, ...fields } = req.body;
  galleryRepo.update(id, fields);

  const after = galleryRepo.findById(id);
  audit(ctxFrom(req), {
    action: 'gallery.update', entity: 'gallery_item', entity_id: id,
    summary: `Updated gallery item "${after.title}"`,
    before: { title: before.title, is_published: before.is_published, consent_confirmed: before.consent_confirmed },
    after: { title: after.title, is_published: after.is_published, consent_confirmed: after.consent_confirmed },
  });
  res.json({ ok: true, item: after });
});

router.post('/:id/publish', validate(z.object({ published: zBool })), (req, res) => {
  const id = Number(req.params.id);
  const result = galleryRepo.setPublished(id, req.body.published);
  if (!result.ok) {
    if (result.error === 'NOT_FOUND') return res.status(404).json({ error: 'Gallery item not found.', code: 'NOT_FOUND' });
    return res.status(422).json({
      error: 'Patient treatment photos can only be published once written patient consent has been confirmed.',
      code: 'CONSENT_REQUIRED',
    });
  }
  const item = galleryRepo.findById(id);
  audit(ctxFrom(req), {
    action: req.body.published ? 'gallery.publish' : 'gallery.unpublish',
    entity: 'gallery_item', entity_id: id,
    summary: `${req.body.published ? 'Published' : 'Unpublished'} "${item.title}"`,
  });
  res.json({ ok: true, item });
});

/** Explicit consent action, kept separate so it is auditable on its own. */
router.post('/:id/consent', validate(z.object({
  confirmed: zBool,
  note: z.string().trim().max(500).nullish(),
})), (req, res) => {
  const id = Number(req.params.id);
  const item = galleryRepo.findById(id);
  if (!item) return res.status(404).json({ error: 'Gallery item not found.', code: 'NOT_FOUND' });

  galleryRepo.setConsent(id, req.body.confirmed, req.user.id, req.body.note);
  if (!req.body.confirmed && item.is_published && CONSENT_REQUIRED_CATEGORIES.includes(item.category)) {
    galleryRepo.setPublished(id, false);   // withdrawing consent unpublishes
  }
  audit(ctxFrom(req), {
    action: req.body.confirmed ? 'gallery.consent.confirm' : 'gallery.consent.withdraw',
    entity: 'gallery_item', entity_id: id,
    summary: `${req.body.confirmed ? 'Confirmed' : 'Withdrew'} patient consent for "${item.title}"${req.body.note ? ` — ${req.body.note}` : ''}`,
  });
  res.json({ ok: true, item: galleryRepo.findById(id) });
});

router.post('/reorder', validate(z.object({ ids: z.array(zId).min(1).max(300) })), (req, res) => {
  galleryRepo.reorder(req.body.ids);
  audit(ctxFrom(req), {
    action: 'gallery.reorder', entity: 'gallery_item', entity_id: 'all',
    summary: 'Reordered gallery',
  });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = galleryRepo.findById(id);
  if (!item) return res.status(404).json({ error: 'Gallery item not found.', code: 'NOT_FOUND' });
  galleryRepo.softDelete(id);
  audit(ctxFrom(req), {
    action: 'gallery.delete', entity: 'gallery_item', entity_id: id,
    summary: `Deleted gallery item "${item.title}"`,
  });
  res.json({ ok: true });
});

export default router;
