import { one, all, run, nextSeq } from './base.js';
import { BLOCKING_STATUSES } from '../config/constants.js';

const BASE = `SELECT a.*, p.name AS patient_name, p.phone AS patient_phone,
    p.email AS patient_email, p.code AS patient_code,
    d.name AS doctor_name, s.name AS service_title
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN services s ON s.id = a.service_id`;

export const findById = async (id) => await one(`${BASE} WHERE a.id = ? AND a.deleted_at IS NULL`, id);
export const findByRef = async (ref) => await one(`${BASE} WHERE a.ref = ? AND a.deleted_at IS NULL`, ref);

export const nextRef = async () =>
  await nextSeq('appointment_ref_seq', `SDC-${new Date().getFullYear()}-`, 5);

/** Slot minutes an appointment occupies, given the grid interval. */
export function slotMinutes(startMin, endMin, interval) {
  const out = [];
  for (let m = startMin; m < endMin; m += interval) out.push(m);
  return out;
}

/**
 * Insert appointment + its slot rows. MUST be called inside an IMMEDIATE
 * transaction. A collision raises SQLITE_CONSTRAINT_UNIQUE on
 * appointment_slots(doctor_id, date, slot_min) - that is the double-booking
 * guarantee, enforced by the database rather than by a prior SELECT.
 */
export async function insertWithSlots(appt, interval) {
  const ref = appt.ref || await nextRef();
  const info = await run(
    `INSERT INTO appointments (ref, patient_id, doctor_id, service_id, service_name,
       date, start_min, end_min, duration_min, starts_at_utc, status, source, reason,
       message, is_new_patient, created_by, rescheduled_from_id)
     VALUES (@ref, @patient_id, @doctor_id, @service_id, @service_name,
       @date, @start_min, @end_min, @duration_min, @starts_at_utc, @status, @source, @reason,
       @message, @is_new_patient, @created_by, @rescheduled_from_id)`,
    {
      ref,
      patient_id: appt.patient_id, doctor_id: appt.doctor_id,
      service_id: appt.service_id ?? null, service_name: appt.service_name ?? null,
      date: appt.date, start_min: appt.start_min, end_min: appt.end_min,
      duration_min: appt.duration_min, starts_at_utc: appt.starts_at_utc,
      status: appt.status || 'pending', source: appt.source || 'website',
      reason: appt.reason ?? null, message: appt.message ?? null,
      is_new_patient: appt.is_new_patient ? 1 : 0,
      created_by: appt.created_by ?? null,
      rescheduled_from_id: appt.rescheduled_from_id ?? null,
    }
  );
  const id = Number(info.lastInsertRowid);
  // UNIQUE(doctor_id, date, slot_min) raises here if any slot is already taken.
  await insertSlots(id, appt.doctor_id, appt.date,
    slotMinutes(appt.start_min, appt.end_min, interval));
  return id;
}

/** Insert every slot an appointment occupies in a single statement. */
async function insertSlots(appointmentId, doctorId, date, minutes) {
  if (!minutes.length) return;
  const values = minutes.map((_, i) => `($1, $2, $3, $${i + 4})`).join(', ');
  await run(
    `INSERT INTO appointment_slots (appointment_id, doctor_id, date, slot_min) VALUES ${values}`,
    appointmentId, doctorId, date, ...minutes
  );
}

export const releaseSlots = async (appointmentId) =>
  (await run('DELETE FROM appointment_slots WHERE appointment_id = ?', appointmentId)).changes;

/** Move an existing appointment's slots. Also inside an IMMEDIATE transaction. */
export async function moveSlots(appointmentId, { doctor_id, date, start_min, end_min }, interval) {
  await releaseSlots(appointmentId);
  await insertSlots(appointmentId, doctor_id, date, slotMinutes(start_min, end_min, interval));
}

/** Occupied slot minutes for a doctor on a date - the availability engine's input. */
export const occupiedSlots = async (doctorId, date) =>
  (await all('SELECT slot_min FROM appointment_slots WHERE doctor_id = ? AND date = ?', doctorId, date))
    .map(r => r.slot_min);

