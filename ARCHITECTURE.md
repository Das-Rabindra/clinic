# Samal Dental Care — Platform Architecture

> Transformation of a single static `index.html` into a production dental-clinic
> website **+** clinic-management system **+** patient booking platform.
> The original file is preserved verbatim at `legacy/index.original.html`.
>
> **This is the plan, written before implementation.** It is kept for its
> reasoning and phase breakdown. For what was actually built — including where
> reality diverged, the UI/UX design system, and bugs found along the way — see
> **[PROJECT.md](PROJECT.md)**. Where the two disagree, PROJECT.md is correct.

---

## 1. Current architecture assessment

| Aspect | Finding |
|---|---|
| Frontend tech | One 1,209-line / 150 KB `index.html`. Vanilla HTML + CSS + ES2020 JS. No framework. |
| Backend | **None.** No server, no API, no persistence. |
| Build system | **None.** No `package.json`, no bundler, no dependencies. |
| Data layer | Four hardcoded JS literals: `CLINIC{}`, `SERVICES[]`, `GALLERY[]`, `FAQS[]`. |
| Assets | Clinic logo embedded as three base64 data-URIs (`LOGO.x64/x96/x240`) — the bulk of the 150 KB. |
| Design system | Well-defined tokens: `--pine #1F3D3A`, `--sage #7C9885`, `--honey #C79A4B`, `--paper #FAF8F3`, `--line #E4DFD3`. Fraunces (display) / Inter (body) / IBM Plex Mono (data). Signature "smile arc" SVG motif. |
| A11y | Genuinely good: skip-link, `aria-expanded`, `aria-modal` lightbox, `:focus-visible`, `prefers-reduced-motion` guard. |
| SEO | Static meta + `Dentist` JSON-LD. Canonical/OG set from `CLINIC.siteUrl` at runtime (which is empty). |
| "Booking" | `AppointmentService.submit()` URL-encodes the form and opens `wa.me`. Nothing is stored. Already has a `TODO(backend)` pointing at `POST /api/appointments`. |
| Gallery | Placeholder tiles with icons — no real images. |
| Reviews | Empty-state only. Honest, but non-functional. |
| Map | `google.com/maps?q=<address>&output=embed`, lazy-loaded by IntersectionObserver. |

**Verdict:** the design and markup are high quality and worth preserving exactly.
The *architecture* is a prototype: zero persistence, zero authentication, zero
operational capability. The previous author left clean seams
(`AppointmentService`, the config objects) that this migration follows rather
than fights.

### What is static today
Everything. Clinic details, services, gallery, FAQs, reviews, availability, and
the booking "submission" are all client-side constants.

### What should remain frontend
Layout, CSS tokens, typography, scroll-reveal, lightbox, FAQ accordion, mobile
nav, the booking wizard's step transitions, client-side *first-pass* validation
(as UX, never as enforcement).

### What requires a backend
Authentication/sessions, all content persistence, the availability engine,
appointment writes (transactional), patient/enquiry records, media uploads +
EXIF stripping, WhatsApp/email sending, Google OAuth + Reviews sync, reminder
scheduling, audit logging, and every secret.

---

## 2. Recommended architecture

The project is a single static file, so there is no existing architecture to
extend — but the *idiom* (vanilla, dependency-light, server-rendered-friendly)
is worth keeping. Introducing React/Next here would be an unforced rewrite of a
design that already works.

```
┌────────────────────────────────────────────────────────────────┐
│ Public site (SSR, EJS)          Admin SPA (vanilla ES modules)  │
│ progressive enhancement          /admin — session-cookie gated  │
└───────────────┬────────────────────────────┬───────────────────┘
                │  fetch() JSON              │
┌───────────────▼────────────────────────────▼───────────────────┐
│ Express 5 — routes → validation (zod) → services → repositories │
├─────────────────────────────────────────────────────────────────┤
│ Domain services                                                 │
│  AvailabilityService · AppointmentService · NotificationService  │
│  GoogleReviewsService · MediaService · AuditService · Calendar   │
├─────────────────────────────────────────────────────────────────┤
│ Repositories (the only SQL in the codebase)                     │
├─────────────────────────────────────────────────────────────────┤
│ SQLite (WAL) ·  Storage abstraction (local FS → S3-ready)        │
│ In-process durable job runner (jobs table, survives restart)     │
└─────────────────────────────────────────────────────────────────┘
```

