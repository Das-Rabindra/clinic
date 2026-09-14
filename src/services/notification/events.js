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

async function bodyPreview(template, entity, extra) {
  try { return render(template, entity, await settingsRepo.get(), extra).text.slice(0, 500); }
  catch { return null; }
}

async function queueBoth(template, appt, { extra = {}, notifyPatient = true, notifyClinic = false, adminTemplate = null } = {}) {
  const clinic = await settingsRepo.get();
  const entity = entityOf(appt);
  const payload = { entity, extra };

  if (notifyPatient && appt.patient_phone) {
    await notifications.queue({
      channel: 'whatsapp', template, recipient: appt.patient_phone,
      payload, appointmentId: appt.id, recipientRole: 'patient',
      dedupeKey: `appt:${appt.id}:${template}:whatsapp`,
      bodyPreview: await bodyPreview(template, entity, extra),
    });
    if (appt.patient_email) {
      await notifications.queue({
        channel: 'email', template, recipient: appt.patient_email,
        payload, appointmentId: appt.id, recipientRole: 'patient',
        dedupeKey: `appt:${appt.id}:${template}:email`,
        bodyPreview: await bodyPreview(template, entity, extra),
      });
    }
  }

  if (notifyClinic && adminTemplate && clinic.whatsapp) {
    await notifications.queue({
      channel: 'whatsapp', template: adminTemplate, recipient: clinic.whatsapp,
      payload, appointmentId: appt.id, recipientRole: 'clinic',
      dedupeKey: `appt:${appt.id}:${adminTemplate}:whatsapp`,
      bodyPreview: await bodyPreview(adminTemplate, entity, extra),
    });
  }
}

export async function appointmentCreated(appt) {
  await queueBoth(TEMPLATES.BOOKING_RECEIVED, appt, {
    notifyPatient: true, notifyClinic: true, adminTemplate: TEMPLATES.NEW_APPOINTMENT_ADMIN,
  });

  await notifRepo.pushAdmin({
    type: 'appointment.new',
    title: 'New appointment received',
    body: `${appt.patient_name} · ${localPhone(appt.patient_phone)} · ${appt.service_name} · ${formatDateLong(appt.date)} ${minTo12h(appt.start_min)}`,
    link: `/admin/appointments/${appt.id}`,
    severity: 'info',
  });

  await scheduleReminders(appt);
}

export async function appointmentConfirmed(appt) {
  await queueBoth(TEMPLATES.APPOINTMENT_CONFIRMED, appt);
  await scheduleReminders(appt);
}

export async function appointmentRescheduled(appt, { previous } = {}) {
  await queueBoth(TEMPLATES.RESCHEDULED, appt, {
    extra: { previous: previous ? { date: previous.date, start_min: previous.start_min } : null },
  });
  await notifRepo.pushAdmin({
    type: 'appointment.rescheduled',
    title: 'Appointment rescheduled',
    body: `${appt.ref} → ${formatDateLong(appt.date)} ${minTo12h(appt.start_min)}`,
    link: `/admin/appointments/${appt.id}`, severity: 'warning',
  });
  await scheduleReminders(appt);   // new dedupe keys include the new time
}

export async function appointmentCancelled(appt, { notifyPatient = true, reason = null } = {}) {
  await queueBoth(TEMPLATES.CANCELLED, appt, {
    extra: { reason }, notifyPatient,
    notifyClinic: true, adminTemplate: TEMPLATES.CANCELLED_ADMIN,
  });
  await notifRepo.pushAdmin({
    type: 'appointment.cancelled',
    title: 'Appointment cancelled',
    body: `${appt.ref} — ${appt.patient_name}${reason ? ` (${reason})` : ''}`,
    link: `/admin/appointments/${appt.id}`, severity: 'warning',
  });
}

export async function appointmentCompleted(appt) {
  // Follow-up two days after the visit.
  await jobsRepo.enqueue({
    kind: 'follow_up',
    payload: { appointmentId: appt.id },
    runAt: new Date(Date.now() + 2 * 86400000),
    dedupeKey: `followup:${appt.id}`,
  });
}

export async function enquiryCreated(enquiry) {
  const clinic = await settingsRepo.get();
  if (clinic.whatsapp) {
    await notifications.queue({
      channel: 'whatsapp', template: TEMPLATES.NEW_ENQUIRY_ADMIN, recipient: clinic.whatsapp,
      payload: { entity: enquiry }, enquiryId: enquiry.id, recipientRole: 'clinic',
      dedupeKey: `enquiry:${enquiry.id}:admin:whatsapp`,
      bodyPreview: await bodyPreview(TEMPLATES.NEW_ENQUIRY_ADMIN, enquiry, {}),
    });
  }
  await notifRepo.pushAdmin({
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
export async function scheduleReminders(appt) {
  const startsAt = new Date(appt.starts_at_utc).getTime();
  if (!Number.isFinite(startsAt)) return;
  const stamp = `${appt.date}T${appt.start_min}`;

  if (config.jobs.reminder24h) {
    const at = startsAt - 24 * 3600000;
    if (at > Date.now()) {
      await jobsRepo.enqueue({
        kind: 'reminder', payload: { appointmentId: appt.id, template: TEMPLATES.REMINDER_24H },
        runAt: new Date(at), dedupeKey: `reminder24:${appt.id}:${stamp}`,
      });
    }
  }
  if (config.jobs.reminder2h) {
    const at = startsAt - 2 * 3600000;
    if (at > Date.now()) {
      await jobsRepo.enqueue({
        kind: 'reminder', payload: { appointmentId: appt.id, template: TEMPLATES.REMINDER_2H },
        runAt: new Date(at), dedupeKey: `reminder2:${appt.id}:${stamp}`,
      });
    }
  }
}
