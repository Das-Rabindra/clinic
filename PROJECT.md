# Samal Dental Care — Project Reference

As-built documentation for the clinic website, patient booking platform and
management console.

> **Scope of this document.** `ARCHITECTURE.md` is the *plan* written before
> implementation and is kept for its reasoning and phase breakdown. This file
> describes what actually exists and where it diverged. Where the two disagree,
> this one is correct. `README.md` is the short operational guide.

**Repository:** https://github.com/Das-Rabindra/clinic
**Origin:** a single 1,209-line `index.html` (vanilla HTML/CSS/JS, no backend,
no build step), preserved unchanged at `legacy/index.original.html` and in git
history at commit `68e0b14`.

---

## 1. What this is

One deployable Node.js application serving two audiences.

**Patients** browse the clinic, services, photos, hours and genuine Google
reviews; see live availability; book through a five-step wizard; receive a
booking reference; add the visit to their calendar; and look up or cancel a
booking using that reference plus the mobile number it was made with.

**The clinic** signs in at `/admin` and runs the practice without touching
code: appointments, patients, enquiries, website content, photos, opening
hours, holidays, doctors, integrations and an audit trail.

**Size:** 106 source files, ~13,700 lines, 28 database tables, 43 indexes,
87 route handlers, 92 tests.

---

## 2. Architecture

The original project had no architecture to extend — but its *idiom* (vanilla,
dependency-light, no build step) was worth keeping. Introducing React or Next
would have been an unforced rewrite of a design that already worked.

```
┌──────────────────────────────────────────────────────────────────┐
│  Public site (SSR, EJS)          Admin console (vanilla ES modules)│
│  progressive enhancement          /admin — session-cookie gated    │
└────────────────┬──────────────────────────────┬──────────────────┘
                 │  fetch() JSON                │
┌────────────────▼──────────────────────────────▼──────────────────┐
│  Express 5 — routes → validation (zod) → services → repositories  │
├───────────────────────────────────────────────────────────────────┤
│  Domain services                                                  │
│   AvailabilityService · AppointmentService · NotificationService   │
│   GoogleReviewsService · MediaService · AuditService · Calendar    │
├───────────────────────────────────────────────────────────────────┤
│  Repositories — the only SQL in the codebase                      │
├───────────────────────────────────────────────────────────────────┤
│  PostgreSQL  ·  Storage abstraction (local FS | Vercel Blob)      │
│  Durable job runner (jobs table; interval or cron-driven)         │
└───────────────────────────────────────────────────────────────────┘
```

**Stack:** Node 22 · Express 5 · PostgreSQL (`pg`) · EJS · zod · sharp ·
multer · nodemailer · vanilla ES modules. **No build step** — the code that
ships is the code that runs.

**Two deployment shapes, one codebase:**

| | Long-running server (Docker) | Serverless (Vercel) |
|---|---|---|
| Entry | `src/server.js` | `api/index.js` |
| Database | Postgres container | Neon / Vercel Postgres |
| Uploads | local disk (`/uploads`) | Vercel Blob |
| Jobs | in-process interval | `/api/cron` on a schedule |
| Rate limiting | in-process Map | `rate_limits` table |

The application code is identical; only the driver behind each seam changes.

### Why these choices

| Decision | Reasoning | What it would take to change |
|---|---|---|
| **Postgres** | Started on SQLite for zero-ops simplicity, moved to Postgres so the app can run on serverless platforms where the filesystem is ephemeral. Postgres also gives genuine concurrent writes rather than SQLite's single-writer model. | All SQL is confined to `src/repositories/`; the query adapter in `src/db/index.js` is the only dialect-aware file. |
| **No Redis** | Reminders live in a `jobs` table, drained by an interval on a server or by `/api/cron` on serverless. Durable across restarts, no extra service. | `RUN_JOBS=false` splits the worker out. |
| **No ORM** | Hand-written parameterised SQL is clearer at this size and makes the concurrency guarantee explicit. | — |
| **Server-rendered public site** | Content stays crawlable and the page is useful before any JavaScript runs. | — |
| **Vanilla client JS** | Matches the original codebase, no bundler, no framework churn. The admin is ~3,600 lines of plain ES modules. | Introduce a bundler only if the admin outgrows this. |
| **No ORM** | Hand-written prepared statements are clearer than a query builder at this size, and make the concurrency guarantee explicit. | — |