**Stack:** Node 22 · Express 5 · SQLite (`better-sqlite3`, WAL) · EJS · zod ·
sharp · multer · nodemailer · vanilla ES modules on the client.

**Why SQLite, not Postgres.** One clinic, one location, a few thousand
appointments a year. SQLite in WAL mode with `BEGIN IMMEDIATE` gives real
serialisable write transactions and real unique constraints — which is all the
double-booking guarantee needs. It removes an entire service from the deployment
and makes backup a file copy. All SQL is confined to `src/repositories/`, so a
Postgres swap touches one directory.

**Why no Redis.** Reminders live in a `jobs` table polled by an in-process
runner. Durable across restarts, no extra container. `RUN_JOBS=false` lets the
worker be split into its own process when traffic justifies it.

---

## 3. Database schema

23 tables. Every table: `id` PK, `created_at`, `updated_at`; soft delete
(`deleted_at`) where records are operationally referenced.

```
users(id, email UQ, password_hash, password_salt, name, role, is_active,
      failed_attempts, locked_until, last_login_at, must_change_password)
sessions(id PK=token_hash, user_id FK→users, expires_at, ip, user_agent,
         revoked_at)                                    IDX(user_id, expires_at)
password_resets(id, user_id FK, token_hash UQ, expires_at, used_at)

clinic_settings(id=1 singleton, name, doctor_name, qualification, registration,
      institution, description, phone, phone_intl, whatsapp, email, site_url,
      address_line1, address_line2, area, city, state, postal_code, country,
      maps_url, place_id, latitude, longitude, timezone, slot_interval_min,
      booking_lead_hours, booking_horizon_days, reviews_url, instagram_url,
      facebook_url, logo_media_id FK→media, favicon_media_id FK→media,
      og_image_media_id FK→media, seo_title, seo_description, hero_*)

doctors(id, name, slug UQ, photo_media_id FK→media, qualification, registration,
      specialization, bio, experience_years, languages, consultation_fee,
      slot_interval_min, is_active, display_order, deleted_at)
doctor_schedules(id, doctor_id FK, weekday 0-6, is_open, open_min, close_min,
      break_start_min, break_end_min)          UQ(doctor_id, weekday)
holidays(id, date, doctor_id FK NULL=clinic-wide, reason, is_full_day,
      start_min, end_min)                      IDX(date)
blocked_slots(id, doctor_id FK, date, start_min, end_min, reason, created_by FK)

service_categories(id, name, slug UQ, display_order)
services(id, name, slug UQ, category_id FK, short_desc, long_desc, icon,
      image_media_id FK, duration_min, price_from, currency, bookable,
      is_active, display_order, deleted_at)      IDX(is_active, display_order)

patients(id, code UQ, name, phone UQ, email, dob, notes, is_blocked,
      created_by FK, deleted_at)                        IDX(phone), IDX(name)
appointments(id, ref UQ 'SDC-2026-00123', patient_id FK, doctor_id FK,
      service_id FK, date, start_min, end_min, duration_min, starts_at_utc,
      status, source, reason, message, is_new_patient, cancel_reason,
      rescheduled_from_id FK→appointments, confirmed_at, completed_at,
      cancelled_at, created_by FK, deleted_at)
      IDX(date,status) IDX(doctor_id,date) IDX(patient_id) IDX(starts_at_utc)
appointment_slots(id, appointment_id FK ON DELETE CASCADE, doctor_id, date,
      slot_min)                     ← ★ UNIQUE(doctor_id, date, slot_min)
appointment_status_history(id, appointment_id FK, from_status, to_status,
      changed_by FK, note)

media(id, key, url, storage, mime, ext, bytes, width, height, checksum,
      original_name, alt, uploaded_by FK, variant_of FK→media, deleted_at)
gallery_items(id, media_id FK, title, description, category, taken_on,
      display_order, is_published, consent_confirmed, consent_note,
      consent_by FK, consent_at, deleted_at)
      CHECK(category<>'treatment' OR is_published=0 OR consent_confirmed=1)  ★

reviews(id, source, external_id UQ, author_name, author_photo_url, rating,
      text, review_url, reviewed_at, reply_text, is_visible, is_featured,
      raw_json, synced_at)                        IDX(is_visible, reviewed_at)
review_sync_state(id=1, connected, last_sync_at, last_error, last_error_at,
      account_name, location_name, rating_avg, rating_count)

faqs(id, question, answer, display_order, is_published, deleted_at)
enquiries(id, name, phone, email, message, preferred_contact, status, source,
      assigned_to FK, contacted_at, converted_patient_id FK, notes, deleted_at)

notifications(id, channel, template, recipient, payload_json, appointment_id FK,
      enquiry_id FK, status, attempts, max_attempts, provider, provider_msg_id,
      last_error, scheduled_for, sent_at)   IDX(status, scheduled_for)
notification_logs(id, notification_id FK, attempt, status, http_status,
      response_body, error)
admin_notifications(id, type, title, body, link, is_read, read_at, severity)
jobs(id, kind, run_at, payload_json, status, attempts, locked_at, locked_by,
     last_error)                             IDX(status, run_at)  ★ durable

integrations(id, provider UQ, is_enabled, config_json, secret_json(encrypted),
      status, last_checked_at, last_error)
audit_logs(id, user_id FK, action, entity, entity_id, before_json, after_json,
      ip, user_agent)                        IDX(entity, entity_id) IDX(user_id)
```

