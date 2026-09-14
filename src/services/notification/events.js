/**
 * Domain events -> notifications + scheduled reminder jobs.
 *
 * This is the only place that decides *who* gets told *what*. Appointment code
 * calls these; it never knows about WhatsApp, email or the job queue.
 */
import * as notifications from './index.js';
import * as notifRepo from '../../repositories/notifications.repo.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import * as jobsRepo from '../../repositories/jobs.repo.js';
import { config } from '../../config/env.js';
import { TEMPLATES } from '../../config/constants.js';
import { render } from './templates.js';
import { minTo12h, formatDateLong } from '../../utils/time.js';
import { localPhone } from '../../utils/format.js';

/** Strip the joined row down to what templates need, for stable stored payloads. */
const entityOf = (a) => ({
  ref: a.ref, date: a.date, start_min: a.start_min, status: a.status,
  service_name: a.service_name, doctor_name: a.doctor_name,
  patient_name: a.patient_name, patient_phone: a.patient_phone, patient_email: a.patient_email,
});

function bodyPreview(template, entity, extra) {
  try { return render(template, entity, settingsRepo.get(), extra).text.slice(0, 500); }
  catch { return null; }
}

function queueBoth(template, appt, { extra = {}, notifyPatient = true, notifyClinic = false, adminTemplate = null } = {}) {
  const clinic = settingsRepo.get();
  const entity = entityOf(appt);
  const payload = { entity, extra };

  if (notifyPatient && appt.patient_phone) {
    notifications.queue({
      channel: 'whatsapp', template, recipient: appt.patient_phone,
      payload, appointmentId: appt.id, recipientRole: 'patient',
      dedupeKey: `appt:${appt.id}:${template}:whatsapp`,
      bodyPreview: bodyPreview(template, entity, extra),
    });
    if (appt.patient_email) {
      notifications.queue({
        channel: 'email', template, recipient: appt.patient_email,
        payload, appointmentId: appt.id, recipientRole: 'patient',
        dedupeKey: `appt:${appt.id}:${template}:email`,
        bodyPreview: bodyPreview(template, entity, extra),
      });
    }
  }

  if (notifyClinic && adminTemplate && clinic.whatsapp) {
    notifications.queue({
      channel: 'whatsapp', template: adminTemplate, recipient: clinic.whatsapp,
      payload, appointmentId: appt.id, recipientRole: 'clinic',
      dedupeKey: `appt:${appt.id}:${adminTemplate}:whatsapp`,
      bodyPreview: bodyPreview(adminTemplate, entity, extra),
    });
  }
}

export function appointmentCreated(appt) {
  queueBoth(TEMPLATES.BOOKING_RECEIVED, appt, {
    notifyPatient: true, notifyClinic: true, adminTemplate: TEMPLATES.NEW_APPOINTMENT_ADMIN,
  });

  notifRepo.pushAdmin({
    type: 'appointment.new',
    title: 'New appointment received',
    body: `${appt.patient_name} · ${localPhone(appt.patient_phone)} · ${appt.service_name} · ${formatDateLong(appt.date)} ${minTo12h(appt.start_min)}`,
    link: `/admin/appointments/${appt.id}`,
    severity: 'info',
  });

  scheduleReminders(appt);
}

export function appointmentConfirmed(appt) {
  queueBoth(TEMPLATES.APPOINTMENT_CONFIRMED, appt);
  scheduleReminders(appt);
}

export function appointmentRescheduled(appt, { previous } = {}) {
  queueBoth(TEMPLATES.RESCHEDULED, appt, {
    extra: { previous: previous ? { date: previous.date, start_min: previous.start_min } : null },
  });
  notifRepo.pushAdmin({
    type: 'appointment.rescheduled',
    title: 'Appointment rescheduled',
    body: `${appt.ref} → ${formatDateLong(appt.date)} ${minTo12h(appt.start_min)}`,
    link: `/admin/appointments/${appt.id}`, severity: 'warning',
  });
  scheduleReminders(appt);   // new dedupe keys include the new time
}

export function appointmentCancelled(appt, { notifyPatient = true, reason = null } = {}) {
  queueBoth(TEMPLATES.CANCELLED, appt, {
    extra: { reason }, notifyPatient,
    notifyClinic: true, adminTemplate: TEMPLATES.CANCELLED_ADMIN,
  });
  notifRepo.pushAdmin({
    type: 'appointment.cancelled',
    title: 'Appointment cancelled',
    body: `${appt.ref} — ${appt.patient_name}${reason ? ` (${reason})` : ''}`,
    link: `/admin/appointments/${appt.id}`, severity: 'warning',
  });
}

export function appointmentCompleted(appt) {
  // Follow-up two days after the visit.
  jobsRepo.enqueue({
    kind: 'follow_up',
    payload: { appointmentId: appt.id },
    runAt: new Date(Date.now() + 2 * 86400000),
    dedupeKey: `followup:${appt.id}`,
  });
}

export function enquiryCreated(enquiry) {
  const clinic = settingsRepo.get();
  if (clinic.whatsapp) {
    notifications.queue({
      channel: 'whatsapp', template: TEMPLATES.NEW_ENQUIRY_ADMIN, recipient: clinic.whatsapp,
      payload: { entity: enquiry }, enquiryId: enquiry.id, recipientRole: 'clinic',
      dedupeKey: `enquiry:${enquiry.id}:admin:whatsapp`,
      bodyPreview: bodyPreview(TEMPLATES.NEW_ENQUIRY_ADMIN, enquiry, {}),
    });
  }
  notifRepo.pushAdmin({
    type: 'enquiry.new', title: 'New enquiry',
    body: `${enquiry.name} · ${localPhone(enquiry.phone)}`,
    link: '/admin/enquiries', severity: 'info',
  });
}

/**
 * Schedule reminder jobs. Dedupe keys embed the appointment time, so a
 * rescheduled appointment gets fresh reminders while a re-run of the scheduler
 * never double-sends.
 */
export function scheduleReminders(appt) {
  const startsAt = new Date(appt.starts_at_utc).getTime();
  if (!Number.isFinite(startsAt)) return;
  const stamp = `${appt.date}T${appt.start_min}`;

  if (config.jobs.reminder24h) {
    const at = startsAt - 24 * 3600000;
    if (at > Date.now()) {
      jobsRepo.enqueue({
        kind: 'reminder', payload: { appointmentId: appt.id, template: TEMPLATES.REMINDER_24H },
        runAt: new Date(at), dedupeKey: `reminder24:${appt.id}:${stamp}`,
      });
    }
  }
  if (config.jobs.reminder2h) {
    const at = startsAt - 2 * 3600000;
    if (at > Date.now()) {
      jobsRepo.enqueue({
        kind: 'reminder', payload: { appointmentId: appt.id, template: TEMPLATES.REMINDER_2H },
        runAt: new Date(at), dedupeKey: `reminder2:${appt.id}:${stamp}`,
      });
    }
  }
}
