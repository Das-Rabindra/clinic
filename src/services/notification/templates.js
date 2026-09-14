/**
 * Message bodies. Kept in one place so wording can change without touching
 * delivery code, and so the same content can render into WhatsApp text, an
 * email body, or a Cloud API template's variable list.
 */
import { formatDateLong, minTo12h } from '../../utils/time.js';
import { localPhone } from '../../utils/format.js';

const when = (a) => `${formatDateLong(a.date)} at ${minTo12h(a.start_min)}`;

/**
 * Each template returns { subject, text, vars }.
 * `vars` is the ordered variable list for a WhatsApp pre-approved template.
 */
export const templates = {
  booking_received: (a, c) => ({
    subject: `Appointment request received — ${a.ref}`,
    text: `Hello ${a.patient_name}, your appointment request at ${c.name} has been received.
Booking ID: ${a.ref}
Treatment: ${a.service_name}
When: ${when(a)}
We will confirm shortly. To change or cancel, call ${c.phone}.`,
    vars: [a.patient_name, c.name, a.ref, a.service_name, when(a)],
  }),

  appointment_confirmed: (a, c) => ({
    subject: `Appointment confirmed — ${a.ref}`,
    text: `Hello ${a.patient_name}, your appointment with ${c.name} is confirmed.
Booking ID: ${a.ref}
Treatment: ${a.service_name}
When: ${when(a)}
Dentist: ${a.doctor_name}
Please arrive 5-10 minutes early. To reschedule, call ${c.phone}.`,
    vars: [a.patient_name, c.name, a.ref, a.service_name, when(a)],
  }),

  reminder_24h: (a, c) => ({
    subject: `Reminder: appointment tomorrow — ${a.ref}`,
    text: `Reminder from ${c.name}: you have an appointment tomorrow.
Treatment: ${a.service_name}
When: ${when(a)}
Booking ID: ${a.ref}
If you cannot attend, please let us know on ${c.phone}.`,
    vars: [a.patient_name, c.name, a.service_name, when(a), a.ref],
  }),

  reminder_2h: (a, c) => ({
    subject: `Appointment in 2 hours — ${a.ref}`,
    text: `${c.name}: your appointment is in about 2 hours, at ${minTo12h(a.start_min)} today.
Treatment: ${a.service_name}
Booking ID: ${a.ref}`,
    vars: [a.patient_name, c.name, minTo12h(a.start_min), a.service_name],
  }),

  rescheduled: (a, c, extra = {}) => ({
    subject: `Appointment rescheduled — ${a.ref}`,
    text: `Hello ${a.patient_name}, your appointment at ${c.name} has been rescheduled.
${extra.previous ? `Previously: ${formatDateLong(extra.previous.date)} at ${minTo12h(extra.previous.start_min)}\n` : ''}Now: ${when(a)}
Treatment: ${a.service_name}
Booking ID: ${a.ref}`,
    vars: [a.patient_name, c.name, when(a), a.ref],
  }),

  cancelled: (a, c, extra = {}) => ({
    subject: `Appointment cancelled — ${a.ref}`,
    text: `Hello ${a.patient_name}, your appointment at ${c.name} on ${when(a)} has been cancelled.${extra.reason ? `\nReason: ${extra.reason}` : ''}
To book again, call ${c.phone} or visit the website.`,
    vars: [a.patient_name, c.name, when(a)],
  }),

  follow_up: (a, c) => ({
    subject: `Thank you for visiting ${c.name}`,
    text: `Hello ${a.patient_name}, thank you for visiting ${c.name}.
If you have any questions after your ${a.service_name}, call ${c.phone}.
We hope to see you at your next check-up.`,
    vars: [a.patient_name, c.name, a.service_name],
  }),

  /* Clinic-facing */
  new_appointment_admin: (a, c) => ({
    subject: `New appointment — ${a.ref}`,
    text: `New appointment received
Patient: ${a.patient_name}
Mobile: ${localPhone(a.patient_phone)}
Service: ${a.service_name}
Date: ${formatDateLong(a.date)}
Time: ${minTo12h(a.start_min)}
Status: ${a.status}
Ref: ${a.ref}`,
    vars: [a.patient_name, localPhone(a.patient_phone), a.service_name, when(a), a.status],
  }),

  cancelled_admin: (a, c, extra = {}) => ({
    subject: `Appointment cancelled — ${a.ref}`,
    text: `Appointment cancelled
Patient: ${a.patient_name} (${localPhone(a.patient_phone)})
Service: ${a.service_name}
Was: ${when(a)}${extra.reason ? `\nReason: ${extra.reason}` : ''}
Ref: ${a.ref}`,
    vars: [a.patient_name, localPhone(a.patient_phone), when(a)],
  }),

  new_enquiry_admin: (e, c) => ({
    subject: 'New website enquiry',
    text: `New enquiry from the website
Name: ${e.name}
Phone: ${localPhone(e.phone)}
Prefers: ${e.preferred_contact}
Message: ${e.message || '(none)'}`,
    vars: [e.name, localPhone(e.phone), e.message || '-'],
  }),
};

export async function render(template, entity, clinic, extra = {}) {
  const fn = templates[template];
  if (!fn) throw new Error(`Unknown notification template: ${template}`);
  return fn(entity, clinic, extra);
}
