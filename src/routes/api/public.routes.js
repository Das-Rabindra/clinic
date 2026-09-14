/**
 * Public JSON API. Everything here is unauthenticated, rate-limited, and
 * returns only data the clinic has chosen to publish.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate, zDate, zTime, zPhone, zName, zId } from '../../middleware/validate.js';
import { bookingLimiter, enquiryLimiter, apiLimiter, lookupLimiter } from '../../middleware/ratelimit.js';
import { requirePublicCsrf, issuePublicToken } from '../../middleware/csrf.js';
import { asyncHandler } from '../../middleware/error.js';

import * as settingsRepo from '../../repositories/settings.repo.js';
import * as servicesRepo from '../../repositories/services.repo.js';
import * as doctorsRepo from '../../repositories/doctors.repo.js';
import * as galleryRepo from '../../repositories/gallery.repo.js';
import * as contentRepo from '../../repositories/content.repo.js';
import * as apptRepo from '../../repositories/appointments.repo.js';
import * as availability from '../../services/availability.service.js';
import * as appointmentService from '../../services/appointment.service.js';
import * as reviewsService from '../../services/google/reviews.service.js';
import * as events from '../../services/notification/events.js';
import { appointmentIcs } from '../../services/calendar.service.js';
import { publicClinic } from '../../services/clinic.view.js';
import { normalisePhone } from '../../utils/format.js';
import { WEEKDAYS } from '../../config/constants.js';
import { minToHHMM } from '../../utils/time.js';

const router = Router();
router.use(apiLimiter);

/* Token endpoint so the booking form can obtain a CSRF token. */
router.get('/csrf', (req, res) => res.json({ token: issuePublicToken(req, res) }));

/* ── Clinic ── */
router.get('/clinic', async (_req, res) => res.json(await publicClinic()));

router.get('/hours', async (_req, res) => {
  res.json((await settingsRepo.getHours()).map(h => ({
    weekday: h.weekday,
    day: WEEKDAYS[h.weekday],
    is_open: h.is_open === 1,
    open: minToHHMM(h.open_min),
    close: minToHHMM(h.close_min),
    break_start: h.break_start_min != null ? minToHHMM(h.break_start_min) : null,
    break_end: h.break_end_min != null ? minToHHMM(h.break_end_min) : null,
  })));
});

/* ── Catalogue ── */
router.get('/services', async (_req, res) => {
  res.json((await servicesRepo.list({ activeOnly: true })).map(s => ({
    id: s.id, name: s.name, slug: s.slug, category: s.category_name,
    short_desc: s.short_desc, long_desc: s.long_desc,
    duration_min: s.duration_min, bookable: s.bookable === 1,
    price_from: s.show_price ? s.price_from : null,
    currency: s.show_price ? s.currency : null,
    image_url: s.image_url,
  })));
});

router.get('/doctors', async (_req, res) => {
  res.json((await doctorsRepo.list({ activeOnly: true })).map(d => ({
    id: d.id, name: d.name, slug: d.slug, qualification: d.qualification,
    registration: d.registration, specialization: d.specialization, bio: d.bio,
    experience_years: d.experience_years, languages: d.languages,
    photo_url: d.photo_url,
  })));
});

router.get('/faqs', async (_req, res) => {
  res.json((await contentRepo.listFaqs({ publishedOnly: true }))
    .map(f => ({ id: f.id, question: f.question, answer: f.answer })));
});

router.get('/gallery', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  // Consent fields are deliberately not exposed publicly.
  res.json((await galleryRepo.listPublic(category)).map(g => ({
    id: g.id, title: g.title, description: g.description, category: g.category,
    image_url: g.image_url, thumb_url: g.thumb_url || g.image_url,
    after_url: g.after_url, after_thumb_url: g.after_thumb_url,
    width: g.width, height: g.height, alt: g.image_alt,
  })));
});

router.get('/reviews', async (_req, res) => res.json(await reviewsService.publicReviews()));

/* ── Availability ── */
const availabilityQuery = z.object({
  date: zDate,
  service_id: zId.optional(),
  doctor_id: zId.optional(),
});

router.get('/appointments/availability', validate(availabilityQuery, 'query'), async (req, res) => {
  const { date, service_id: serviceId, doctor_id: doctorId } = req.validatedQuery;
  res.json(await availability.getDayAvailability({ date, serviceId, doctorId }));
});

