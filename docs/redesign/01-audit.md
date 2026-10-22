# Stage 1 — Codebase & UX audit

Status labels:

- **[V]** verified, in code and/or the browser
- **[B]** needs a real-device or browser check
- **[O]** needs owner confirmation

Baseline evidence is in `00-baseline.md`.

---

## 1. Architecture summary

| | |
|---|---|
| Runtime | Node 22, Express 5, ES modules. **No build step**; the code that ships is the code that runs |
| Rendering | Server-rendered EJS (`src/views/public/*`). Progressive-enhancement vanilla JS (`public/js/site.js`, `public/js/booking.js`) |
| Styling | One hand-written stylesheet, `public/css/site.css` (1,213 lines). CSS custom properties in `:root`. No preprocessor, no Tailwind, no CSS modules |
| Fonts | Self-hosted woff2 in `public/fonts/`: Fraunces (display), Inter (body), IBM Plex Mono (data labels). `font-display: optional` with metric-matched fallbacks |
| Data | PostgreSQL via `pg`. All SQL lives in `src/repositories/`. Content (copy, hours, phones, services, FAQs) **lives in the DB** and is admin-editable at `/admin` |
| Content migrations | `src/db/seed.js` (first boot) and `src/db/content.js` (idempotent copy corrections applied on boot) |
| Deploy | Vercel: everything is rewritten to `api/index.js`, plus a daily cron at `api/cron.js`. Docker Compose is an alternative |
| Media | Vercel Blob (`*.public.blob.vercel-storage.com`). Uploads are re-encoded to WebP by `sharp` |
| Tests | `node:test`, 153 tests, each file on its own throwaway Postgres DB. **No browser tests** |
| Icons | Inline SVG paths, hand-written, stroke-based (24×24 viewBox). No icon library |

The prompt mentions "next/font" and "the framework's font loader". This is not
a Next.js app. The equivalent here is self-hosted woff2 + `@font-face` in
`public/fonts/fonts.css` + `<link rel=preload>` in `partials/head.ejs`, and that
pattern already exists.

**Single source of truth for clinic facts already exists.** It is the
`clinic_settings` and `clinic_hours` tables, exposed through
`services/clinic.view.js → publicClinic()`. Every template, `/api/clinic`,
`/api/hours`, the FAQ `{{placeholders}}` and the JSON-LD
(`seo.service.js → openingHours()`) read from it. Remaining leaks are hard-coded
**prose** and are listed in §11.

## 2. Route & component inventory

### Public pages (`src/routes/public.routes.js`)

| Route | Template | Notes |
|---|---|---|
| `/` | `index.ejs` | Header → Hero → Urgent band → Credential strip → About → Clinic story → Treatments (6 featured + "Also treated") → Gallery → Testimonials + review QR → FAQ → Booking → Location → CTA band → Footer |
| `/services` | `services.ejs` | All active treatments (`treatment-grid` partial). Breadcrumb + ItemList JSON-LD |
| `/services/:slug` | `service.ejs` | Hero, What it is, When needed, What to expect, Benefits, sticky contact card, per-treatment FAQ, related, CTA. 404 for unknown or unpublished slugs |
| `/privacy` | `privacy.ejs` | Privacy & appointment policy |
| `/robots.txt`, `/sitemap.xml`, `/healthz` | generated | Sitemap is built from real routes and tested |
| 404 / error | `404.ejs`, `error.ejs` | |
| `/admin/**` | `admin/app.ejs` + `public/js/admin/**` | **Out of scope.** Must not regress |

### Partials

| Partial | Content |
|---|---|
| `head` | Meta, OG, geo, font preloads, JSON-LD |
| `header` | Brand, primary nav, phone, Book, hamburger + `#mobilePanel` |
| `footer` | Includes `action-rail` |
| `action-rail` | Desktop rail, `.mobile-bar`, call-back modal |
| `treatment-grid` | Treatment cards |
| `treatment-art` | Per-treatment SVG fallbacks, used when a card has no photo |
| `review-qr` | Review QR card |
| `social` | Social links |

### Public JSON API (`src/routes/api/public.routes.js`)

- `GET csrf | clinic | hours | services | doctors | faqs | gallery | reviews`
- `GET appointments/availability`
- `GET appointments/calendar`
- `POST appointments`
- `GET appointments/:ref?phone=`
- `GET appointments/:ref/calendar.ics`
- `POST appointments/:ref/cancel`
- `POST enquiries`