---

## 3. Code map

```
src/
  config/          env.js (only place process.env is read), constants.js
  db/              index.js (connection + tx helpers), migrate.js, seed.js,
                   migrations/001_init.sql
  repositories/    16 modules — every SQL statement in the codebase
  services/        availability · appointment · notification/** · google/**
                   media · storage/** · calendar · seo · audit · clinic.view
  jobs/            scheduler.js + handlers (reminders, follow-up, review sync)
  middleware/      auth · csrf · ratelimit · validate · security · error
  routes/          public.routes.js (SSR) · api/** (public + auth)
                   admin/** (13 modules) · admin.pages.js · oauth.routes.js
  views/           public/index.ejs + partials · admin/{app,login}.ejs
public/
  css/site.css     the original design, preserved verbatim, then extended
  css/admin.css    admin console
  js/site.js       nav, FAQ, gallery, lightbox, lazy map, scroll reveal
  js/booking.js    the five-step booking wizard
  js/admin/        core.js + app.js (router) + pages/ (11 screens)
  img/             logo assets decoded from the original base64
test/              9 files, 92 tests
legacy/            the original index.html, untouched
```

**Layering rule:** routes never contain SQL, repositories never contain
business logic, services never touch `req`/`res`. Controllers never call a
notification provider — they emit an event.

---

## 4. Data model

28 tables. Every table carries `id`, `created_at`, `updated_at`; soft delete
(`deleted_at`) where records are operationally referenced.

**Identity** `users` · `sessions` · `password_resets`
**Clinic** `clinic_settings` (singleton) · `clinic_hours` · `holidays` · `blocked_slots`
**People** `doctors` · `doctor_schedules` · `patients`
**Catalogue** `services` · `service_categories`
**Scheduling** `appointments` · `appointment_slots` ★ · `appointment_status_history`
**Media** `media` · `gallery_items` ★
**Content** `faqs` · `enquiries` · `reviews` · `review_sync_state`
**Ops** `notifications` · `notification_logs` · `admin_notifications` · `jobs`
· `integrations` · `audit_logs` · `schema_migrations`

### ★ Two constraints carry real weight

**`appointment_slots`** is the double-booking guarantee. An appointment
materialises one row per slot-interval it occupies:

```sql
UNIQUE (doctor_id, date, slot_min)
```

A 60-minute treatment on a 30-minute grid inserts two rows. Any overlapping
booking violates the constraint *at the database*, not in a race-prone
`SELECT`-then-`INSERT`. Cancelling deletes the rows, freeing the time.

**`gallery_items`** makes unconsented publication structurally impossible:

```sql
CHECK (category <> 'treatment' OR is_published = 0 OR consent_confirmed = 1)
```

This holds against a direct database write, not just the UI — there is a test
that bypasses the service layer to prove it.

---

## 5. Core mechanisms

### 5.1 Availability engine — `src/services/availability.service.js`

Slots are **never** accepted from the client. They are derived server-side:

```
doctor schedule (falls back to clinic hours for that weekday)
  − break period
  − holidays / temporary closures
  − admin-blocked time
  − slots already occupied by appointments
  − slots inside the booking lead time
  − slots where the treatment would not finish before closing
  = offered slots
```

All arithmetic is `(date, minutes-from-midnight)` in the clinic's timezone.
`src/utils/time.js` is the single place that converts to and from UTC
instants, using `Intl` so it is DST-correct by construction (tested against
`America/New_York` on both sides of the transition, even though India has no
DST).

### 5.2 Booking — `src/services/appointment.service.js`