const overviewQuery = z.object({
  from: zDate.optional(),
  days: z.coerce.number().int().min(1).max(62).default(30),
  service_id: zId.optional(),
  doctor_id: zId.optional(),
});

router.get('/appointments/calendar', validate(overviewQuery, 'query'), async (req, res) => {
  const { from, days, service_id: serviceId, doctor_id: doctorId } = req.validatedQuery;
  res.json({
    days: await availability.getMonthOverview({ from, days, serviceId, doctorId }),
    next_available: await availability.nextAvailableDate({ serviceId, doctorId }),
  });
});

/* ── Booking ── */
const bookingSchema = z.object({
  name: zName,
  phone: zPhone,
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  date: zDate,
  time: zTime,
  service_id: zId.optional(),
  doctor_id: zId.optional(),
  reason: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional().or(z.literal('')),
  is_new_patient: z.boolean().optional().default(true),
});

router.post('/appointments', bookingLimiter, requirePublicCsrf, validate(bookingSchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    try {
      const appt = await appointmentService.createAppointment({
        name: b.name, phone: b.phone, email: b.email || null,
        date: b.date, time: b.time,
        serviceId: b.service_id, doctorId: b.doctor_id,
        reason: b.reason || null, message: b.message || null,
        isNewPatient: b.is_new_patient, source: 'website',
      }, { ip: req.ip, userAgent: String(req.get('user-agent') || '').slice(0, 300) });

      res.status(201).json({ ok: true, appointment: await appointmentService.publicView(appt) });
    } catch (err) {
      if (err instanceof appointmentService.BookingError) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  }));

/* ── Patient self-service: lookup requires the booking ref AND the phone ── */
const lookupQuery = z.object({ phone: zPhone });

router.get('/appointments/:ref', lookupLimiter, validate(lookupQuery, 'query'), async (req, res) => {
  const appt = await apptRepo.findByRef(req.params.ref);
  const phone = normalisePhone(req.validatedQuery.phone);
  if (!appt || !phone || appt.patient_phone !== phone) {
    return res.status(404).json({ error: 'No appointment found for those details.', code: 'NOT_FOUND' });
  }
  res.json(await appointmentService.publicView(appt));
});

router.get('/appointments/:ref/calendar.ics', lookupLimiter, validate(lookupQuery, 'query'), async (req, res) => {
  const appt = await apptRepo.findByRef(req.params.ref);
  const phone = normalisePhone(req.validatedQuery.phone);
  if (!appt || !phone || appt.patient_phone !== phone) {
    return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  }
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${appt.ref}.ics"`);
  res.send(await appointmentIcs(appt));
});

const cancelSchema = z.object({ phone: zPhone, reason: z.string().trim().max(300).optional() });

router.post('/appointments/:ref/cancel', lookupLimiter, requirePublicCsrf, validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const appt = await apptRepo.findByRef(req.params.ref);
    const phone = normalisePhone(req.body.phone);
    if (!appt || !phone || appt.patient_phone !== phone) {
      return res.status(404).json({ error: 'No appointment found for those details.', code: 'NOT_FOUND' });
    }
    if (!['pending', 'confirmed', 'rescheduled'].includes(appt.status)) {
      return res.status(409).json({ error: 'This appointment can no longer be cancelled online. Please call the clinic.', code: 'NOT_CANCELLABLE' });
    }
    const updated = await appointmentService.cancel(appt.id,
      { reason: req.body.reason || 'Cancelled by patient' },
      { ip: req.ip, userEmail: 'patient' });
    res.json({ ok: true, appointment: await appointmentService.publicView(updated) });
  }));

/* ── Enquiries ── */
const enquirySchema = z.object({
  name: zName,
  phone: zPhone,
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  message: z.string().trim().max(1500).optional().or(z.literal('')),
  preferred_contact: z.enum(['phone', 'whatsapp', 'email']).default('phone'),
});

router.post('/enquiries', enquiryLimiter, requirePublicCsrf, validate(enquirySchema), async (req, res) => {
  const phone = normalisePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({
      error: 'Please check the highlighted fields.', code: 'VALIDATION',
      fields: { phone: 'Enter a valid 10-digit mobile number.' },
    });
  }
  const enquiry = await contentRepo.createEnquiry({ ...req.body, phone });
  try { await events.enquiryCreated(enquiry); }
  catch (err) { console.error('[enquiry] notification enqueue failed (enquiry saved):', err.message); }
  res.status(201).json({ ok: true, id: enquiry.id });
});

export default router;