### Client modules

`site.js` covers:

- nav
- FAQ accordion
- gallery filter + lightbox
- lazy map
- testimonial slider
- call-back modal
- `data-track` hook, which fires only if `gtag` or `dataLayer` exists (neither
  is installed)
- scroll reveal

`booking.js` is the 5-step wizard.

## 3. Current visual system

| | Values |
|---|---|
| Colour | `--ink #26302C`, `--pine #1F3D3A`, `--pine-700 #16302D`, `--sage #7C9885`, `--sage-text #597161`, `--honey #C79A4B`, `--honey-700 #AD8138`, `--paper #FAF8F3`, `--paper-dim #F1EDE4`, `--line #E4DFD3`, `--white`. Urgent band `#8C2A1C`. Many un-tokenised literals (`#7C8A78`, `#8A948A`, `#4B564F`, `#5B665A` …) |
| Type | Fraunces 400–700 (headings), Inter 400–700 (body), IBM Plex Mono 500 (eyebrows, times, refs, phone). Fluid `clamp()` h1 36–58 px, h2 28–42 px. Many one-off sizes (10.5, 11.5, 12.5, 14.5, 16.5 px) |
| Radius | `--radius-s 6`, `--radius-m 10`, `--radius-l 22`. Buttons are full pills (999 px) |
| Shadow | `--shadow-s`, `--shadow-m`, `--shadow-l`: three levels plus ad-hoc ones |
| Motion | `--dur-s 180ms`, `--dur-m 420ms`, one easing. Reveal-on-scroll. Card image zoom on hover. All disabled under reduced motion |
| Breakpoints | 400, 520, 560, 600, 640, 680, 760, 900, 980 px. **Nine distinct values**, no scale |
| Layout | `--maxw 1180px` |
| theme-color | `#1F3D3A` |

## 4. Booking state machine (`public/js/booking.js` ↔ `appointment.service.js`)

```
state.step: 0 Treatment → 1 Date → 2 Time → 3 Details → 4 Confirm → result
```

**Step 0 — Treatment.** Choices come from `data-services` (SSR JSON),
filtered to `bookable`. Continue is enabled once one is selected.

**Step 1 — Date.**

- Calls `GET /api/appointments/calendar?days=60&service_id=`.
- Returns `days[] {date, open, available_count}`.
- Days with no free slots are rendered `disabled`.
- Month navigation is clamped to the available range.

**Step 2 — Time.**

- Calls `GET /api/appointments/availability?date=&service_id=`.
- Returns `slots[] {time, label, available}`. **The client keeps only
  `available` slots**, so unavailable or disabled slots are never shown at all.
- Slots are grouped Morning (< 12), Afternoon (< 16) and Evening.
- "No times are left on this date" is the empty state.

**Step 3 — Details.**

- Fields: name (≥ 2 chars), Indian mobile (`[6-9]\d{9}` or `91…`), optional
  email, optional message, new/returning toggle.
- Validation is client-side, for UX only. The server re-validates with zod.

**Step 4 — Confirm.**

- `POST /api/appointments` with the CSRF header from the `sdc_csrf` cookie, or
  from `GET /api/csrf`.
- `state.busy` plus the disabled button guard against double submission
  (verified locally: two clicks produced one appointment).

**Server-side handling** (`validateSlot()`, then a transaction):

- The patient is upserted by phone.
- The appointment is created as `pending`, or `confirmed` when auto-confirm is
  on.
- `appointment_slots` has a `UNIQUE(doctor_id, date, slot_min)` constraint.
  On collision the server returns **409 `SLOT_TAKEN`**.
- Other error codes: `SLOT_UNAVAILABLE`, `RATE_LIMITED` (booking 6/h/IP),
  `CSRF`, and validation errors with `{fields}`.

**Error handling in the wizard.**

- `SLOT_TAKEN` and `SLOT_UNAVAILABLE` send the patient back to step 2, show a
  message and reload slots. Entered details are kept in `state`.
- Any other error shows an alert at the top of the body; the patient stays on
  Confirm.

**Result screen.**

- Shows "Appointment confirmed" or "Appointment requested", the reference
  (`SDC-YYYY-NNNNN`), date, time, service and dentist.
- Actions: Add to Calendar (`/api/appointments/:ref/calendar.ics?phone=`) and
  Book another.
