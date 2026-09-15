import { Router } from 'express';
import { z } from 'zod';
import { validate, zDate, zId, zMinutes, zBool } from '../../middleware/validate.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { requireRole } from '../../middleware/auth.js';
import { WEEKDAYS, ROLES } from '../../config/constants.js';
import { minToHHMM } from '../../utils/time.js';

const router = Router();

router.get('/', async (_req, res) => {
  res.json({
    settings: await settingsRepo.get(),
    hours: await settingsRepo.getHours(),
    full_address: await settingsRepo.fullAddress(),
  });
});

/**
 * Optional text field for a partial update.
 *
 * An absent key must stay `undefined` so buildUpdate skips the column
 * entirely; only an explicitly sent empty string means "clear this field".
 * Collapsing undefined to null here would make a one-field PUT wipe every
 * column the caller did not mention.
 */
const nullableStr = (max = 500) =>
  z.string().trim().max(max).nullish()
    .transform(v => (v === undefined ? undefined : (v === '' ? null : v)));

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  doctor_name: nullableStr(120), qualification: nullableStr(120),
  registration: nullableStr(120), institution: nullableStr(200),
  tagline: nullableStr(300), description: nullableStr(2000),
  phone: nullableStr(20), phone_intl: nullableStr(20), whatsapp: nullableStr(20),
  email: z.union([z.string().trim().email().max(200), z.literal(''), z.null()]).optional()
    .transform(v => (v === undefined ? undefined : (v === '' ? null : v))),
  site_url: nullableStr(300),
  address_line1: nullableStr(200), address_line2: nullableStr(200),
  area: nullableStr(120), city: nullableStr(120), state: nullableStr(120),
  postal_code: nullableStr(20), country: nullableStr(80),
  maps_url: nullableStr(600), place_id: nullableStr(200),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  timezone: z.string().trim().max(60).optional(),
  slot_interval_min: z.coerce.number().int().min(5).max(240).optional(),
  booking_lead_hours: z.coerce.number().int().min(0).max(168).optional(),
  booking_horizon_days: z.coerce.number().int().min(1).max(365).optional(),
  auto_confirm: zBool.optional(),
  reviews_url: nullableStr(600), instagram_url: nullableStr(300), facebook_url: nullableStr(300),
  youtube_url: nullableStr(300),
  logo_media_id: zId.nullish(), favicon_media_id: zId.nullish(),
  og_image_media_id: zId.nullish(), hero_media_id: zId.nullish(),
  seo_title: nullableStr(200), seo_description: nullableStr(400), seo_canonical: nullableStr(300),
  og_title: nullableStr(200), og_description: nullableStr(400),
  hero_eyebrow: nullableStr(120), hero_title: nullableStr(300), hero_lede: nullableStr(600),
  hero_cta_label: nullableStr(60), hero_trust_text: nullableStr(300),
  about_title: nullableStr(200), about_body: nullableStr(3000),
  story_title: nullableStr(200), story_body: nullableStr(3000),
  services_title: nullableStr(200), services_lede: nullableStr(600),
  gallery_title: nullableStr(200), gallery_lede: nullableStr(600),
  reviews_title: nullableStr(200), cta_title: nullableStr(200), cta_body: nullableStr(600),
  treatments_eyebrow: nullableStr(120),
  location_title: nullableStr(200), location_body: nullableStr(1500),
}).strict();

router.put('/', requireRole(ROLES.ADMIN), validate(settingsSchema), async (req, res) => {
  const before = await settingsRepo.get();
  await settingsRepo.update(req.body);
  const after = await settingsRepo.get();

  // Note which fields actually changed, so the audit trail is readable.
  const changed = Object.keys(req.body).filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
  await audit(ctxFrom(req), {
    action: 'clinic.update', entity: 'clinic_settings', entity_id: 1,
    summary: changed.length
      ? `Updated clinic information: ${changed.join(', ')}`
      : 'Saved clinic information (no changes)',
    before: Object.fromEntries(changed.map(k => [k, before[k]])),
    after: Object.fromEntries(changed.map(k => [k, after[k]])),
  });
  res.json({ ok: true, settings: after, changed });
});

/* ── Working hours ── */
const hoursSchema = z.object({
  hours: z.array(z.object({
    weekday: z.coerce.number().int().min(0).max(6),
    is_open: zBool,
    open_min: zMinutes, close_min: zMinutes,
    break_start_min: zMinutes.nullish(), break_end_min: zMinutes.nullish(),
  })).min(1).max(7),
});