```
validateSlot()            → a good error message
  ↓
BEGIN IMMEDIATE
  upsert patient by phone (one patient per number)
  insert appointment (pending, or confirmed if auto_confirm)
  insert N appointment_slots      ← UNIQUE fires here on collision
  insert status history + audit row
COMMIT                            → 409 SLOT_TAKEN if the constraint fires
  ↓
enqueue notifications (never inline, never blocking)
```

The pre-check produces readable errors; **the constraint produces the
guarantee**. `test/concurrency.test.mjs` runs 16 separate OS processes at a
shared timestamp barrier against one slot: exactly one wins, 15 are cleanly
rejected, zero errors.

Reference numbers (`SDC-2026-00001`, `SDC-P-00001`) come from Postgres
sequences rather than `SELECT MAX(...)+1`. The latter is not concurrency-safe:
two bookings for *different* slots committing at the same instant computed the
same reference and one failed. Sequence values may skip when a transaction
rolls back, which is harmless for a reference code.

### 5.3 Notifications — separation is the point

Creating an appointment and delivering a message are **separate concerns**.

```
AppointmentCreated ─┬→ jobs(kind=notification) → NotificationService.dispatch
                    │                               │
                    │                      ┌────────┴────────┐
                    │                  WhatsApp            Email
                    │                  Cloud API           SMTP
                    └→ admin_notifications (in-dashboard bell)
```

The appointment commits first. Messages are rows drained by a background
worker. A provider outage produces a `failed` notification with the error body
captured in `notification_logs`, retried with exponential backoff and surfaced
in the dashboard with a **Retry** button. An unconfigured provider records
`not_configured` — never silently dropped, **never faked as sent**.

*An appointment is never lost because Meta returned a 500.*

### 5.4 Media — `src/services/media.service.js`

```
upload → magic-byte sniff (never the client's Content-Type)
       → reject non-JPEG/PNG/WebP
       → size + pixel-count caps
       → sharp re-encode  ← this is what strips EXIF, including GPS
       → derive display (≤2000px WebP) + 480px thumbnail
       → content-hashed key → StorageDriver.put()
```

Re-encoding is deliberate: it destroys EXIF GPS coordinates and device
identifiers, which matters for patient treatment photos. Observed results:
2045 KB PNG → 111 KB WebP; 2246 KB JPEG → 166 KB.

`LocalDriver` today; an `S3Driver` implements the same five-method interface.
The database stores keys and metadata, never bytes.

---

## 6. API

87 handlers. Public routes are unauthenticated and rate-limited; admin routes
require a session, a CSRF token on writes, and write an audit row.

**Public** `/api/…`
```
GET  csrf · clinic · hours · services · doctors · faqs · gallery · reviews
GET  appointments/availability?date=&service_id=&doctor_id=
GET  appointments/calendar?from=&days=
POST appointments                        create a booking
GET  appointments/:ref?phone=            patient self-service lookup
GET  appointments/:ref/calendar.ics      ICS download
POST appointments/:ref/cancel            phone-verified cancellation
POST enquiries
```

**Auth** `/api/auth/…` — `login · logout · me · change-password ·
forgot-password · reset-password · sessions · sessions/revoke-others`

**Admin** `/api/admin/…` — `dashboard · alerts · clinic (+hours, holidays,
blocked-slots) · doctors (+schedule) · services · appointments (+confirm,
cancel, reschedule, status, availability/grid) · patients · enquiries ·
gallery (+media, publish, consent) · reviews (+sync, connect, google/*) ·
faqs · notifications (+retry) · users · integrations · seo · audit-logs`

**Pages** (server-rendered) — `/ · /services · /services/:slug · /privacy ·
/robots.txt · /sitemap.xml · /healthz`

**Conventions:** errors return `{ error, code }` and, for validation,
`{ fields: { name: message } }`. Codes are stable strings (`SLOT_TAKEN`,
`CONSENT_REQUIRED`, `CSRF`, `RATE_LIMITED`) so clients branch on `code`, never
on message text.

