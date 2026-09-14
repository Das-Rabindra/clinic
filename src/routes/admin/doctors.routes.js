import { Router } from 'express';
import { z } from 'zod';
import { validate, partialUpdate, zId, zBool, zMinutes } from '../../middleware/validate.js';
import * as doctorsRepo from '../../repositories/doctors.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { WEEKDAYS } from '../../config/constants.js';

const router = Router();

router.get('/', (_req, res) => {
  const doctors = doctorsRepo.list();
  res.json(doctors.map(d => ({ ...d, schedule: doctorsRepo.schedule(d.id) })));
});

router.get('/:id', (req, res) => {
  const d = doctorsRepo.findById(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  res.json({ ...d, schedule: doctorsRepo.schedule(d.id) });
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

router.post('/', validate(doctorSchema), (req, res) => {
  const created = doctorsRepo.create(req.body);
  audit(ctxFrom(req), {
    action: 'doctor.create', entity: 'doctor', entity_id: created.id,
    summary: `Added ${created.name}`, after: created,
  });
  res.status(201).json({ ok: true, doctor: created });
});

router.put('/:id', validate(partialUpdate(doctorSchema)), (req, res) => {
  const id = Number(req.params.id);
  const before = doctorsRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  doctorsRepo.update(id, req.body);
  const after = doctorsRepo.findById(id);
  audit(ctxFrom(req), {
    action: 'doctor.update', entity: 'doctor', entity_id: id,
    summary: `Updated ${after.name}`, before, after,
  });
  res.json({ ok: true, doctor: after });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const before = doctorsRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });
  if (doctorsRepo.list({ activeOnly: true }).length <= 1 && before.is_active) {
    return res.status(409).json({
      error: 'This is the only active dentist. Add another before removing this one.', code: 'LAST_DOCTOR',
    });
  }
  doctorsRepo.softDelete(id);
  audit(ctxFrom(req), {
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
})), (req, res) => {
  const id = Number(req.params.id);
  const doctor = doctorsRepo.findById(id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found.', code: 'NOT_FOUND' });

  for (const s of req.body.schedule) {
    if (s.inherit) { doctorsRepo.clearSchedule(id, s.weekday); continue; }
    if (s.is_open && s.close_min <= s.open_min) {
      return res.status(400).json({
        error: `${WEEKDAYS[s.weekday]}: closing time must be after opening time.`, code: 'VALIDATION',
      });
    }
    doctorsRepo.upsertSchedule(id, s.weekday, s);
  }
  audit(ctxFrom(req), {
    action: 'doctor.schedule.update', entity: 'doctor', entity_id: id,
    summary: `Updated working hours for ${doctor.name}`,
    after: doctorsRepo.schedule(id),
  });
  res.json({ ok: true, schedule: doctorsRepo.schedule(id) });
});

export default router;
