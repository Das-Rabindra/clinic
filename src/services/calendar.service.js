/** ICS generation for the "Add to Calendar" action. No third-party service. */
import { localToUtc, formatDateLong, minTo12h } from '../utils/time.js';
import * as settingsRepo from '../repositories/settings.repo.js';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545: escape , ; \ and newlines in text values. */
const escapeIcs = (s) => String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
/** RFC 5545: fold lines at 75 octets. */
const fold = (line) => line.match(/.{1,73}/g)?.join('\r\n ') ?? line;

export async function appointmentIcs(appt) {
  const s = await settingsRepo.get();
  const tz = s.timezone || 'Asia/Kolkata';
  const start = localToUtc(appt.date, appt.start_min, tz);
  const end = localToUtc(appt.date, appt.end_min, tz);
  const address = [s.address_line1, s.address_line2, s.area, s.city, s.state, s.postal_code]
    .filter(Boolean).join(', ');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Samal Dental Care//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appt.ref}@samal-dental-care`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    fold(`SUMMARY:${escapeIcs(`${appt.service_name} — ${s.name}`)}`),
    fold(`DESCRIPTION:${escapeIcs(
      `Booking ID: ${appt.ref}\nTreatment: ${appt.service_name}\nDentist: ${appt.doctor_name}\n` +
      `When: ${formatDateLong(appt.date)} at ${minTo12h(appt.start_min)}\nPhone: ${s.phone || ''}`
    )}`),
    fold(`LOCATION:${escapeIcs(address)}`),
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    fold(`DESCRIPTION:${escapeIcs(`Appointment at ${s.name} in 2 hours`)}`),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