---

## 7. UI/UX design

### 7.1 Design language

The original site's visual identity was preserved exactly — palette,
typography, spacing, motion and the signature "smile arc" motif. Everything
added was built from the same tokens so the platform reads as one product.

**Palette** — botanical, warm, deliberately not clinical-blue.

| Token | Value | Role |
|---|---|---|
| `--ink` | `#26302C` | Body text, near-black pine |
| `--pine` | `#1F3D3A` | Brand primary — trust, clinical calm |
| `--pine-700` | `#16302D` | Headings, hover/pressed |
| `--sage` | `#7C9885` | Secondary, soft botanical |
| `--honey` | `#C79A4B` | Accent — CTA warmth, focus rings |
| `--honey-700` | `#AD8138` | Accent hover |
| `--paper` | `#FAF8F3` | Background, warm neutral |
| `--paper-dim` | `#F1EDE4` | Section alternation |
| `--line` | `#E4DFD3` | Hairline borders |

Semantic additions in the admin: `--ok #4A7C59`, `--warn #B58234`,
`--danger #B04A3A`, each with a tinted background for status pills.

**Typography** — three families, each with one job.

| Family | Use | Notes |
|---|---|---|
| **Fraunces** | Display — headings, stat values, booking titles | Warm characterful serif, used with restraint |
| **Inter** | Body, UI, forms | High legibility at small sizes |
| **IBM Plex Mono** | Phone numbers, times, booking refs, eyebrow labels, table headers | Signals "data" — times align, refs are unambiguous |

Headings use `clamp()` so the scale is fluid rather than stepped:
`h1: clamp(36px, 5.4vw, 58px)`, `h2: clamp(28px, 4vw, 42px)`.

**Motion** — one easing curve (`cubic-bezier(.22,.61,.36,1)`) and two
durations (`180ms` interactive, `420ms` reveal). Every animation is disabled
under `prefers-reduced-motion`, in both stylesheets.

**The smile arc** — a single hand-drawn arc used as a section underline. It
stands in for a confident smile without resorting to tooth iconography, and
appears four times on the homepage.

### 7.2 Public site anatomy

Three page types, all server-rendered from the database:

```
/                  Header → Hero → Credential strip → About/Doctor → Clinic story
                   → Treatments → Gallery → Testimonials → FAQ → Booking
                   → Location → CTA band → Footer
/services          Index of every published treatment
/services/<slug>   Treatment hero → What it is → When it may be needed
                   → What to expect → Benefits → sticky contact card
                   → FAQ → Other treatments → CTA
/privacy           Privacy and appointment policy
```

Persistent actions come in two forms that never appear together:

- **≥ 900px** — a fixed right-hand rail: *Appointment*, *Request a call back*,
  *WhatsApp*. Collapsed to icons, expanding on hover or keyboard focus.
- **< 900px** — the sticky bottom bar: *Call*, *WhatsApp*, *Book Appointment*.

Both breakpoints are 900px deliberately. They were 900 and 760, which left a
140px band — a tablet in portrait — with neither.

Every section is server-rendered. Empty states are honest: with no reviews the
section says so rather than inventing testimonials, and `AggregateRating` is
emitted **only** for Google-synced reviews.

### 7.2.1 Treatment cards

Image-led cards, three across, two on tablet, one on a phone. A fixed 3:2 media
ratio keeps every card the same height regardless of caption length and reserves
the space before an image loads, so the grid never shifts.

The whole card is a link (a stretched `::after` on the title anchor) with the
**Book** button layered above it at a higher stacking level — one tap opens the
treatment, one starts booking, and neither is an interactive element nested
inside another.

**What is listed.** Eleven treatments, all confirmed by the clinic — the eight
the original site carried, plus implants, orthodontics and aesthetic dentistry,
which appear on the clinic's own opening material. Dentures, wisdom-tooth
surgery and gum treatment stay off the site until confirmed: a card a patient
can book for a treatment the clinic does not provide is worse than a shorter
list. Adding one later is an admin task, not a code change — the card, the
page, the sitemap entry and the booking option all follow from the row.