- The WhatsApp button never renders (`__SDC_WHATSAPP` is unset) [V].

**Cancellation** exists in the API (`POST /api/appointments/:ref/cancel`, which
needs the reference + phone + CSRF) and is covered by tests. **There is no
public UI that calls it** [V]. The FAQ says "use it with your mobile number to
cancel online", and `privacy.ejs:54` says the same ("You can cancel online using that reference").

**Rescheduling** is admin-only. Patients cannot reschedule [V].

**Time zone:** `Asia/Kolkata`, from `clinic_settings.timezone`. Conversion
happens only in `src/utils/time.js` [V].

## 5. Call-back form

This is the modal in `action-rail.ejs`, driven by `site.js`.

- Fields: name, mobile, optional message, a "phone / WhatsApp" preference, and
  a hidden `service_id`.
- Submits `POST /api/enquiries` (CSRF, rate limit 5/h/IP). The request lands in
  Admin → Enquiries.
- Success swaps in a "Request received" panel. Errors map from `fields`, with a
  generic fallback ("No connection. Please call the clinic instead.").
- Accessibility gaps [V]:
  - no initial focus
  - no focus trap
  - no `aria-invalid` / `aria-describedby`
  - no live region
- Mobile entry point is only the small call icon on treatment cards [V].
- Contact links: see `00-baseline.md §4 Links`. All are correct and plain.

## 6. Data, integrations, env var names

Env var names only:

- Core: `DATABASE_URL`, `APP_SECRET`, `PUBLIC_URL`, `TRUST_PROXY`, `PORT`,
  `NODE_ENV`, `RUN_JOBS`, `JOB_POLL_MS`, `CRON_SECRET`
- Storage: `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN`, `UPLOAD_DIR`,
  `MAX_UPLOAD_MB`
- Seeding: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
- WhatsApp: `WHATSAPP_*`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Email: `SMTP_*`, `MAIL_FROM`
- Reminders: `REMINDER_24H`, `REMINDER_2H`

Third parties on public pages:

- Google Maps embed iframe, lazy-loaded
- Google review link
- Instagram link
- `googleusercontent` images allowed by CSP for review avatars

There are no analytics scripts.

CSP is strict:

- `script-src 'self' 'unsafe-inline'`
- `font-src 'self'`
- `frame-src` limited to Google and OSM
- **New external font or CDN requests would be blocked.** Fonts must be
  self-hosted.

## 7. Loading / error / empty / no-JS states

| Area | State |
|---|---|
| Booking | Spinner while loading, though it has no accessible name in steps 1–2 [V]. Error alert, "No times left" empty state, `<noscript>` call/WhatsApp fallback ✔ |
| Reviews | Honest empty state + QR ✔ |
| Gallery | Empty state ✔. **But see the known issues: one image still renders Prev/Next inside the lightbox** |
| FAQ without JS | Answers stay open (the `html.js` class gate) ✔ |
| Treatments empty | Call fallback ✔ |
| Map | The iframe has a `title` ✔. Nothing is shown before it loads |

## 8. Accessibility

Good already:

- skip link
- one h1 per page
- `aria-expanded` on menu + FAQ
- Esc on menu, lightbox and modal
- focus returned to the trigger
- `prefers-reduced-motion` honoured
- real labels
- `aria-pressed` on choices

Gaps [V]:

1. **Focus ring is honey `#C79A4B` on paper, 2.43:1.** It fails WCAG 1.4.11
   (needs 3:1).
2. **Input and choice borders use `--line #E4DFD3`, 1.33:1 on white.** Form
   fields and slot outlines are close to invisible to low-vision users.
3. Secondary text fails 4.5:1:
   - `#7C8A78` on white is 3.64
   - `#8A948A` is 3.14
   - footer `(alt)` is flagged by Lighthouse
4. Mobile menu: no focus trap, and the label doesn't update.
5. Call-back modal: no initial focus, no trap, errors not associated.
6. Booking wizard:
   - no focus management between steps
   - no live region for async status or errors
   - field errors not linked with `aria-describedby`
   - the calendar's accessible name is an ISO date ("2026-10-23, 22 slots")
   - S/M/T/W headers are ambiguous
   - spinner has no label
7. Heading order: footer `h4` after `h2`; `/services` card `h3` directly after
   `h1`.
8. Sticky header (79 px). `#faq` lands at 324 px, so it is not obscured. **No
   `scroll-padding-top` is set**, so focus moving to an element right under the
   header could hide behind it (WCAG 2.4.11) [B].
