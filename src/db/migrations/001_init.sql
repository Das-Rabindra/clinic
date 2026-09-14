-- ═══════════════════════════════════════════════════════════════════════════
-- Samal Dental Care — initial schema
-- ═══════════════════════════════════════════════════════════════════════════
PRAGMA foreign_keys = ON;

-- ─── Identity ──────────────────────────────────────────────────────────────
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_active ON users(is_active, deleted_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                       -- sha256(token); raw token never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Media (declared early: referenced by settings/doctors/services) ────────
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage TEXT NOT NULL DEFAULT 'local',
  key TEXT NOT NULL,                          -- storage key, e.g. clinic/ab12.webp
  url TEXT NOT NULL,                          -- public URL path
  folder TEXT NOT NULL DEFAULT 'clinic',
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER, height INTEGER,
  checksum TEXT,
  original_name TEXT,
  alt TEXT,
  variant_of INTEGER REFERENCES media(id) ON DELETE CASCADE,
  variant_kind TEXT,                          -- thumb | display | NULL(original)
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_folder ON media(folder, deleted_at);
CREATE INDEX idx_media_variant ON media(variant_of);

-- ─── Clinic settings (singleton row id=1) ──────────────────────────────────
CREATE TABLE clinic_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  doctor_name TEXT, qualification TEXT, registration TEXT, institution TEXT,
  tagline TEXT, description TEXT,
  phone TEXT, phone_intl TEXT, whatsapp TEXT, email TEXT, site_url TEXT,
  address_line1 TEXT, address_line2 TEXT, area TEXT, city TEXT, state TEXT,
  postal_code TEXT, country TEXT DEFAULT 'India',
  maps_url TEXT, place_id TEXT, latitude REAL, longitude REAL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  slot_interval_min INTEGER NOT NULL DEFAULT 30,
  booking_lead_hours INTEGER NOT NULL DEFAULT 2,
  booking_horizon_days INTEGER NOT NULL DEFAULT 60,
  auto_confirm INTEGER NOT NULL DEFAULT 0,
  reviews_url TEXT, instagram_url TEXT, facebook_url TEXT,
  logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  favicon_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  og_image_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  hero_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  seo_title TEXT, seo_description TEXT, seo_canonical TEXT,
  og_title TEXT, og_description TEXT,
  hero_eyebrow TEXT, hero_title TEXT, hero_lede TEXT, hero_cta_label TEXT,
  hero_trust_text TEXT,
  about_title TEXT, about_body TEXT, story_title TEXT, story_body TEXT,
  services_title TEXT, services_lede TEXT,
  gallery_title TEXT, gallery_lede TEXT,
  reviews_title TEXT, cta_title TEXT, cta_body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE clinic_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  is_open INTEGER NOT NULL DEFAULT 1,
  open_min INTEGER NOT NULL DEFAULT 540,      -- minutes from midnight (09:00)
  close_min INTEGER NOT NULL DEFAULT 1140,    -- 19:00
  break_start_min INTEGER, break_end_min INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (weekday),
  CHECK (close_min > open_min),
  CHECK (break_start_min IS NULL OR break_end_min > break_start_min)
);

-- ─── Doctors ───────────────────────────────────────────────────────────────
CREATE TABLE doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  photo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  qualification TEXT, registration TEXT, specialization TEXT,
  bio TEXT, experience_years INTEGER, languages TEXT,
  consultation_fee REAL, currency TEXT DEFAULT 'INR',
  slot_interval_min INTEGER,                  -- NULL = inherit clinic setting
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-doctor weekly availability. Absent row => doctor follows clinic hours.
CREATE TABLE doctor_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_open INTEGER NOT NULL DEFAULT 1,
  open_min INTEGER NOT NULL, close_min INTEGER NOT NULL,
  break_start_min INTEGER, break_end_min INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (doctor_id, weekday),
  CHECK (close_min > open_min)
);

-- doctor_id NULL = clinic-wide closure
CREATE TABLE holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                         -- YYYY-MM-DD (clinic timezone)
  end_date TEXT,                              -- inclusive range end; NULL = single day
  reason TEXT,
  is_full_day INTEGER NOT NULL DEFAULT 1,
  start_min INTEGER, end_min INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_holidays_date ON holidays(date);

CREATE TABLE blocked_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_min > start_min)
);
CREATE INDEX idx_blocked_date ON blocked_slots(date, doctor_id);

-- ─── Services ──────────────────────────────────────────────────────────────
CREATE TABLE service_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL,
  short_desc TEXT, long_desc TEXT,
  icon TEXT,
  image_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  price_from REAL, currency TEXT DEFAULT 'INR', show_price INTEGER NOT NULL DEFAULT 0,
  bookable INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (duration_min > 0)
);
CREATE INDEX idx_services_active ON services(is_active, deleted_at, display_order);