**Card imagery.** A real photograph uploaded by the clinic always wins. Without
one the card renders `partials/treatment-art.ejs`: a per-treatment monoline
plate — one shared tooth silhouette with a different element per treatment
(canals traced into the roots for a root canal, a threaded fixture below the
gum line for an implant, an archwire and brackets for orthodontics, a shade
scale for whitening, a translucent laminate for a veneer). A slug with no
branch falls back to an examination mirror, and a test fails if a published
treatment has no artwork of its own — two identical cards would otherwise ship
unnoticed. All drawn for
this site; nothing is licensed from anywhere, and no reference site's assets
were copied or hotlinked. It reads as a designed set rather than a placeholder,
and every one is replaceable from *Admin → Services → Card photo* or
*Gallery → Use this photo → Treatment card*.

### 7.2.2 Testimonial slider

A CSS scroll-snap track, not a JavaScript carousel. It is a real scroll
container, so it works with a finger, a trackpad, the arrow keys and a screen
reader before any script runs; the arrows and page dots only enhance it.
Each card is labelled at source — *Google review* or *Shared with the clinic*.

### 7.3 The booking wizard

The original form collected a name and phone and opened WhatsApp. It is now
five steps against live availability:

```
1 Treatment  →  2 Date  →  3 Time  →  4 Your details  →  5 Confirm
                    ↑            ↑
        only days with free slots are selectable
                    availability fetched per date
```

Design decisions worth keeping:

- **Only free slots are shown.** The calendar disables days with no
  availability and marks bookable days with a dot, so a patient never taps
  into an empty day.
- **Times are grouped** Morning / Afternoon / Evening rather than presented as
  one long list.
- **The slot can vanish mid-flow.** If someone books it first, the wizard
  returns to step 3 with a clear message and reloads availability, rather than
  failing at the final step.
- **Confirmation gives a real reference** (`SDC-2026-00001`) plus Add to
  Calendar, WhatsApp and Book Another. The reference plus mobile number is
  what unlocks self-service lookup and cancellation.
- **Client validation is UX only.** Every rule is re-checked server-side.
- **No-JS fallback:** the section tells the patient to call or WhatsApp.

### 7.4 Admin information architecture

```
Dashboard
Appointments   Calendar (day/week/month) · All Appointments · Pending Requests
People         Patient Directory · Enquiries
Website        Homepage · Services · Gallery · Reviews · FAQ
Clinic         Clinic Information · Working Hours · Holidays & Blocks · Doctors
System         Notifications · Integrations · Admin Users · SEO · Audit Log
```

Sidebar badges surface pending appointments, new enquiries and failed
notifications so the operational queue is visible without navigating.

**Working Hours** deserves specific mention. It began as a six-column table
that needed horizontal scrolling on a phone to reach the closing time — the
field a clinic changes most often. It is now a card per day with a real
toggle switch, 42px touch targets, an optional break, and a **"Set every day
at once"** bar for applying one schedule across the week. Each day remains
independently editable.

### 7.5 Responsive strategy

Mobile is the primary case — most clinic traffic is phones.

- **Verified, not assumed.** Puppeteer drives Chromium at 360, 390, 768 and
  1280px across the public site and seven admin screens, asserting
  `scrollWidth <= clientWidth`. **Zero horizontal overflow at every size.**
- **The root cause of overflow was fixed, not hidden.** Grid and flex items
  default to `min-width: auto`, so a wide child (the wizard's step strip, a
  data table) stretched its track past the viewport. `min-width: 0` on those
  tracks is the actual fix; `overflow: hidden` would have masked it.
- **Data tables scroll inside their own container** with a "swipe to see more"
  hint rather than dragging the page sideways.
- **Touch targets** are ≥42px in the admin's editable surfaces.
- Below 400px the header's duplicate "Book Appointment" is dropped — the
  sticky bottom bar already carries it.