9. Gallery: a lone image is still a `<button>` that opens a lightbox with
   Previous/Next.
10. Treatment card image alt text starts "Illustration: …". These are licensed
    stock **photographs and 3D renders**, not illustrations, so the label is
    inaccurate [V]. The gallery item's alt is "Illustration: opening day", but
    it is a **promotional "Grand Opening" poster** with the dentist's photo,
    not a clinic photograph [V].

## 9. SEO

- Titles, descriptions, canonical, OG, `geo.*` meta.
- JSON-LD:
  - `Dentist` with `openingHoursSpecification`, split around the break,
    generated from `clinic_hours` ✔
  - `Physician`
  - `OfferCatalog`
  - `FAQPage`
  - `BreadcrumbList` on `/services` and detail pages ✔
- `AggregateRating` is emitted **only** when Google-synced reviews exist.
  Currently there are none, so it is not emitted ✔ [V].
- Sitemap and robots are generated from real routes.
- Images: card images are 1280 px WebP with no `srcset`/`sizes` [V]. The
  gallery thumb is 480 px. Explicit width and height are set ✔.

## 10. Mobile risks

- **Fixed bottom bar can cover booking controls** [V by hit-test; B on device].
  It does not hide when the keyboard is open or when the booking form is in
  view. There is no `env(safe-area-inset-bottom)` padding [V: grep finds no
  `safe-area` in `site.css`].
- Call-back is hard to reach on phones (card icon only).
- Hero at 390 px: the trust row sits below the CTAs and the image comes after
  that, which makes a long first screen.
- Nine ad-hoc breakpoints make regressions likely between 400 and 980 px.
- On-screen keyboard behaviour [B].

## 11. Business facts: every occurrence

**Source of truth:** `clinic_settings` / `clinic_hours` (DB). Live values from
`/api/clinic`:

| Field | Live value |
|---|---|
| Phone (main + WhatsApp) | 8847879686 |
| Second phone | 9124839288 |
| Address | Annapurna Market Complex, Bikrampur, FCI Township, Talcher, Odisha 759106 |
| Coordinates | 20.9033969, 85.1743727 |
| Doctor | Dr. Sonali S. Samal |
| Qualification | BDS, FRCD |
| Institution | Kalinga Institute of Dental Science, Bhubaneswar |
| Registration | Regd. No. 3209-A |
| Languages | English, Hindi, Odia |
| Hours | every day 09:00–22:00, **break 13:00–15:00** |

Seeded or corrected in `src/db/seed.js:24-42,69` and `src/db/content.js:66-95,524-559`.

Hard-coded prose that does not read from the source of truth, so it can drift:

| Where | Text | Conflict |
|---|---|---|
| `index.ejs:92` | "open until {{today.close}} **every day**, and keeps time free for urgent problems". Fallback literal `'10:00 PM'` | Omits the break. "Every day" is asserted in prose, not derived. Unverified claim |
| `index.ejs:442-443` (hours table) | prints `open – close` only | **Omits the 1–3 PM break**, which the data has, the FAQ states and the slot engine enforces [V] |
| `content.js:285,288` (Emergency service) | "open until 10 PM every day, including Sunday, and keeps room for urgent cases" / "Same-day appointments kept free for urgent problems" | Literal hours, plus an unverified claim |
| `content.js:289-290` (Emergency SEO title/desc) | "Open till 10 PM" | Literal |
| `content.js:454` (service FAQ) | "time is kept free each day… open until 10 PM every day including Sunday" | Literal, unverified claim |
| `content.js:662` | "8:00 AM to 9:00 PM" | This is a `when:` match string used to replace old copy, not displayed [V] |
| Hero lede, about, footer, credential strip, hero trust row | Credentials read from settings ✔ | But the hero region shows **BDS, FRCD 3×**, **Regd. No. 3× and Institution 2×** (hero lede, hero trust row, credential strip). The footer repeats them twice more |
| `seed.js:92-112` | "Vikrampur" spelling | Seed defaults only; production was corrected to "Bikrampur" by `content.js` [V on live] |

**Emergency instructions:**

- the urgent band
- `/services/dental-emergency`
- the FAQ "Please do not send anything urgent by message — call instead"

There is no out-of-hours instruction (what to do after 10 PM) [O].

## 12. Known issues: verification

