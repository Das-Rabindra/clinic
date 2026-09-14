import { one, all, run, buildUpdate, nextSeq } from './base.js';

const FIELDS = ['name', 'email', 'dob', 'gender', 'notes', 'is_blocked'];

export const findById = (id) => one('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL', id);
export const findByPhone = (phone) =>
  one('SELECT * FROM patients WHERE phone = ? AND deleted_at IS NULL', phone);

/**
 * One patient per phone number. Called inside the booking transaction, so the
 * INSERT and the appointment INSERT commit together.
 */
export function upsertByPhone({ name, phone, email, createdBy = null }) {
  const existing = findByPhone(phone);
  if (existing) {
    // Keep the record fresh without letting a booking blank out known details.
    run(`UPDATE patients SET name = COALESCE(NULLIF(?, ''), name),
         email = COALESCE(NULLIF(?, ''), email), updated_at = datetime('now') WHERE id = ?`,
      name || '', email || '', existing.id);
    return { patient: findById(existing.id), created: false };
  }
  const code = nextSeq('patients', 'code', 'SDC-P-', 5);
  const info = run(
    `INSERT INTO patients (code, name, phone, email, created_by) VALUES (?, ?, ?, ?, ?)`,
    code, name, phone, email || null, createdBy
  );
  return { patient: findById(info.lastInsertRowid), created: true };
}

export function create(p) {
  const code = nextSeq('patients', 'code', 'SDC-P-', 5);
  const info = run(
    `INSERT INTO patients (code, name, phone, email, dob, gender, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    code, p.name, p.phone, p.email ?? null, p.dob ?? null, p.gender ?? null,
    p.notes ?? null, p.created_by ?? null
  );
  return findById(info.lastInsertRowid);
}

export const update = (id, fields) => buildUpdate('patients', id, fields, FIELDS);
export const softDelete = (id) =>
  run(`UPDATE patients SET deleted_at = datetime('now') WHERE id = ?`, id).changes;

/** Search by name, phone or patient code. */
export function search({ q = '', limit = 50, offset = 0 } = {}) {
  const term = `%${String(q).trim()}%`;
  const digits = String(q).replace(/\D/g, '');
  const phoneTerm = digits ? `%${digits}%` : ' no-match';
  const rows = all(
    `SELECT p.*,
       (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.deleted_at IS NULL) AS appointment_count,
       (SELECT MAX(a.date) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_visit,
       (SELECT MIN(a.date) FROM appointments a WHERE a.patient_id = p.id
          AND a.date >= date('now') AND a.status IN ('pending','confirmed','rescheduled')) AS next_visit
     FROM patients p
     WHERE p.deleted_at IS NULL
       AND (? = '' OR p.name LIKE ? OR p.phone LIKE ? OR p.code LIKE ?)
     ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
    String(q).trim(), term, phoneTerm, term, limit, offset
  );
  const total = one(
    `SELECT COUNT(*) AS c FROM patients p WHERE p.deleted_at IS NULL
       AND (? = '' OR p.name LIKE ? OR p.phone LIKE ? OR p.code LIKE ?)`,
    String(q).trim(), term, phoneTerm, term
  ).c;
  return { rows, total };
}

export const count = () => one('SELECT COUNT(*) AS c FROM patients WHERE deleted_at IS NULL').c;