### 7.6 Accessibility

Inherited from the original and maintained throughout: skip link,
`aria-expanded` on the nav toggle, `aria-modal` lightbox with Escape and arrow
keys, `aria-pressed` on selection controls, focus returned to the trigger on
close, a `:focus-visible` ring in honey at 2.5px, real `<label>` elements, and
the day toggle built on a genuine checkbox rather than a styled `<div>`.

Known gap: the admin has not been tested with a screen reader.

---

## 8. Security

| Area | Implementation |
|---|---|
| Passwords | `scrypt` (N=16384, 32-byte salt), `timingSafeEqual` comparison |
| Sessions | 256-bit token, **stored only as SHA-256** — a database leak yields no usable cookie |
| Cookies | `httpOnly`, `SameSite=Lax`, sliding 8h expiry, 30d absolute cap, server-side revocation |
| `Secure` flag | Derived from the **actual scheme** (`PUBLIC_URL` https, or `TRUST_PROXY`) — not from `NODE_ENV` |
| Lockout | 15 minutes after 8 consecutive failures |
| Enumeration | Identical error and comparable timing for unknown accounts |
| CSRF | Double-submit token on every non-GET admin and booking route |
| Rate limits | Login 8/15min · booking 6/h · enquiry 5/h · lookup 20/10min, per IP |
| Validation | zod on every body and query — server-side always |
| SQL | Prepared statements with bound parameters throughout |
| XSS | EJS `<%= %>`; JSON-LD serialised through `jsonForScript()` which escapes `<`, `>`, `&` and U+2028/29 |
| Uploads | Magic-byte sniffing, re-encode, pixel and size caps, content-hashed names |
| Secrets | Integration credentials AES-256-GCM at rest, never returned by any endpoint |
| Headers | CSP, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`, HSTS behind TLS; `/admin` is `no-store` |
| Authorization | Ranked roles — `owner` > `admin` > `staff` |
| Audit | Every state-changing admin action writes `audit_logs` with before/after |

**Secrets never reach the client.** WhatsApp tokens, the Google client secret
and OAuth refresh tokens live server-side only; the admin UI is told *whether*
a secret exists, never its value. Verified by a test that scans every admin
endpoint's response.

---

## 9. Testing

92 tests, `node:test`, no external runner. Each file gets an isolated
temporary database.

| File | Tests | Covers |
|---|---|---|
| `security.test.mjs` | 22 | Auth, lockout, enumeration, RBAC, CSRF, SQL injection, XSS, headers, cookie `Secure` derivation, secret handling |
| `api.test.mjs` | 20 | Public API shape, availability, patient self-service, ICS, enquiries, rate limiting |
| `booking.test.mjs` | 15 | Create, cancel, reschedule, status history, notification isolation, reminder dedupe |
| `availability.test.mjs` | 12 | Hours, breaks, closures, holidays, blocks, multi-slot durations, DST |
| `media.test.mjs` | 11 | Ingest, **EXIF/GPS stripping**, magic bytes, consent gate incl. direct DB write |
| `updates.test.mjs` | 9 | Partial-update semantics across settings, doctors, services, gallery, FAQs |
| `concurrency.test.mjs` | 3 | **16 OS processes racing one slot**, parallel distinct slots, overlap |

The concurrency test spawns real child processes against a shared Postgres
database with a timestamp barrier. Each file runs against its own database,
created and dropped by the harness, so suites never see each other's rows.

```bash
docker run -d --name clinic-pg -e POSTGRES_PASSWORD=devpass \
  -p 55432:5432 postgres:16-alpine     # once
