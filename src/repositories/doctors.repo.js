import { one, all, run, buildUpdate } from './base.js';
import { slugify } from '../utils/format.js';

const FIELDS = ['name','qualification','registration','specialization','bio','experience_years',
  'languages','consultation_fee','currency','slot_interval_min','is_active','display_order',
  'photo_media_id'];

const WITH_PHOTO = `SELECT d.*, m.url AS photo_url FROM doctors d
  LEFT JOIN media m ON m.id = d.photo_media_id`;

export const list = ({ activeOnly = false } = {}) =>
  all(`${WITH_PHOTO} WHERE d.deleted_at IS NULL ${activeOnly ? 'AND d.is_active = 1' : ''}
       ORDER BY d.display_order, d.id`);

export const findById = (id) => one(`${WITH_PHOTO} WHERE d.id = ? AND d.deleted_at IS NULL`, id);
export const findBySlug = (slug) => one(`${WITH_PHOTO} WHERE d.slug = ? AND d.deleted_at IS NULL`, slug);

/** The clinic currently has one dentist; this is the booking default. */
export const primary = () =>
  one(`${WITH_PHOTO} WHERE d.deleted_at IS NULL AND d.is_active = 1
       ORDER BY d.display_order, d.id LIMIT 1`);

export function create(d) {
  let slug = slugify(d.name), n = 1;
  while (one('SELECT id FROM doctors WHERE slug = ?', slug)) slug = `${slugify(d.name)}-${++n}`;
  const info = run(
    `INSERT INTO doctors (name, slug, qualification, registration, specialization, bio,
       experience_years, languages, consultation_fee, slot_interval_min, is_active, display_order, photo_media_id)
     VALUES (@name, @slug, @qualification, @registration, @specialization, @bio,
       @experience_years, @languages, @consultation_fee, @slot_interval_min, @is_active, @display_order, @photo_media_id)`,
    {
      name: d.name, slug,
      qualification: d.qualification ?? null, registration: d.registration ?? null,
      specialization: d.specialization ?? null, bio: d.bio ?? null,
      experience_years: d.experience_years ?? null, languages: d.languages ?? null,
      consultation_fee: d.consultation_fee ?? null, slot_interval_min: d.slot_interval_min ?? null,
      is_active: d.is_active === false ? 0 : 1, display_order: d.display_order ?? 0,
      photo_media_id: d.photo_media_id ?? null,
    }
  );
  return findById(info.lastInsertRowid);
}

export const update = (id, fields) => buildUpdate('doctors', id, fields, FIELDS);
export const softDelete = (id) =>
  run(`UPDATE doctors SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?`, id).changes;

/* ── Weekly schedule ── */
export const schedule = (doctorId) =>
  all('SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY weekday', doctorId);

export const scheduleFor = (doctorId, weekday) =>
  one('SELECT * FROM doctor_schedules WHERE doctor_id = ? AND weekday = ?', doctorId, weekday);

export function upsertSchedule(doctorId, weekday, s) {
  run(
    `INSERT INTO doctor_schedules (doctor_id, weekday, is_open, open_min, close_min, break_start_min, break_end_min)
     VALUES (@doctor_id, @weekday, @is_open, @open_min, @close_min, @break_start_min, @break_end_min)
     ON CONFLICT(doctor_id, weekday) DO UPDATE SET
       is_open = excluded.is_open, open_min = excluded.open_min, close_min = excluded.close_min,
       break_start_min = excluded.break_start_min, break_end_min = excluded.break_end_min,
       updated_at = datetime('now')`,
    {
      doctor_id: doctorId, weekday,
      is_open: s.is_open ? 1 : 0, open_min: s.open_min, close_min: s.close_min,
      break_start_min: s.break_start_min ?? null, break_end_min: s.break_end_min ?? null,
    }
  );
}
export const clearSchedule = (doctorId, weekday) =>
  run('DELETE FROM doctor_schedules WHERE doctor_id = ? AND weekday = ?', doctorId, weekday).changes;