router.put('/hours', requireRole(ROLES.ADMIN), validate(hoursSchema), async (req, res) => {
  const before = await settingsRepo.getHours();
  for (const h of req.body.hours) {
    if (h.is_open && h.close_min <= h.open_min) {
      return res.status(400).json({
        error: `${WEEKDAYS[h.weekday]}: closing time must be after opening time.`, code: 'VALIDATION',
      });
    }
    if (h.break_start_min != null && h.break_end_min != null && h.break_end_min <= h.break_start_min) {
      return res.status(400).json({
        error: `${WEEKDAYS[h.weekday]}: break end must be after break start.`, code: 'VALIDATION',
      });
    }
    await settingsRepo.upsertHours(h.weekday, h);
  }
  const after = await settingsRepo.getHours();
  await audit(ctxFrom(req), {
    action: 'clinic.hours.update', entity: 'clinic_hours', entity_id: 'all',
    summary: 'Updated clinic working hours',
    before, after,
  });
  res.json({ ok: true, hours: after });
});

/* ── Holidays ── */
router.get('/holidays', async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  res.json(await settingsRepo.listHolidays(from));
});

const holidaySchema = z.object({
  date: zDate,
  end_date: zDate.nullish(),
  doctor_id: zId.nullish(),
  reason: z.string().trim().max(200).nullish(),
  is_full_day: zBool.default(true),
  start_min: zMinutes.nullish(), end_min: zMinutes.nullish(),
});

router.post('/holidays', requireRole(ROLES.ADMIN), validate(holidaySchema), async (req, res) => {
  const b = req.body;
  if (b.end_date && b.end_date < b.date) {
    return res.status(400).json({ error: 'End date must be on or after the start date.', code: 'VALIDATION' });
  }
  if (!b.is_full_day && (b.start_min == null || b.end_min == null || b.end_min <= b.start_min)) {
    return res.status(400).json({ error: 'Give a valid start and end time for a partial closure.', code: 'VALIDATION' });
  }
  const id = await settingsRepo.addHoliday({ ...b, created_by: req.user.id });
  await audit(ctxFrom(req), {
    action: 'clinic.holiday.add', entity: 'holiday', entity_id: id,
    summary: `Added closure on ${b.date}${b.end_date ? ` to ${b.end_date}` : ''}${b.reason ? ` — ${b.reason}` : ''}`,
    after: b,
  });
  res.status(201).json({ ok: true, id });
});

router.delete('/holidays/:id', requireRole(ROLES.ADMIN), async (req, res) => {
  const id = Number(req.params.id);
  const removed = await settingsRepo.deleteHoliday(id);
  if (removed) {
    await audit(ctxFrom(req), {
      action: 'clinic.holiday.delete', entity: 'holiday', entity_id: id,
      summary: `Removed closure #${id}`,
    });
  }
  res.json({ ok: Boolean(removed) });
});

/* ── Blocked slots ── */
router.get('/blocked-slots', async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  res.json(await settingsRepo.listBlocked(from));
});

router.post('/blocked-slots', validate(z.object({
  date: zDate, doctor_id: zId.nullish(),
  start_min: zMinutes, end_min: zMinutes,
  reason: z.string().trim().max(200).nullish(),
})), async (req, res) => {
  const b = req.body;
  if (b.end_min <= b.start_min) {
    return res.status(400).json({ error: 'End time must be after start time.', code: 'VALIDATION' });
  }
  const id = await settingsRepo.addBlocked({ ...b, created_by: req.user.id });
  await audit(ctxFrom(req), {
    action: 'clinic.block.add', entity: 'blocked_slot', entity_id: id,
    summary: `Blocked ${b.date} ${minToHHMM(b.start_min)}–${minToHHMM(b.end_min)}${b.reason ? ` — ${b.reason}` : ''}`,
    after: b,
  });
  res.status(201).json({ ok: true, id });
});

router.delete('/blocked-slots/:id', async (req, res) => {
  const id = Number(req.params.id);
  const removed = await settingsRepo.deleteBlocked(id);
  if (removed) {
    await audit(ctxFrom(req), {
      action: 'clinic.block.delete', entity: 'blocked_slot', entity_id: id,
      summary: `Removed block #${id}`,
    });
  }
  res.json({ ok: Boolean(removed) });
});

export default router;
