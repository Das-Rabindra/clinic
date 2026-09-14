import { Router } from 'express';
import { z } from 'zod';
import { validate, partialUpdate, zId, zBool, zMinutes } from '../../middleware/validate.js';
import * as doctorsRepo from '../../repositories/doctors.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { WEEKDAYS } from '../../config/constants.js';

const router = Router();

router.get('/', async (_req, res) => {
  const doctors = await doctorsRepo.list();
  res.json(await Promise.all(
    doctors.map(async (d) => ({ ...d, schedule: await doctorsRepo.schedule(d.id) }))
  ));
});

router.get('/:id', async (req, res) => {
  const d = await doctorsRepo.findById(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  res.json({ ...d, schedule: await doctorsRepo.schedule(d.id) });
});

const doctorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  qualification: z.string().trim().max(120).nullish(),
  registration: z.string().trim().max(120).nullish(),
  specialization: z.string().trim().max(200).nullish(),
  bio: z.string().trim().max(4000).nullish(),
  experience_years: z.coerce.number().int().min(0).max(80).nullish(),
  languages: z.string().trim().max(200).nullish(),
  consultation_fee: z.coerce.number().min(0).max(1000000).nullish(),
  currency: z.string().trim().max(8).default('INR'),
  slot_interval_min: z.coerce.number().int().min(5).max(240).nullish(),
  photo_media_id: zId.nullish(),
  is_active: zBool.default(true),
  display_order: z.coerce.number().int().min(0).max(999).default(0),
});

router.post('/', validate(doctorSchema), async (req, res) => {
  const created = await doctorsRepo.create(req.body);
  await audit(ctxFrom(req), {
    action: 'doctor.create', entity: 'doctor', entity_id: created.id,
    summary: `Added ${created.name}`, after: created,
  });
  res.status(201).json({ ok: true, doctor: created });
});

router.put('/:id', validate(partialUpdate(doctorSchema)), async (req, res) => {
  const id = Number(req.params.id);
  const before = await doctorsRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  await doctorsRepo.update(id, req.body);
  const after = await doctorsRepo.findById(id);
  await audit(ctxFrom(req), {
    action: 'doctor.update', entity: 'doctor', entity_id: id,
    summary: `Updated ${after.name}`, before, after,
  });
  res.json({ ok: true, doctor: after });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = await doctorsRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  if ((await doctorsRepo.list({ activeOnly: true })).length <= 1 && before.is_active) {
    return res.status(409).json({
      error: 'This is the only active dentist. Add another before removing this one.', code: 'LAST_DOCTOR',
    });
  }
  await doctorsRepo.softDelete(id);
  await audit(ctxFrom(req), {
    action: 'doctor.delete', entity: 'doctor', entity_id: id,
    summary: `Removed ${before.name}`, before,
  });
  res.json({ ok: true });
});

/** Per-doctor weekly schedule. Omitting a day makes it inherit clinic hours. */
router.put('/:id/schedule', validate(z.object({
  schedule: z.array(z.object({
    weekday: z.coerce.number().int().min(0).max(6),
    inherit: zBool.default(false),
    is_open: zBool.default(true),
    open_min: zMinutes, close_min: zMinutes,
    break_start_min: zMinutes.nullish(), break_end_min: zMinutes.nullish(),
  })).max(7),
})), async (req, res) => {
  const id = Number(req.params.id);
  const doctor = await doctorsRepo.findById(id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });

  for (const s of req.body.schedule) {
    if (s.inherit) { await doctorsRepo.clearSchedule(id, s.weekday); continue; }
    if (s.is_open && s.close_min <= s.open_min) {
      return res.status(400).json({
        error: `${WEEKDAYS[s.weekday]}: closing time must be after opening time.`, code: 'VALIDATION',
      });
    }
    await doctorsRepo.upsertSchedule(id, s.weekday, s);
  }
  await audit(ctxFrom(req), {
    action: 'doctor.schedule.update', entity: 'doctor', entity_id: id,
    summary: `Updated working hours for ${doctor.name}`,
    after: await doctorsRepo.schedule(id),
  });
  res.json({ ok: true, schedule: await doctorsRepo.schedule(id) });
});

export default router;
