/**
 * Reminder + follow-up jobs. These only *enqueue* notifications; delivery is
 * the NotificationService's job, so a provider outage retries independently.
 */
import * as apptRepo from '../../repositories/appointments.repo.js';
import * as notifications from '../../services/notification/index.js';
import { render } from '../../services/notification/templates.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import { TEMPLATES, BLOCKING_STATUSES } from '../../config/constants.js';

const entityOf = (a) => ({
  ref: a.ref, date: a.date, start_min: a.start_min, status: a.status,
  service_name: a.service_name, doctor_name: a.doctor_name,
  patient_name: a.patient_name, patient_phone: a.patient_phone, patient_email: a.patient_email,
});

async function preview(template, entity) {
  try { return render(template, entity, await settingsRepo.get(), {}).text.slice(0, 500); }
  catch { return null; }
}

export async function reminder({ appointmentId, template }) {
  const appt = await apptRepo.findById(appointmentId);
  // Cancelled or already-past appointments must not generate reminders.
  if (!appt || !BLOCKING_STATUSES.includes(appt.status)) return;
  if (new Date(appt.starts_at_utc) < new Date()) return;

  const entity = entityOf(appt);
  const stamp = `${appt.date}T${appt.start_min}`;

  notifications.queue({
    channel: 'whatsapp', template, recipient: appt.patient_phone,
    payload: { entity }, appointmentId: appt.id,
    dedupeKey: `appt:${appt.id}:${template}:${stamp}:whatsapp`,
    bodyPreview: preview(template, entity),
  });
  if (appt.patient_email) {
    notifications.queue({
      channel: 'email', template, recipient: appt.patient_email,
      payload: { entity }, appointmentId: appt.id,
      dedupeKey: `appt:${appt.id}:${template}:${stamp}:email`,
      bodyPreview: preview(template, entity),
    });
  }
}

export async function followUp({ appointmentId }) {
  const appt = await apptRepo.findById(appointmentId);
  if (!appt || appt.status !== 'completed') return;
  const entity = entityOf(appt);
  notifications.queue({
    channel: 'whatsapp', template: TEMPLATES.FOLLOW_UP, recipient: appt.patient_phone,
    payload: { entity }, appointmentId: appt.id,
    dedupeKey: `appt:${appt.id}:follow_up:whatsapp`,
    bodyPreview: preview(TEMPLATES.FOLLOW_UP, entity),
  });
}