| # | Issue | Verdict |
|---|---|---|
| 1 | Hours conflict | **[V] Confirmed, partly.** Data, FAQ and slot engine agree: break 1–3 PM. The **hours table template omits the break**, and the hero urgent band says "open until 10 PM every day" without mentioning it. This is a template bug plus prose, not a data conflict. Whether the break is real is [O] |
| 2 | Mostly illustrations | **[V]** Card and hero images are licensed stock photos or 3D renders, labelled "Illustration:" by `content.js:585-611`. Real: the dentist portrait. The single gallery item is a promotional poster, not a clinic photo |
| 3 | Gallery: 1 image + Prev/Next | **[V]** The grid shows one card. Clicking it opens a lightbox with Prev/Next and a "1 / 1" counter |
| 4 | Testimonials empty | **[V]** `/api/reviews` returns `count: 0`. Honest empty state + QR |
| 5 | Two mobile bars | **[V] Not a duplicate.** The rail shows at ≥ 900 px and the bottom bar at < 900 px, never together at any test width. But they offer **different actions**: rail = Appointment / Call-back / WhatsApp; bar = Call / WhatsApp / Book |
| 6 | "Call Now" not tel: | **[V] False.** Every call action is `tel:+918847879686`. The second line `tel:+919124839288` is shown only in the booking side panel and the footer |
| 7 | Credentials repeated | **[V]** See §11 |
| 8 | Unverified claims | **[V] present.** "modern equipment" (clinic story), "experienced dentist" (about title), "keeps time free for urgent problems" (urgent band + emergency page), "Safe removal" (extraction), "reserve one instantly" (FAQ). Also found: "Same-day appointments kept free", "Modern dental care" (H1), "attentive, modern care" (CTA), "seen the same day where possible" (emergency short desc) [O] |
| 9 | Hash nav from /services/* | **[V] Works.** `navBase='/'` prefixes every hash link |

## 13. Booking test safety

- Vercel deployments for this repo (GitHub Deployments API): **only
  `Production` environments exist. No preview has ever been built.** So it is
  unknown whether a preview would get `DATABASE_URL`.
- If `DATABASE_URL` is scoped to Production only, a preview fails closed: the
  app refuses to boot and returns 500.
- If it is shared across environments, which is the Neon integration default
  unless branching is enabled, **a preview writes to the production database.**
  Assume this until proven otherwise [O].
- **Safe approach (adopted):**
  1. All booking and call-back testing uses a **local isolated Postgres**
     (`docker clinic-pg`, DBs `sdc_local` / per-test), where real POSTs are
     harmless.
  2. Any browser test against a Vercel preview or production uses **Puppeteer
     request interception**. Every non-GET is either aborted or fulfilled with a
     mock response. The Stage 0 scripts already did this.
  3. Never press Confirm or Request on a deployed URL.
- Local test bookings made during this audit: 2, in `sdc_local` only.

## 14. Prioritised issues

**Critical**

- C1 [V/B]: The fixed mobile bar can cover the booking Continue/Confirm
  button. It does not yield to the keyboard or the form, and there is no
  safe-area padding.
- C2 [V]: The FAQ promises online cancellation, but no public cancel UI exists.
  Either build the UI on the existing API (Stage 5, no backend change) or
  correct the FAQ [O].

**High**

- H1 [V]: Hours table omits the break; the urgent band prose omits it too.
- H2 [V]: Focus ring 2.43:1, form borders 1.33:1, secondary text below 4.5:1.
- H3 [V]: Modal and menu: no focus trap, no initial focus, errors not
  announced.
- H4 [V]: Booking wizard: no focus management, no live region, errors not
  associated, ISO-date labels.
- H5 [O]: Unverified marketing claims (§12 #8).
- H6 [V]: Image provenance. Alt text "Illustration:" on photos; a promo poster
  sits in "Inside the clinic".

**Medium**

- M1 [V]: LCP 2.8 s on `/` and 3.3 s on `/services`. No `srcset` on 1280 px card
  images.
- M2 [V]: Credentials repeated 3× in the hero region.
- M3 [V]: Single gallery image opens a lightbox with Prev/Next.
- M4 [V]: Call-back is hard to reach on mobile. The rail and the bar offer
  inconsistent actions.
- M5 [V]: WhatsApp button missing on booking confirmation (`__SDC_WHATSAPP`
  never set).
- M6 [V]: Heading-order failures (footer `h4`, `/services`).
- M7 [V]: Nine ad-hoc breakpoints and many un-tokenised colours and sizes.
- M8 [B]: No `scroll-padding-top` with a sticky header.

**Low**

- L1: Docs claim browser tests exist (they don't). L2: `npm audit` reports 5
  vulnerabilities. L3: Duplicate "No ORM" row in PROJECT.md. L4: Booking
  spinner has no accessible name.

## 15. Files likely to change

| Stage | Files |
|---|---|
| 2 | `public/css/site.css` (tokens + primitives, staged refactor), `public/fonts/*` + `fonts.css` (Lora), `partials/head.ejs` (preloads, theme-color), a new noindex `views/public/styleguide.ejs` + route, `docs/redesign/design-tokens.md` |
| 3 | `index.ejs`, `partials/header.ejs`, `footer.ejs`, `action-rail.ejs`, `treatment-grid.ejs`, `site.js` (menu trap, modal trap, bar visibility), `public.routes.js` (view-model only: e.g. hours-with-break labels, gallery count). Owner-approved copy via `content.js` |
| 4 | `services.ejs`, `service.ejs`, `treatment-grid.ejs`, possibly `seo.service.js` (breadcrumb already present) |
| 5 | `booking.js`, booking CSS. Possibly a new "Manage booking" panel using the existing lookup and cancel API. **No server change planned** |
| 6 | Fixes only |
| Tests | New `test/browser/*.test.mjs` (Puppeteer against a local server + isolated DB) |

## 16. Refined plan for Stages 2–6

- **Stage 2.**
  - Introduce semantic tokens alongside the existing ones, then migrate
    component by component so the site never breaks mid-stage.
  - Add Lora (self-hosted woff2, latin + latin-ext, 400/500/600, plus italic
    if needed) and keep Inter.
  - Decide on IBM Plex Mono (see decisions).
  - Collapse the breakpoints to 480 / 768 / 1024 / 1280.
  - Build the primitives and a noindex `/_styleguide` route, excluded from the
    sitemap and gated to non-production or behind the admin session (decision
    needed).
  - Add a Puppeteer browser-test harness (local server + isolated DB).
- **Stage 3.** Homepage per spec, plus:
  - one consistent action bar (Book / Call / WhatsApp on mobile, with call-back
    reachable)
  - bar auto-hides while booking or the keyboard is active
  - safe-area padding
  - hours table with the break
  - single trust row
  - conditional gallery
- **Stage 4.** Listing + detail restyle. Breadcrumbs + JSON-LD already exist,
  so restyle and keep. Add `srcset` using the existing derived sizes where the
  media service already produces them (verify; no new image pipeline).
- **Stage 5.** Wizard accessibility + visual pass; slot-state styling. Optional
  "Find / cancel my booking" UI on the existing API, if the owner wants online
  cancellation kept. Tests mocked with Puppeteer interception plus real runs
  against the local DB.
- **Stage 6.** QA per spec.

## 17. Regression checklist (run every stage)

- [ ] `npm test`: 153+ pass
- [ ] Every route returns 200 (`/`, `/services`, all 15 `/services/*`, `/privacy`, `/sitemap.xml`, `/robots.txt`). An unknown slug returns 404
- [ ] Every `<loc>` in the sitemap returns 200
- [ ] Nav hash links work from `/` and from `/services/*`
- [ ] Every `tel:` is `+918847879686` or `+919124839288`. WhatsApp is `wa.me/918847879686`. Directions and review URLs are unchanged
- [ ] Booking (local DB): full flow → reference shown; `SLOT_TAKEN` path; validation; duplicate-submit guard; ICS link
- [ ] Deep link `/#appointment?treatment=<slug>` preselects
- [ ] Call-back (local DB): validation; success; enquiry appears in admin
- [ ] Mobile menu opens/closes, Esc, focus return. Exactly one action bar per width
- [ ] No horizontal overflow at 320–1920. One h1 per page. No console errors
- [ ] JSON-LD valid. No `AggregateRating` while there are 0 Google reviews. `openingHoursSpecification` split around the break
- [ ] FAQ without JS shows answers. Booking `<noscript>` fallback present
- [ ] Lighthouse (mobile, median of 3) not worse than baseline
- [ ] Admin login + dashboard still load (shared `site.css`? No: admin uses `admin.css`. Verify the admin is untouched)