export async function setStatus(id, status, { note = null, userId = null } = {}) {
  const current = await one('SELECT status FROM appointments WHERE id = ?', id);
  if (!current) return null;
  const stamp = {
    confirmed: 'confirmed_at', completed: 'completed_at', cancelled: 'cancelled_at',
  }[status];
  await run(
    `UPDATE appointments SET status = ?, updated_at = NOW()
     ${stamp ? `, ${stamp} = NOW()` : ''} WHERE id = ?`, status, id
  );
  await run(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, note, changed_by)
     VALUES (?, ?, ?, ?, ?)`, id, current.status, status, note, userId
  );
  // Cancelled / no-show free the slot for other patients.
  if (!BLOCKING_STATUSES.includes(status)) await releaseSlots(id);
  return current.status;
}

export const setCancelReason = async (id, reason) =>
  await run('UPDATE appointments SET cancel_reason = ? WHERE id = ?', reason, id);

export const history = async (id) =>
  await all(`SELECT h.*, u.name AS by_name FROM appointment_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.appointment_id = ? ORDER BY h.id`, id);

export const forPatient = async (patientId) =>
  await all(`${BASE} WHERE a.patient_id = ? AND a.deleted_at IS NULL ORDER BY a.date DESC, a.start_min DESC`,
    patientId);

/** Admin list with filters + pagination. All values are bound parameters. */
export async function search({ from, to, status, doctorId, serviceId, q, limit = 50, offset = 0 } = {}) {
  const where = ['a.deleted_at IS NULL'];
  const p = {};
  if (from) { where.push('a.date >= @from'); p.from = from; }
  if (to) { where.push('a.date <= @to'); p.to = to; }
  if (status) { where.push('a.status = @status'); p.status = status; }
  if (doctorId) { where.push('a.doctor_id = @doctorId'); p.doctorId = doctorId; }
  if (serviceId) { where.push('a.service_id = @serviceId'); p.serviceId = serviceId; }
  if (q) { where.push('(p.name LIKE @q OR p.phone LIKE @q OR a.ref LIKE @q)'); p.q = `%${q}%`; }
  const w = where.join(' AND ');
  const rows = await all(
    `${BASE} WHERE ${w} ORDER BY a.date DESC, a.start_min DESC LIMIT @limit OFFSET @offset`,
    { ...p, limit, offset }
  );
  const total = (await one(
    `SELECT COUNT(*)::int AS c FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE ${w}`,
    p
  )).c;
  return { rows, total };
}

export const onDate = async (date) =>
  await all(`${BASE} WHERE a.date = ? AND a.deleted_at IS NULL ORDER BY a.start_min`, date);

export const between = async (from, to, doctorId) =>
  await all(`${BASE} WHERE a.date BETWEEN ? AND ? AND a.deleted_at IS NULL
       AND (?::int IS NULL OR a.doctor_id = ?) ORDER BY a.date, a.start_min`,
    from, to, doctorId ?? null, doctorId ?? null);

/** Appointments needing a reminder in a UTC window - driven by starts_at_utc. */
export const dueForReminder = async (fromIso, toIso) =>
  await all(`${BASE} WHERE a.starts_at_utc BETWEEN ? AND ?
       AND a.status IN ('pending','confirmed','rescheduled') AND a.deleted_at IS NULL`,
    fromIso, toIso);

export const softDelete = async (id) =>
  (await run(`UPDATE appointments SET deleted_at = NOW() WHERE id = ?`, id)).changes;

/* Dashboard aggregates */
export const statusCounts = async (from, to) =>
  await all(`SELECT status, COUNT(*) AS c FROM appointments
       WHERE deleted_at IS NULL AND (?::text IS NULL OR date >= ?) AND (?::text IS NULL OR date <= ?)
       GROUP BY status`, from ?? null, from ?? null, to ?? null, to ?? null);

export const upcoming = async (fromDate, limit = 10) =>
  await all(`${BASE} WHERE a.date >= ? AND a.deleted_at IS NULL
       AND a.status IN ('pending','confirmed','rescheduled','checked_in')
       ORDER BY a.date, a.start_min LIMIT ?`, fromDate, limit);

export const pendingCount = async () =>
  (await one(`SELECT COUNT(*) AS c FROM appointments WHERE status = 'pending' AND deleted_at IS NULL`)).c;

/** Move an appointment to a new time/doctor/service. Caller supplies new slots. */
export const updateTiming = async (id, t) => (await run(
  `UPDATE appointments SET doctor_id = @doctor_id, service_id = @service_id,
     service_name = @service_name, date = @date, start_min = @start_min, end_min = @end_min,
     duration_min = @duration_min, starts_at_utc = @starts_at_utc, updated_at = NOW()
   WHERE id = @id`,
  { ...t, id }
)).changes;
