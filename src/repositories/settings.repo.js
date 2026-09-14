import { one, all, run, buildUpdate } from './base.js';

const FIELDS = [
  'name','doctor_name','qualification','registration','institution','tagline','description',
  'phone','phone_intl','whatsapp','email','site_url',
  'address_line1','address_line2','area','city','state','postal_code','country',
  'maps_url','place_id','latitude','longitude','timezone',
  'slot_interval_min','booking_lead_hours','booking_horizon_days','auto_confirm',
  'reviews_url','instagram_url','facebook_url',
  'logo_media_id','favicon_media_id','og_image_media_id','hero_media_id',
  'seo_title','seo_description','seo_canonical','og_title','og_description',
  'hero_eyebrow','hero_title','hero_lede','hero_cta_label','hero_trust_text',
  'about_title','about_body','story_title','story_body',
  'services_title','services_lede','gallery_title','gallery_lede',
  'reviews_title','cta_title','cta_body',
];
export const SETTINGS_FIELDS = FIELDS;

export const get = async () => await one('SELECT * FROM clinic_settings WHERE id = 1');
export const update = async (fields) => await buildUpdate('clinic_settings', 1, fields, FIELDS);

/** Composed one-line address, skipping blank parts. */
/** Composed one-line address, skipping blank parts. */
export async function fullAddress(settings = null) {
  // The default cannot be `await get()`: as an async call it would resolve to a
  // Promise inside the parameter list rather than the settings row.
  const s = settings ?? await get();
  return [s.address_line1, s.address_line2, s.area, s.city, s.state, s.postal_code]
    .map(v => (v || '').trim()).filter(Boolean).join(', ');
}

/* ── Weekly hours ── */
export const getHours = async () => await all('SELECT * FROM clinic_hours ORDER BY weekday');
export const getHoursFor = async (weekday) => await one('SELECT * FROM clinic_hours WHERE weekday = ?', weekday);

export async function upsertHours(weekday, h) {
  await run(
    `INSERT INTO clinic_hours (weekday, is_open, open_min, close_min, break_start_min, break_end_min)
     VALUES (@weekday, @is_open, @open_min, @close_min, @break_start_min, @break_end_min)
     ON CONFLICT(weekday) DO UPDATE SET
       is_open = excluded.is_open, open_min = excluded.open_min, close_min = excluded.close_min,
       break_start_min = excluded.break_start_min, break_end_min = excluded.break_end_min,
       updated_at = NOW()`,
    {
      weekday,
      is_open: h.is_open ? 1 : 0,
      open_min: h.open_min, close_min: h.close_min,
      break_start_min: h.break_start_min ?? null, break_end_min: h.break_end_min ?? null,
    }
  );
}

/* ── Holidays / temporary closures ── */
export const listHolidays = async (from) =>
  await all(`SELECT h.*, d.name AS doctor_name FROM holidays h
       LEFT JOIN doctors d ON d.id = h.doctor_id
       WHERE (?::text IS NULL OR COALESCE(h.end_date, h.date) >= ?)
       ORDER BY h.date`, from ?? null, from ?? null);

/** Holidays covering a date, for the clinic or a specific doctor. */
export const holidaysOn = async (date, doctorId) =>
  await all(`SELECT * FROM holidays
       WHERE date <= ? AND COALESCE(end_date, date) >= ?
         AND (doctor_id IS NULL OR doctor_id = ?)`, date, date, doctorId ?? -1);

export const addHoliday = async (h) => (await run(
  `INSERT INTO holidays (doctor_id, date, end_date, reason, is_full_day, start_min, end_min, created_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  h.doctor_id ?? null, h.date, h.end_date ?? null, h.reason ?? null,
  h.is_full_day === false ? 0 : 1, h.start_min ?? null, h.end_min ?? null, h.created_by ?? null
)).lastInsertRowid;

export const deleteHoliday = async (id) => (await run('DELETE FROM holidays WHERE id = ?', id)).changes;

/* ── Ad-hoc blocked slots ── */
export const listBlocked = async (from) =>
  await all(`SELECT b.*, d.name AS doctor_name FROM blocked_slots b
       LEFT JOIN doctors d ON d.id = b.doctor_id
       WHERE (?::text IS NULL OR b.date >= ?) ORDER BY b.date, b.start_min`, from ?? null, from ?? null);

export const blockedOn = async (date, doctorId) =>
  await all(`SELECT * FROM blocked_slots WHERE date = ? AND (doctor_id IS NULL OR doctor_id = ?)`,
    date, doctorId ?? -1);

export const addBlocked = async (b) => (await run(
  `INSERT INTO blocked_slots (doctor_id, date, start_min, end_min, reason, created_by)
   VALUES (?, ?, ?, ?, ?, ?)`,
  b.doctor_id ?? null, b.date, b.start_min, b.end_min, b.reason ?? null, b.created_by ?? null
)).lastInsertRowid;

export const deleteBlocked = async (id) => (await run('DELETE FROM blocked_slots WHERE id = ?', id)).changes;