★ **`appointment_slots` is the double-booking guarantee.** An appointment
materialises one row per `slot_interval_min` slot it occupies. `UNIQUE(doctor_id,
date, slot_min)` makes an overlapping booking a constraint violation *at the
database*, not a race-prone `SELECT`-then-`INSERT` check. A 60-minute booking on
a 30-minute grid inserts two rows; a colliding 30-minute booking fails on
either. Cancellation deletes the rows, freeing the slots.

★ The `gallery_items` CHECK constraint makes it **structurally impossible** to
publish a treatment photo without recorded consent — enforced in the schema, not
just the UI.

---

## 4. API architecture

**Public** (no auth, rate-limited)
```
GET  /                                 SSR homepage
GET  /api/clinic                       clinic profile, hours, today's status
GET  /api/services                     active services
GET  /api/doctors                      active doctors
GET  /api/faqs                         published FAQs
GET  /api/gallery?category=            published items only
GET  /api/reviews                      visible reviews + aggregate
GET  /api/appointments/availability?date=&service_id=&doctor_id=
POST /api/appointments                 create (rate-limited, CSRF)
GET  /api/appointments/:ref?phone=     patient self-service lookup
POST /api/appointments/:ref/cancel     patient cancel (phone-verified)
GET  /api/appointments/:ref/calendar.ics
POST /api/enquiries
```
**Auth**
```
POST /api/auth/login   /logout   /forgot-password   /reset-password
GET  /api/auth/me
```
**Admin** (`requireAuth` + role + CSRF on writes) — `/api/admin/…`
```
dashboard · clinic · hours · holidays · blocked-slots · doctors · services
appointments (+ /confirm /cancel /reschedule /status /checkin /complete /no-show)
patients · enquiries · gallery · media · reviews (+ /sync /connect) · faqs
notifications (+ /:id/retry) · admin-notifications · users · integrations
seo · audit-logs
```

---

## 5. Patient booking flow

```
1 Treatment  →  2 Date  →  3 Time  →  4 Details  →  5 Confirm
                    ↑            ↑
     GET /api/appointments/availability (server-computed, per doctor+service)
                                 │
                    POST /api/appointments
                                 │
  BEGIN IMMEDIATE ─ upsert patient by phone
                  ─ insert appointment (status=pending)
                  ─ insert N appointment_slots  ← UNIQUE fires on collision
                  ─ insert status history + audit
                  COMMIT                          → 409 SLOT_TAKEN on violation
                                 │
        enqueue jobs (never inline, never blocking):
          booking_received → patient WhatsApp
          new_appointment  → clinic WhatsApp + admin_notifications row
                                 │
   → SDC-2026-00123 · [Add to Calendar] [WhatsApp] [Reschedule] [Cancel]
```