npm test
```

```bash
npm test
```

---

## 10. Deployment

### Docker (long-running server)

`docker compose` brings up Postgres and the app together.

```bash
cp .env.example .env
echo "APP_SECRET=$(openssl rand -hex 32)"      >> .env   # required
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env   # required
docker compose up -d --build
```

Compose refuses to start without either secret rather than falling back to an
insecure default. Migrations and seeding are idempotent and run on every boot,
serialised by a Postgres advisory lock so concurrent instances are safe.

State lives in two volumes — **the backup surface**: `clinic-pgdata` (the
database) and `clinic-uploads` (media).

### Vercel (serverless)

1. Create a Postgres database (Neon integration) — it sets `DATABASE_URL`.
2. Create a Blob store — it sets `BLOB_READ_WRITE_TOKEN`.
3. Set `APP_SECRET` in project settings. `PUBLIC_URL` is optional on Vercel —
   when unset the app derives its own absolute URL from
   `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`, so canonical links, `og:url`
   and the sitemap are correct on the first deploy instead of claiming the site
   lives on `http://localhost:8090`. Set it explicitly once a custom domain is
   attached. `CRON_SECRET` is optional too: without it `/api/cron` accepts only
   Vercel's own scheduler (identified by the `x-vercel-cron` header the platform
   strips from inbound requests), and refuses everything else.
4. Push. `vercel.json` routes everything to `api/index.js` and registers the
   cron that drains the job queue.

Vercel's Hobby cron runs once a day, which is enough for 24-hour reminders but
not 2-hour ones. Any external pinger hitting `/api/cron` with the
`CRON_SECRET` bearer token gives finer granularity for free.

### Behind a reverse proxy

Set `TRUST_PROXY=true` and `PUBLIC_URL=https://your-domain` so secure cookies,
canonical URLs and the OAuth redirect are correct. Terminate TLS at the proxy.

---

## 11. Integrations

All three are implemented against real APIs. Each reports **"not configured"**
until the clinic supplies credentials — nothing is stubbed, and nothing is
faked as working.

| Integration | Needs | Behaviour without it |
|---|---|---|
| **WhatsApp Cloud API** | Phone number ID, permanent token, approved templates (`booking_received`, `appointment_confirmed`, `reminder_24h`, `reminder_2h`, `rescheduled`, `cancelled`, `follow_up`, `new_appointment_admin`) | Bookings work; messages queue as `not_configured`, retryable once configured |
| **Google Business Profile** | OAuth client ID + secret, redirect URI registered, location selected | Reviews section shows its honest empty state |
| **SMTP** | Host, port, credentials | Email skipped; WhatsApp and dashboard unaffected |

Reviews come from the official Business Profile API — **no HTML scraping**.
Reviews are upserted by Google's review id, so re-syncing updates rather than
duplicates. A failed sync never clears existing reviews: the public site keeps
serving the last good data and the admin sees *"Google Reviews could not be
synchronized. Last successful sync: …"*.

Adding a provider means implementing one interface and registering it in
`services/notification/index.js`. Nothing else changes.

---

## 12. Patient photo privacy

Treatment photographs are handled deliberately:

- Publishing anything in the **Patient work** category requires explicit
  consent confirmation, recorded with **who** confirmed it and **when**.
- Enforced by a `CHECK` constraint, so it holds against a direct database
  write — not only through the UI.
- Withdrawing consent unpublishes immediately.
- Every upload is re-encoded, destroying **all EXIF including GPS**.
- The admin steers titles toward *"Before & After — Smile Restoration"* rather
  than patient names; consent metadata is never exposed publicly.

---

## 13. Bugs found during development

Recorded because each represents a class worth watching for.