-- ─── Patients ──────────────────────────────────────────────────────────────
CREATE TABLE patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                  -- SDC-P-00001
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,                 -- normalised E.164-ish digits
  email TEXT, dob TEXT, gender TEXT,
  notes TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_patients_name ON patients(name);

-- ─── Appointments ──────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,                   -- SDC-2026-00123
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT,                          -- denormalised: survives service deletion
  date TEXT NOT NULL,                         -- YYYY-MM-DD in clinic timezone
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  starts_at_utc TEXT NOT NULL,                -- ISO instant, drives reminders
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rescheduled','checked_in',
                      'in_progress','completed','cancelled','no_show')),
  source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website','admin','phone','walkin')),
  reason TEXT, message TEXT,
  is_new_patient INTEGER NOT NULL DEFAULT 1,
  cancel_reason TEXT,
  rescheduled_from_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  confirmed_at TEXT, completed_at TEXT, cancelled_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_min > start_min)
);
CREATE INDEX idx_appt_date_status ON appointments(date, status);
CREATE INDEX idx_appt_doctor_date ON appointments(doctor_id, date);
CREATE INDEX idx_appt_patient ON appointments(patient_id);
CREATE INDEX idx_appt_utc ON appointments(starts_at_utc);

-- ★ The double-booking guarantee.
-- One row per slot-interval an appointment occupies. The UNIQUE constraint
-- makes an overlapping booking a database error, not a race-prone check.
CREATE TABLE appointment_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  slot_min INTEGER NOT NULL,
  UNIQUE (doctor_id, date, slot_min)
);
CREATE INDEX idx_slots_lookup ON appointment_slots(doctor_id, date);

CREATE TABLE appointment_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL,
  note TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_status_hist ON appointment_status_history(appointment_id);

-- ─── Gallery ───────────────────────────────────────────────────────────────
CREATE TABLE gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  after_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,  -- before/after pair
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'clinic',
  taken_on TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  consent_note TEXT,
  consent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  consent_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- ★ Patient treatment photos cannot be published without recorded consent.
  --   Enforced by the database, not only by the UI.
  CHECK (category <> 'treatment' OR is_published = 0 OR consent_confirmed = 1)
);
CREATE INDEX idx_gallery_pub ON gallery_items(is_published, category, display_order);

-- ─── Reviews ───────────────────────────────────────────────────────────────
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'google',
  external_id TEXT UNIQUE,
  author_name TEXT NOT NULL,
  author_photo_url TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT,
  review_url TEXT,
  reviewed_at TEXT,
  reply_text TEXT, replied_at TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reviews_visible ON reviews(is_visible, reviewed_at DESC);

CREATE TABLE review_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  connected INTEGER NOT NULL DEFAULT 0,
  account_name TEXT, location_name TEXT, location_title TEXT,
  rating_avg REAL, rating_count INTEGER,
  last_sync_at TEXT, last_error TEXT, last_error_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Content ───────────────────────────────────────────────────────────────
CREATE TABLE faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  message TEXT,
  preferred_contact TEXT NOT NULL DEFAULT 'phone'
    CHECK (preferred_contact IN ('phone','whatsapp','email')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','converted','archived')),
  source TEXT NOT NULL DEFAULT 'website',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contacted_at TEXT,
  converted_patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_enquiries_status ON enquiries(status, created_at DESC);

-- ─── Notifications ─────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email','admin')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_role TEXT NOT NULL DEFAULT 'patient' CHECK (recipient_role IN ('patient','clinic')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  body_preview TEXT,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  enquiry_id INTEGER REFERENCES enquiries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','skipped','not_configured')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  provider TEXT, provider_msg_id TEXT,
  last_error TEXT,
  scheduled_for TEXT,
  sent_at TEXT,
  -- Idempotency: one notification per (appointment, template, channel).
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_status ON notifications(status, scheduled_for);
CREATE INDEX idx_notif_appt ON notifications(appointment_id);

CREATE TABLE notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  response_body TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_logs ON notification_logs(notification_id);

-- In-dashboard bell notifications for staff
CREATE TABLE admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','error')),
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_adminnotif ON admin_notifications(is_read, created_at DESC);

-- ─── Durable background jobs (survive restart; no Redis needed) ────────────
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at TEXT, locked_by TEXT,
  last_error TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_due ON jobs(status, run_at);

-- ─── Integrations & audit ──────────────────────────────────────────────────
CREATE TABLE integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,              -- whatsapp | google_business | smtp | maps
  is_enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',     -- non-secret, safe to show admin
  secret_json TEXT,                           -- AES-256-GCM ciphertext, never returned
  status TEXT NOT NULL DEFAULT 'not_configured',
  last_checked_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT, entity_id TEXT,
  summary TEXT,
  before_json TEXT, after_json TEXT,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_time ON audit_logs(created_at DESC);