**Availability derivation** — `doctor_schedules[weekday]` → subtract break →
subtract `holidays` → subtract `blocked_slots` → subtract occupied
`appointment_slots` → drop slots that cannot fit `service.duration_min` before
close → drop slots inside `booking_lead_hours` → cap at `booking_horizon_days`.
All in `Asia/Kolkata` via `Intl`, DST-correct by construction.

---

## 6. WhatsApp notification flow

```
AppointmentCreated ─┬→ jobs(kind=notification) ─→ NotificationService.dispatch
                    │                                │
                    │                       ┌────────┴────────┐
                    │                   WhatsApp            Email
                    │                       │                 │
                    │            ┌──────────┴─────────┐   SMTP / null
                    │      CloudApiProvider      NullProvider
                    │      (graph.facebook.com)  (records "not configured")
                    └→ admin_notifications (in-dashboard bell)
```
Templates: `booking_received`, `appointment_confirmed`, `reminder_24h`,
`reminder_2h`, `rescheduled`, `cancelled`, `follow_up`, `new_appointment_admin`,
`cancelled_admin`, `new_enquiry_admin`.

**Failure is isolated by design.** The appointment commits first; notifications
are rows in `jobs`/`notifications`. A provider outage produces a `failed`
notification with the error body captured in `notification_logs`, retried with
exponential backoff, and surfaced in the dashboard with a **Retry** button. An
appointment is never lost because Meta returned a 500.

Credentials (`WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`) live in env/`integrations.
secret_json` (AES-256-GCM at rest). Never serialised to any client response.

---

## 7. Google Reviews flow

```
Admin → Integrations → [Connect Google Business Profile]
  → /api/admin/integrations/google/connect   (OAuth 2.0 authorization code,
     state = HMAC-signed nonce, scope business.manage)
  → Google consent → /oauth/google/callback
  → exchange code → store refresh_token (encrypted) → list accounts/locations
  → admin picks the clinic location → store account/location name
  → Sync: mybusiness Reviews API → upsert by external_id → aggregate rating
```
No HTML scraping. Token refresh on 401, one retry. On failure the public site
serves the **last successful sync** and the admin sees
`"Google Reviews could not be synchronized. Last successful sync: <ts>"`.
Public reviews section renders only rows actually returned by the API; if none
were ever synced it renders the existing honest empty state. Admin can hide an
individual review but cannot edit its text — no fabricated testimonials, and
`AggregateRating` JSON-LD is emitted only when real synced reviews exist.

---

## 8. Gallery / media architecture

Upload → magic-byte sniff (not `Content-Type`) → reject non-JPEG/PNG/WebP →
size cap → sharp re-encode (**strips all EXIF, including GPS**) → derive
`webp` + thumbnail → content-hash filename → `StorageDriver.put()`.

```
media/clinic/… media/doctor/… media/services/… media/treatment-results/…
```
`LocalDriver` today; `S3Driver` implements the same 4-method interface
(`put/get/delete/url`). DB stores key + metadata only — never bytes.

**Patient privacy (§14).** Treatment-category items are gated by the CHECK
constraint above; the publish action requires an explicit consent checkbox and
records who confirmed it and when. Admin UI actively steers titles toward
`"Before & After — Smile Restoration"` and warns against patient names. EXIF
GPS/device data is destroyed on ingest.

---

## 9. Security model

Sessions: 256-bit random token, **SHA-256 hashed at rest**, `httpOnly` +
`SameSite=Lax` + `Secure` (when `TRUST_PROXY`), sliding 8 h expiry, 30 d absolute
cap, server-side revocation. Passwords: `scrypt` (N=16384, 32-byte salt,
`timingSafeEqual`). Lockout after 8 failures. CSRF: double-submit token on every
non-GET admin/booking route. Rate limits: login 8/15 min, booking 5/h/IP,
enquiry 5/h/IP. Zod validation on every body/query — server-side, always.
Helmet-equivalent CSP, `X-Content-Type-Options`, `Referrer-Policy`,
`frame-ancestors 'none'` on `/admin`. All SQL via prepared statements. All
interpolation HTML-escaped (EJS `<%= %>` + a client `esc()`). Uploads are
re-encoded, never served from a path the user controls. Secrets at rest are
AES-256-GCM'd with `APP_SECRET`. Every state-changing admin action writes an
`audit_logs` row with before/after JSON.