| Bug | Impact | Fix |
|---|---|---|
| `Secure` cookie on plain HTTP | Login returned 200 but browsers discarded the cookie — **sign-in silently impossible**. Missed because curl is more permissive than browsers. | Derive `Secure` from the real scheme; regression test asserts its absence on HTTP |
| `JSON.stringify` in JSON-LD | `</script>` in FAQ content could break out of the script tag — **stored XSS** | `jsonForScript()` unicode-escapes `<`, `>`, `&`, U+2028/29 |
| zod `.partial()` keeps `.default()` | A one-field PUT rewrote unsent fields — could reset a gallery item's category or clear a consent flag | `partialUpdate()` strips defaults |
| `nullableStr()` collapsed `undefined` to `null` | **Data loss** — setting the hero image nulled doctor name, phone, address and 30 other fields | Transform preserves `undefined`; four regression tests |
| Grid `min-width: auto` | Public site scrolled sideways on mobile | `min-width: 0` on affected tracks |
| Booleans bound to SQLite | 500 on any update sending a boolean | Coerced to 0/1 at the single statement boundary |
| `SELECT MAX(...)+1` for reference numbers | Two bookings for *different* slots at the same instant computed the same reference; one failed and was misreported as "slot taken". Invisible under SQLite, which serialises writes. | Postgres sequences, and slot conflicts now identified by constraint name rather than any unique violation |
| Mobile menu toggled the wrong classes | The script toggled `.open`/`.active`; the stylesheet keys the panel off `.show` and the hamburger off `.open`. **The mobile menu never opened**, while reporting `aria-expanded="true"` to screen readers. | Toggle the classes the stylesheet actually uses; Escape closes; browser test asserts the computed `display` changes |
| `[hidden]` never enforced in `site.css` | The attribute only sets `display:none` at user-agent weight, so any rule setting its own `display` silently overrode it. The gallery category filter appeared to do nothing (`.gallery-item{display:flex}`), the wizard's footer showed after a completed booking, and a dialog marked `hidden` covered the whole page and swallowed every click. | One `[hidden]{display:none!important}` rule, which `admin.css` had always had |
| `/book` in the sitemap | Advertised to crawlers for months; it has never been a route, so every crawl of it 404'd | Sitemap generated from real routes, with a test that fetches every `<loc>` and asserts 200 |
| `addressLocality` read from `area` | The structured data named the neighbourhood and omitted the town entirely, so nothing tied the clinic to "Talcher" — the word patients actually search | Town goes in `addressLocality`, neighbourhood joins the street address; `addressCountry` is now the ISO code, not "India" |
| `/api/cron` open when `CRON_SECRET` was unset | `if (secret && ...)` meant no secret configured = no authentication at all; anyone could drain the notification queue | Fail closed: require the secret, or Vercel's own unforgeable `x-vercel-cron` header |

Two recurring lessons. **An absent field must mean "leave alone"** — three of
these were variations of that. And **a stylesheet and the script that drives it
must agree**: the broken mobile menu and the inert `[hidden]` attribute both
passed every server-side test, because neither is observable from the server.
Browser-level checks now cover the menu, the dialog, the slider and the cards.

---

## 14. Known gaps

**Operational, before real patients**
- Default admin password must be changed
- HTTPS must be in front — patient names and phone numbers are otherwise in clear text
- No automated backup schedule; the database needs a snapshot policy (Neon has
  point-in-time restore; a self-hosted Postgres needs `pg_dump` on a timer)

**Product**
- Google review sync has no automatic schedule; it is manual or job-triggered
- Admin not screen-reader tested
- No patient-facing login or portal (lookup is by reference + phone)
- Vercel Hobby cron runs daily, so 2-hour reminders need an external pinger
- Single-clinic assumption throughout, though the schema permits multiple doctors

**Deliberately deferred** — the schema was shaped so none of these require a
rewrite: online payments, prescriptions, treatment plans, invoices, clinical
records, multi-branch, Google Calendar two-way sync, loyalty campaigns.

---

## 15. Conventions for contributors

- **Routes** contain no SQL. **Repositories** contain no business logic.
  **Services** never touch `req`/`res`.
- Every new admin write gets an `audit()` call and a zod schema.
- Partial updates use `partialUpdate(schema)` — never bare `.partial()`.
- Client-side validation is UX; the server re-validates unconditionally.
- New notification channels implement the provider interface; controllers emit
  events and never call a provider directly.
- Comments explain **why**, not what. The codebase favours a short note on a
  non-obvious constraint over narrating the obvious.
- Run `npm test` before committing. The concurrency test is slow (~6s) and is
  the one most worth keeping green.
