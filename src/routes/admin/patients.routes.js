import { Router } from 'express';
import { z } from 'zod';
import { validate, zName, zPhone } from '../../middleware/validate.js';
import * as patientsRepo from '../../repositories/patients.repo.js';
import * as apptRepo from '../../repositories/appointments.repo.js';
import { audit, ctxFrom } from '../../services/audit.service.js';
import { normalisePhone, maskPhone } from '../../utils/format.js';
import { minTo12h } from '../../utils/time.js';

const router = Router();

router.get('/', validate(z.object({
  q: z.string().trim().max(80).default(''),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}), 'query'), async (req, res) => {
  const { q, limit, offset } = req.validatedQuery;
  res.json(await patientsRepo.search({ q, limit, offset }));
});

router.get('/:id', async (req, res) => {
  const patient = await patientsRepo.findById(Number(req.params.id));
  if (!patient) return res.status(404).json({ error: 'Patient not found.', code: 'NOT_FOUND' });
  const appointments = await apptRepo.forPatient(patient.id);
  res.json({
    patient,
    appointments: appointments.map(a => ({ ...a, time_label: minTo12h(a.start_min) })),
    stats: {
      total: appointments.length,
      completed: appointments.filter(a => a.status === 'completed').length,
      cancelled: appointments.filter(a => a.status === 'cancelled').length,
      no_show: appointments.filter(a => a.status === 'no_show').length,
    },
  });
});

router.post('/', validate(z.object({
  name: zName, phone: zPhone,
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  dob: z.string().trim().max(20).optional().or(z.literal('')),
  gender: z.string().trim().max(20).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})), async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({
      error: 'Please check the highlighted fields.', code: 'VALIDATION',
      fields: { phone: 'Enter a valid 10-digit mobile number.' },
    });
  }
  const existing = await patientsRepo.findByPhone(phone);
  if (existing) {
    return res.status(409).json({
      error: `That number already belongs to ${existing.name} (${existing.code}).`,
      code: 'DUPLICATE_PHONE', patient_id: existing.id,
    });
  }
  const created = await patientsRepo.create({ ...req.body, phone, created_by: req.user.id });
  await audit(ctxFrom(req), {
    action: 'patient.create', entity: 'patient', entity_id: created.id,
    summary: `Added patient ${created.name} (${maskPhone(created.phone)})`,
  });
  res.status(201).json({ ok: true, patient: created });
});

router.put('/:id', validate(z.object({
  name: zName.optional(),
  email: z.string().trim().email().max(200).nullish().or(z.literal('')),
  dob: z.string().trim().max(20).nullish().or(z.literal('')),
  gender: z.string().trim().max(20).nullish().or(z.literal('')),
  notes: z.string().trim().max(2000).nullish().or(z.literal('')),
  is_blocked: z.boolean().optional(),
})), async (req, res) => {
  const id = Number(req.params.id);
  const before = await patientsRepo.findById(id);
  if (!before) return res.status(404).json({ error: 'Patient not found.', code: 'NOT_FOUND' });
  await patientsRepo.update(id, { ...req.body, is_blocked: req.body.is_blocked === undefined ? undefined : (req.body.is_blocked ? 1 : 0) });
  const after = await patientsRepo.findById(id);
  await audit(ctxFrom(req), {
    action: 'patient.update', entity: 'patient', entity_id: id,
    summary: `Updated patient ${after.name}`,
    before: { name: before.name, notes: before.notes, is_blocked: before.is_blocked },
    after: { name: after.name, notes: after.notes, is_blocked: after.is_blocked },
  });
  res.json({ ok: true, patient: after });
});

export default router;