---

## 10. Deployment architecture

Multi-stage Dockerfile (build deps → slim runtime), non-root `node` user,
`tini`, `HEALTHCHECK` → `/healthz`. Two named volumes: `clinic-data` (SQLite) and
`clinic-uploads` (media). Env-driven config; `docker compose up` is the whole
deploy. Behind the existing nginx for TLS. Backup = copy two volumes.

---

## 11. Phase plan

| Phase | Scope | Key files | DB | Security |
|---|---|---|---|---|
| 1 | Skeleton, config, migrations, repos, storage | `src/db/**`, `src/repositories/**` | all tables | secret loading, no defaults in code |
| 2 | Auth + admin shell + audit | `auth.service`, `middleware/*`, `views/admin/*` | users, sessions, audit | scrypt, lockout, CSRF, rate limit |
| 3 | Clinic CMS + SSR public site | `routes/public`, `views/public/**`, `public/css/site.css` | clinic_settings, hours, faqs | XSS escaping, admin-only writes |
| 4 | Availability + booking | `availability.service`, `appointment.service` | appointment_slots ★ | transaction, unique index, 409 |
| 5 | Notification layer + WhatsApp | `services/notification/**`, `jobs/**` | notifications, jobs | tokens server-only, isolation |
| 6 | Google Reviews | `services/google/**` | reviews, integrations | OAuth state HMAC, encrypted refresh token |
| 7 | Media + gallery + consent | `media.service`, `storage/**` | media, gallery_items | magic bytes, EXIF strip, CHECK |
| 8 | Patients + enquiries | `patients.repo`, `enquiries.*` | patients, enquiries | phone-scoped lookup |
| 9 | Reminders + admin notifications | `jobs/handlers/**` | jobs | retry caps, idempotency |
| 10 | SEO, hardening, Docker, tests | `Dockerfile`, `test/**` | — | CSP, headers, full test pass |

---

## 12. Risks and edge cases

Race on the last slot → **DB unique constraint** + `BEGIN IMMEDIATE`, tested.
DST/timezone → single `Intl`-based conversion helper; India has no DST but the
code is correct regardless. Appointment spanning a break or close → duration
must fit *entirely* inside an open window. Holiday declared after bookings exist
→ admin is warned and shown the affected appointments. Provider outage →
appointment survives; notification retries. Token expiry → refresh + one retry,
then a visible "reconnect" state. Duplicate phone → patient upsert by phone.
Clock skew on reminders → jobs are idempotent per `(appointment, template)`.
Large uploads → 10 MB cap before buffering. SQLite writer contention → WAL +
short transactions; `busy_timeout` 5 s.

---

## 13. Testing plan

`node:test`, no external runner. Covers: login success/lockout/unauthorised
admin access; CSRF rejection; availability generation incl. break/holiday/
blocked/lead-time; booking happy path; **concurrent double-booking of one slot
(N parallel writers → exactly 1 success, N-1 × 409)**; cancel frees the slot;
reschedule moves slots atomically; notification-provider failure leaves the
appointment intact and the notification retryable; gallery consent constraint
rejects unconsented publish; upload MIME/size rejection; zod validation.

---

## 14. MVP vs Phase-2

**MVP (built here):** everything in phases 1–10 — auth, CMS, booking engine,
admin console, media+consent, patients, enquiries, notification layer with real
WhatsApp Cloud API client, Google Reviews OAuth client, reminders, audit, SEO,
Docker.

**Requires the clinic's credentials to go live** (architecture complete, marked
"Not configured" in Integrations until supplied): WhatsApp Cloud API token +
phone-number ID + approved message templates; Google Cloud OAuth client +
verified Business Profile; SMTP credentials; the real domain for canonical/OG.

**Deliberately Phase-2:** online payments, prescriptions/treatment plans,
invoices, clinical records, multi-branch, Google Calendar two-way sync, patient
login portal, loyalty campaigns. The schema (doctors, roles, media, integrations)
is shaped so none of these require a rewrite.
