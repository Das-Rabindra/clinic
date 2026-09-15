# Samal Dental Care — Website & Clinic Platform

Public dental-clinic website, patient appointment booking, and a clinic
management console — one deployable Node.js application.

The original single-file design is preserved at `legacy/index.original.html`.
Its CSS, typography, palette and markup carry over intact; what changed is
everything behind them.

---

## Quick start

### Docker (recommended)

Brings up PostgreSQL and the app together.

```bash
cp .env.example .env
# REQUIRED — generate both secrets:
echo "APP_SECRET=$(openssl rand -hex 32)"        >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
# Optional: create the first admin on first boot
echo "SEED_ADMIN_EMAIL=you@example.com"    >> .env
echo "SEED_ADMIN_PASSWORD=a-long-password" >> .env

docker compose up -d --build
```

### Vercel

**Set these before the first request, or every route returns 500.** The app
refuses to boot without them rather than inventing an ephemeral key that would
make stored credentials unreadable after each cold start.

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Storage → **Neon Postgres** integration (set automatically) |
| `BLOB_READ_WRITE_TOKEN` | Storage → **Blob** store (set automatically) |
| `APP_SECRET` | `openssl rand -hex 32` — add manually |
| `PUBLIC_URL` | e.g. `https://your-project.vercel.app`. Optional on Vercel — derived from the deployment's own hostname when unset. Set it once a custom domain is attached. |
| `CRON_SECRET` | `openssl rand -hex 16` — protects `/api/cron`. Optional on Vercel: without it only Vercel's own scheduler is accepted. Required for any external pinger. |

Add them under **Settings → Environment Variables** for the Production
environment, then **redeploy** — environment changes do not apply to an
existing deployment.

`vercel.json` routes all traffic to `api/index.js` and registers the cron that
drains the reminder queue. Migrations run on the first request behind a
Postgres advisory lock, so concurrent cold starts are safe.

Website → http://localhost:8090 · Admin → http://localhost:8090/admin

### Without Docker

Needs a PostgreSQL instance.

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/clinic
export APP_SECRET=$(openssl rand -hex 32)
npm run create-admin      # interactive; prompts for email and password
npm start
```

`npm test` runs the full suite (92 tests, including the concurrency and
consent-gate tests). It needs a Postgres it can create databases on:

```bash
docker run -d --name clinic-pg -e POSTGRES_PASSWORD=devpass \
  -p 55432:5432 postgres:16-alpine
```

---

## What it does

**Patients** browse services, photos, hours and genuine Google reviews; check
live availability; book through a five-step wizard; get a booking reference; add
the visit to their calendar; and look up, or cancel, a booking with their
reference plus mobile number.

**The clinic** signs in at `/admin` and runs everything without touching code:

| Area | Capability |
|---|---|
| Dashboard | Today's list, pending queue, counts, enquiries, failed notifications, quick actions |
| Appointments | Day/week/month calendar, filterable list, confirm · reschedule · cancel · check-in · complete · no-show, walk-in booking |
| Patients | Directory searchable by name, mobile or patient ID, with visit history |
| Enquiries | Lead pipeline: new → contacted → converted, one-click convert to patient |
| Website | Homepage copy, services, gallery, reviews, FAQs |
| Clinic | Details, address & map pin, weekly hours, holidays, blocked time, doctors |
| System | Notification log with retry, integrations, admin users, SEO, audit log |

---

## Documentation

| Document | What it covers |
|---|---|
| **[PROJECT.md](PROJECT.md)** | Full reference — architecture as built, data model, APIs, UI/UX design system, security, testing, deployment, known gaps |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The original pre-implementation plan and phase breakdown |
| README (this file) | Quick start and day-to-day operations |

## Architecture

Node 22 · Express 5 · PostgreSQL · EJS · zod · sharp · vanilla ES modules.
No build step. Runs both as a long-running server (Docker) and serverless
(Vercel) from one codebase. See **[PROJECT.md](PROJECT.md)** for the full design.

```
src/
  config/         env + domain constants (the only place process.env is read)
  db/             connection, migrations, seed
  repositories/   every SQL statement in the codebase
  services/       availability · appointments · notifications · google · media · seo
  jobs/           durable queue + reminder/sync handlers
  middleware/     auth · csrf · rate limit · validation · security headers · errors
  routes/         public SSR, public API, auth API, admin API
  views/          EJS templates (public site + admin shell)
