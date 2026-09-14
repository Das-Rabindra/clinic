import { Router } from 'express';
import { z } from 'zod';
import { validate, zDate, zTime, zId, zName, zPhone } from '../../middleware/validate.js';
import * as apptRepo from '../../repositories/appointments.repo.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import * as appointmentService from '../../services/appointment.service.js';
import * as availability from '../../services/availability.service.js';
import { ctxFrom } from '../../services/audit.service.js';
import { APPOINTMENT_STATUSES } from '../../config/constants.js';
import { todayIn, minTo12h, addDays } from '../../utils/time.js';

const router = Router();

const handleBookingError = (res, err) => {
  if (err instanceof appointmentService.BookingError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  throw err;
};

const listQuery = z.object({
  from: zDate.optional(), to: zDate.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  doctor_id: zId.optional(), service_id: zId.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/', validate(listQuery, 'query'), (req, res) => {
  const q = req.validatedQuery;
  const { rows, total } = apptRepo.search({
    from: q.from, to: q.to, status: q.status,
    doctorId: q.doctor_id, serviceId: q.service_id, q: q.q,
    limit: q.limit, offset: q.offset,
  });
  res.json({
    total, limit: q.limit, offset: q.offset,
    rows: rows.map(a => ({ ...a, time_label: minTo12h(a.start_min) })),
  });
});

/** Calendar feed for day/week/month views. */
const calendarQuery = z.object({
  from: zDate, to: zDate, doctor_id: zId.optional(),
});

router.get('/calendar', validate(calendarQuery, 'query'), (req, res) => {
  const { from, to, doctor_id: doctorId } = req.validatedQuery;
  const rows = apptRepo.between(from, to, doctorId);
  res.json(rows.map(a => ({
    id: a.id, ref: a.ref, date: a.date,
    start_min: a.start_min, end_min: a.end_min,
    time_label: minTo12h(a.start_min),
    patient: a.patient_name, phone: a.patient_phone,
    service: a.service_name, doctor: a.doctor_name, status: a.status,
  })));
});

router.get('/:id', (req, res) => {
  const appt = apptRepo.findById(Number(req.params.id));
  if (!appt) return res.status(404).json({ error: 'Appointment not found.', code: 'NOT_FOUND' });
  res.json({
    ...appt,
    time_label: minTo12h(appt.start_min),
    history: apptRepo.history(appt.id),
  });
});

/** Admin-created booking (walk-in / phone). Same engine, different source. */
const createSchema = z.object({
  name: zName, phone: zPhone,
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  date: zDate, time: zTime,
  service_id: zId.optional(), doctor_id: zId.optional(),
  reason: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
  source: z.enum(['admin', 'phone', 'walkin']).default('admin'),
});

router.post('/', validate(createSchema), (req, res) => {
  const b = req.body;
  try {
    const appt = appointmentService.createAppointment({
      name: b.name, phone: b.phone, email: b.email || null,
      date: b.date, time: b.time, serviceId: b.service_id, doctorId: b.doctor_id,
      reason: b.reason || null, message: b.message || null, source: b.source,
    }, ctxFrom(req));
    res.status(201).json({ ok: true, appointment: appt });
  } catch (err) { handleBookingError(res, err); }
});

router.post('/:id/confirm', (req, res) => {
  try { res.json({ ok: true, appointment: appointmentService.confirm(Number(req.params.id), ctxFrom(req)) }); }
  catch (err) { handleBookingError(res, err); }
});

router.post('/:id/cancel', validate(z.object({
  reason: z.string().trim().max(300).optional(),
  notify_patient: z.boolean().default(true),
})), (req, res) => {
  try {
    const appt = appointmentService.cancel(Number(req.params.id),
      { reason: req.body.reason, notifyPatient: req.body.notify_patient }, ctxFrom(req));
    res.json({ ok: true, appointment: appt });
  } catch (err) { handleBookingError(res, err); }
});

router.post('/:id/reschedule', validate(z.object({
  date: zDate, time: zTime, service_id: zId.optional(), doctor_id: zId.optional(),
})), (req, res) => {
  try {
    const appt = appointmentService.reschedule(Number(req.params.id), {
      date: req.body.date, time: req.body.time,
      serviceId: req.body.service_id, doctorId: req.body.doctor_id,
    }, ctxFrom(req));
    res.json({ ok: true, appointment: appt });
  } catch (err) { handleBookingError(res, err); }
});

router.post('/:id/status', validate(z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  note: z.string().trim().max(300).optional(),
})), (req, res) => {
  try {
    const appt = appointmentService.changeStatus(Number(req.params.id),
      req.body.status, { note: req.body.note }, ctxFrom(req));
    res.json({ ok: true, appointment: appt });
  } catch (err) { handleBookingError(res, err); }
});

/** Availability including taken slots, so staff can see the full day grid. */
router.get('/availability/grid', validate(z.object({
  date: zDate, service_id: zId.optional(), doctor_id: zId.optional(),
}), 'query'), (req, res) => {
  const q = req.validatedQuery;
  res.json(availability.getDayAvailability({
    date: q.date, serviceId: q.service_id, doctorId: q.doctor_id, includeTaken: true,
  }));
});

/** Day summary for the dashboard header. */
router.get('/summary/today', (_req, res) => {
  const tz = settingsRepo.get().timezone || 'Asia/Kolkata';
  const today = todayIn(tz);
  res.json({
    today, tomorrow: addDays(today, 1),
    counts: Object.fromEntries(apptRepo.statusCounts(today, today).map(r => [r.status, r.c])),
  });
});

export default router;
