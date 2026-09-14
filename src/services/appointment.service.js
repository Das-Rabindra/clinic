/**
 * Appointment orchestration.
 *
 * Design rule (spec §33): creating the appointment and delivering notifications
 * are separate concerns. The appointment commits in its own transaction; every
 * notification is a queued row. A WhatsApp outage can never lose a booking.
 */
import { tx } from '../db/index.js';
import * as apptRepo from '../repositories/appointments.repo.js';
import * as patientsRepo from '../repositories/patients.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as settingsRepo from '../repositories/settings.repo.js';
import * as availability from './availability.service.js';
import * as events from './notification/events.js';
import { audit } from './audit.service.js';
import { normalisePhone, maskPhone } from '../utils/format.js';
import { APPOINTMENT_STATUS, BLOCKING_STATUSES } from '../config/constants.js';
import { localToUtc, formatDateLong, minTo12h } from '../utils/time.js';

export class BookingError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = extra.status || 409;
    this.extra = extra;
  }
}

const isUniqueViolation = (err) =>
  String(err?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE') ||
  /UNIQUE constraint failed: appointment_slots/.test(String(err?.message));

/**
 * Create an appointment.
 *
 * The slot is validated for a good error message, then the write runs inside an
 * IMMEDIATE transaction where UNIQUE(doctor_id, date, slot_min) is the actual
 * guarantee. Two patients racing for the last slot: one commits, the other gets
 * a clean 409 SLOT_TAKEN.
 */
export function createAppointment(input, ctx = {}) {
  const {
    name, phone, email, date, time, serviceId, doctorId,
    reason, message, isNewPatient = true, source = 'website',
  } = input;

  const normalisedPhone = normalisePhone(phone);
  if (!normalisedPhone) throw new BookingError('INVALID_PHONE', 'Please enter a valid 10-digit mobile number.', { status: 400 });

  const service = serviceId ? servicesRepo.findBookable(serviceId) : null;
  if (serviceId && !service) throw new BookingError('INVALID_SERVICE', 'That treatment is not available for online booking.', { status: 400 });

  const check = availability.validateSlot({ date, time, serviceId, doctorId });
  if (!check.ok) {
    const messages = {
      CLOSED: 'The clinic is closed on that day.',
      HOLIDAY: 'The clinic is closed on that date.',
      PAST_DATE: 'That date has already passed.',
      BEYOND_HORIZON: 'That date is too far ahead to book online.',
      SLOT_UNAVAILABLE: 'That time is no longer available. Please choose another slot.',
      NO_DOCTOR: 'No dentist is available for booking right now.',
      INVALID_DATE: 'Please choose a valid date.',
    };
    throw new BookingError(check.code, messages[check.code] || 'That slot is not available.', { status: 409 });
  }

  const slot = check.slot;
  const doctor = doctorsRepo.findById(slot.doctor_id);

  let result;
  try {
    result = tx(() => {
      const { patient, created } = patientsRepo.upsertByPhone({
        name, phone: normalisedPhone, email, createdBy: ctx.userId ?? null,
      });
      if (patient.is_blocked) throw new BookingError('PATIENT_BLOCKED', 'Please call the clinic to book an appointment.', { status: 403 });

      const settings = settingsRepo.get();
      const status = settings.auto_confirm ? APPOINTMENT_STATUS.CONFIRMED : APPOINTMENT_STATUS.PENDING;

      const id = apptRepo.insertWithSlots({
        patient_id: patient.id,
        doctor_id: slot.doctor_id,
        service_id: service?.id ?? null,
        service_name: service?.name ?? reason ?? 'Consultation',
        date: slot.date,
        start_min: slot.start_min,
        end_min: slot.end_min,
        duration_min: slot.duration_min,
        starts_at_utc: slot.starts_at_utc,
        status,
        source,
        reason: reason ?? null,
        message: message ?? null,
        is_new_patient: created || isNewPatient ? 1 : 0,
        created_by: ctx.userId ?? null,
      }, slot.interval_min);

      apptRepo.setStatus(id, status, { note: 'Created', userId: ctx.userId ?? null });
      return { id, patient, patientCreated: created };
    });
  } catch (err) {
    if (err instanceof BookingError) throw err;
    if (isUniqueViolation(err)) {
      // Lost the race. The other booking committed first.
      throw new BookingError('SLOT_TAKEN',
        'That time was just booked by someone else. Please pick another slot.', { status: 409 });
    }
    throw err;
  }

  const appointment = apptRepo.findById(result.id);

  audit(ctx, {
    action: 'appointment.create',
    entity: 'appointment',
    entity_id: appointment.id,
    summary: `Booked ${appointment.ref} — ${appointment.service_name} on ${appointment.date} ${minTo12h(appointment.start_min)} for ${appointment.patient_name} (${maskPhone(appointment.patient_phone)})`,
    after: { ref: appointment.ref, date: appointment.date, start_min: appointment.start_min, status: appointment.status },
  });

  // Notifications are fire-and-forget queue writes; failure here must not
  // surface to the patient as a failed booking.
  try {
    events.appointmentCreated(appointment, { doctor });
  } catch (err) {
    console.error('[appointment] notification enqueue failed (appointment is saved):', err.message);
  }

  return appointment;
}

/** Confirm a pending appointment. */
export function confirm(id, ctx = {}) {
  const appt = apptRepo.findById(id);
  if (!appt) throw new BookingError('NOT_FOUND', 'Appointment not found.', { status: 404 });
  if (appt.status === APPOINTMENT_STATUS.CONFIRMED) return appt;

  apptRepo.setStatus(id, APPOINTMENT_STATUS.CONFIRMED, { note: 'Confirmed by clinic', userId: ctx.userId });
  const updated = apptRepo.findById(id);
  audit(ctx, {
    action: 'appointment.confirm', entity: 'appointment', entity_id: id,
    summary: `Confirmed ${updated.ref}`, before: { status: appt.status }, after: { status: updated.status },
  });
  events.appointmentConfirmed(updated);
  return updated;
}

/** Cancel. Slots are released by setStatus so the time becomes bookable again. */
export function cancel(id, { reason = null, notifyPatient = true } = {}, ctx = {}) {
  const appt = apptRepo.findById(id);
  if (!appt) throw new BookingError('NOT_FOUND', 'Appointment not found.', { status: 404 });
  if (appt.status === APPOINTMENT_STATUS.CANCELLED) return appt;

  tx(() => {
    apptRepo.setStatus(id, APPOINTMENT_STATUS.CANCELLED, { note: reason || 'Cancelled', userId: ctx.userId });
    if (reason) apptRepo.setCancelReason(id, reason);
  });

  const updated = apptRepo.findById(id);
  audit(ctx, {
    action: 'appointment.cancel', entity: 'appointment', entity_id: id,
    summary: `Cancelled ${updated.ref}${reason ? ` — ${reason}` : ''}`,
    before: { status: appt.status }, after: { status: 'cancelled' },
  });
  events.appointmentCancelled(updated, { notifyPatient, reason });
  return updated;
}

/**
 * Reschedule: move the appointment to a new slot atomically. If the new slot is
 * taken, the transaction rolls back and the original booking is untouched.
 */
export function reschedule(id, { date, time, serviceId, doctorId }, ctx = {}) {
  const appt = apptRepo.findById(id);
  if (!appt) throw new BookingError('NOT_FOUND', 'Appointment not found.', { status: 404 });

  const targetService = serviceId ?? appt.service_id;
  const targetDoctor = doctorId ?? appt.doctor_id;
  const tz = settingsRepo.get().timezone || 'Asia/Kolkata';

  /*
   * One IMMEDIATE transaction. The appointment's own slots are released first
   * so it can shift within its own span (10:00-11:00 -> 10:30-11:30) without
   * colliding with itself; if the new slot turns out to be taken, the throw
   * rolls everything back and the original booking survives untouched.
   */
  try {
    tx(() => {
      apptRepo.releaseSlots(id);

      const check = availability.validateSlot({
        date, time, serviceId: targetService, doctorId: targetDoctor,
      });
      if (!check.ok) throw new BookingError(check.code, 'That new time is not available.', { status: 409 });

      const slot = check.slot;
      apptRepo.moveSlots(id, {
        doctor_id: slot.doctor_id, date: slot.date,
        start_min: slot.start_min, end_min: slot.end_min,
      }, slot.interval_min);

      const svc = targetService ? servicesRepo.findById(targetService) : null;
      apptRepo.updateTiming(id, {
        doctor_id: slot.doctor_id,
        service_id: targetService ?? null,
        service_name: svc?.name ?? appt.service_name,
        date: slot.date,
        start_min: slot.start_min,
        end_min: slot.end_min,
        duration_min: slot.duration_min,
        starts_at_utc: localToUtc(slot.date, slot.start_min, tz).toISOString(),
      });

      // 'rescheduled' is a blocking status, so the moved slots stay held.
      apptRepo.setStatus(id, APPOINTMENT_STATUS.RESCHEDULED, {
        note: `Moved from ${appt.date} ${minTo12h(appt.start_min)} to ${slot.date} ${minTo12h(slot.start_min)}`,
        userId: ctx.userId,
      });
    });
  } catch (err) {
    if (err instanceof BookingError) throw err;
    if (isUniqueViolation(err)) {
      throw new BookingError('SLOT_TAKEN', 'That time was just booked. Please pick another slot.', { status: 409 });
    }
    throw err;
  }

  const updated = apptRepo.findById(id);
  audit(ctx, {
    action: 'appointment.reschedule', entity: 'appointment', entity_id: id,
    summary: `Rescheduled ${updated.ref} from ${appt.date} ${minTo12h(appt.start_min)} to ${updated.date} ${minTo12h(updated.start_min)}`,
    before: { date: appt.date, start_min: appt.start_min },
    after: { date: updated.date, start_min: updated.start_min },
  });
  events.appointmentRescheduled(updated, { previous: appt });
  return updated;
}

/** Generic status transition used by the admin status buttons. */
export function changeStatus(id, status, { note = null } = {}, ctx = {}) {
  const appt = apptRepo.findById(id);
  if (!appt) throw new BookingError('NOT_FOUND', 'Appointment not found.', { status: 404 });
  if (!Object.values(APPOINTMENT_STATUS).includes(status)) {
    throw new BookingError('INVALID_STATUS', 'Unknown status.', { status: 400 });
  }
  if (status === APPOINTMENT_STATUS.CONFIRMED) return confirm(id, ctx);
  if (status === APPOINTMENT_STATUS.CANCELLED) return cancel(id, { reason: note }, ctx);

  apptRepo.setStatus(id, status, { note, userId: ctx.userId });
  const updated = apptRepo.findById(id);
  audit(ctx, {
    action: `appointment.status.${status}`, entity: 'appointment', entity_id: id,
    summary: `${updated.ref} marked ${status.replace('_', ' ')}`,
    before: { status: appt.status }, after: { status },
  });
  if (status === APPOINTMENT_STATUS.COMPLETED) events.appointmentCompleted(updated);
  return updated;
}

/** Patient-facing view: safe subset, no internal ids or staff notes. */
export function publicView(appt) {
  if (!appt) return null;
  return {
    ref: appt.ref,
    status: appt.status,
    date: appt.date,
    date_label: formatDateLong(appt.date),
    time: minTo12h(appt.start_min),
    duration_min: appt.duration_min,
    service: appt.service_name,
    doctor: appt.doctor_name,
    patient_name: appt.patient_name,
    is_active: BLOCKING_STATUSES.includes(appt.status),
    created_at: appt.created_at,
  };
}