public/           site.css (original design), admin.css, client JS, logo assets
test/             availability · booking · security · concurrency · media · api
```

### Two guarantees worth knowing about

**Double booking is impossible.** Each appointment materialises one row per slot
it occupies in `appointment_slots`, under `UNIQUE(doctor_id, date, slot_min)`,
inside a `BEGIN IMMEDIATE` transaction. The constraint — not application code —
is what stops the race. `test/concurrency.test.mjs` proves it with 16 separate
OS processes competing for one slot: exactly one wins.

**A notification outage cannot lose an appointment.** Booking commits first;
messages are queued rows drained by a background worker. If WhatsApp is down or
unconfigured, the appointment still exists, the notification is recorded as
`failed` or `not_configured` with the provider's error, and the admin gets a
Retry button. Delivery never blocks booking.

---

## Going live: what needs credentials

Everything below is fully implemented; each just needs the clinic's own account
details, entered in **Admin → Settings → Integrations** (never in code).
Until then the app runs normally and reports each integration as
*not configured* rather than pretending to work.

| Integration | What to supply | Without it |
|---|---|---|
| **WhatsApp Cloud API** | Phone number ID + permanent access token from Meta, and approved message templates named `booking_received`, `appointment_confirmed`, `reminder_24h`, `reminder_2h`, `rescheduled`, `cancelled`, `follow_up`, `new_appointment_admin` | Bookings work; messages queue as `not_configured` and can be retried once configured |
| **Google Business Profile** | OAuth client ID + secret (Google Cloud), with the redirect URI shown on the Integrations screen, then connect and pick the clinic location | Reviews section shows its honest empty state |
| **SMTP** | Host, port, username, password | Email is skipped; WhatsApp and the dashboard still work |
| **Domain** | Set `PUBLIC_URL` and the website URL in Clinic Information | Canonical/OG tags follow the deployment host, not the custom domain |

Reviews are only ever displayed if the API actually returned them, and
`AggregateRating` structured data is emitted only when real synced reviews
exist — no invented ratings, no scraped HTML.

---

## Patient photo privacy

Treatment photographs are handled deliberately:

- Publishing anything in the **Patient work** category requires an explicit
  consent confirmation, recorded with who confirmed it and when.
- This is a `CHECK` constraint in the schema, so it holds even against a direct
  database write — not just a UI check.
- Withdrawing consent unpublishes the photo immediately.
- Every upload is re-encoded, which strips **all EXIF including GPS**.
- The admin UI steers titles toward `Before & After — Smile Restoration` rather
  than patient names, and consent metadata is never exposed publicly.

---

## Operations

```bash
docker compose logs -f app                              # logs
docker compose exec app node scripts/create-admin.js    # add an admin
docker compose exec db pg_dump -U clinic clinic > backup-$(date +%F).sql
```

Backups are two volumes: `clinic-pgdata` (the database) and `clinic-uploads`
(media). On Vercel, Neon provides point-in-time restore.

### Behind a reverse proxy

Set `TRUST_PROXY=true` and `PUBLIC_URL=https://your-domain` so secure cookies,
canonical URLs and the OAuth redirect are correct. Terminate TLS at the proxy.

---

## Security summary

scrypt password hashing · session tokens stored only as SHA-256 hashes ·
httpOnly + SameSite cookies with sliding and absolute expiry · account lockout ·
CSRF on every state-changing route · per-IP rate limits on login, booking and
enquiries · zod validation on every input · parameterised SQL throughout ·
output escaping including JSON-LD script-tag breakout protection · upload
magic-byte sniffing with re-encoding · AES-256-GCM encryption for integration
secrets at rest · role-based authorisation · full audit log.

Run `npm audit` — the dependency tree is clean.
