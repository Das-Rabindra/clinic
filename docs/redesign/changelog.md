# Redesign changelog

## Stages 0–1: Baseline + audit (branch `redesign/stage-1-audit`)

**Files changed:** `docs/redesign/*` only. No source, template, style, schema
or config changes.

**Checks run:**

- `npm ci`: OK. Audit reports 5 vulnerabilities.
- `npm test`: 153/153 pass, run against a local throwaway Postgres.
- Lighthouse mobile ×4 pages: see `00-baseline.md`.
- Puppeteer layout probe: 4 pages × 8 widths, no overflow, no console errors.
- Behaviour scripts on production with all non-GET requests aborted.
- Booking checks on a local isolated DB: 2 test bookings in `sdc_local`.

**Open issues:** see `01-audit.md §14` and `owner-questions.md`.

**Rollback:** documentation only. Delete the branch, or revert the single
commit.

## Stage 2: Design system and primitives (pushed to `main`)

**Files added**

- `public/css/ds.css`: tokens, base styles, primitives
- `public/js/ds.js`: menu, accordion, dialog, action bar, form-validation
  pattern
- `public/fonts/lora-var-latin{,-ext}.woff2`
- `public/fonts/LICENSES.md`
- `src/utils/design-tokens.js`: token parser, WCAG contrast, contrast rules
- `src/views/public/styleguide.ejs`
- `test/design-tokens.test.mjs`
- `test/styleguide.test.mjs`

**Files changed**

- `src/routes/public.routes.js`: adds the `GET /_styleguide` route, noindex,
  unlinked
- `docs/redesign/{design-tokens,decisions,changelog}.md`

**Not changed:** every live page, `site.css`, `site.js`, `booking.js`, the
templates patients see, backend, schema, env.

**Checks run**

- `npm test`: **203/203 pass** (153 existing + 39 contrast + 11 styleguide).
  The styleguide tests include 8 real-Chromium browser checks: overflow at
  360/768/1440, menu focus trap, dialog trap and focus return, form error
  pattern, no-JS accordion, reduced motion.
- Puppeteer screenshots at 360/768/1440, plus menu, dialog and form-error
  shots, in `/home/ravi/clinic-redesign-artifacts/stage-2/`.
- No console errors and no horizontal overflow at any width.
- Asset sizes (gzip): `ds.css` 8.8 kB, `ds.js` 2.8 kB, Lora latin 38 KB.

**Open items**

- Owner questions 1–9 are still unanswered.
- D3, D4 and D13 need confirmation at Gate 2.
- The Lora fallback metrics (`size-adjust 106%`) are estimated: no Georgia
  install was available to measure against. With `font-display: optional`
  this cannot cause layout shift, but it should be checked on a device with
  slow first paint.

**Rollback:** `git revert <stage-2 commit>`. Nothing live depends on these
files.

## Stage 3: Homepage (pushed to `main`)

**What patients see on `/` now**

- New system throughout: Lora + Inter, teal primary, ivory background.
- Header: brand, nav, phone at ≥1280 px, and a Book button. On mobile, a menu
  drawer with focus trap, Esc to close, and Menu/Close label. It also offers
  Book, Call, WhatsApp and Request a call back.
- Hero:
  - the clinic's **real treatment-room photo** (served at 480/720/1086 px)
  - Book, Call and WhatsApp buttons
  - one compact trust row. The credential strip and the duplicate trust card
    are removed
- Urgent band: today's hours from the grid, break included. Calm styling.
- Dentist profile: portrait plus a facts list (qualification, institution,
  registration, focus, languages).
- "The clinic" bento:
  - the clinic's own story
  - hours summary (from the grid)
  - book online
  - languages
- Six featured treatments as interactive cards, each with Book and Request a
  call back. The "Also treated" list and "See all treatments" remain.
- Gallery laid out by photo count. Today that is 1 → a single figure with no
  controls.
- Testimonials: genuine-only empty state plus the review QR. A carousel
  appears once real reviews exist. No rating markup.
- FAQ: accessible accordion. Open without JavaScript, no flash on load.
- Booking: the existing wizard, unchanged logic, re-skinned. A side panel
  offers Call, WhatsApp and Call back as fallbacks.
- Location & contact bento:
  - address and directions
  - main line, second line, WhatsApp, call back
  - weekly hours table **with the break** (two sessions per day), today
    marked, open-now status
  - lazy map
- Final CTA in primary, and a new footer.
- **One** action bar below 1024 px (Appointment, Call, WhatsApp) with
  safe-area padding. It steps aside over the booking form and while typing.
  The desktop side rail is gone.

**Files**

- Added:
  - `public/css/{layout,home,booking}.css`
  - `public/js/site-ds.js`
  - `public/img/clinic/treatment-room-{480,720,1086}.webp`
  - `src/views/public/partials/{site-header,site-footer,quick-actions,icon}.ejs`
  - `test/home.test.mjs`
- Changed:
  - `src/views/public/index.ejs` (rewritten)
  - `partials/head.ejs`: design-system branch, deferred CSS, `ds-js` class set
    before paint, preload with `imagesrcset`
  - `src/routes/public.routes.js`: home view-model, `dayHours()`, clinic photo
  - `public/js/ds.js`: validation rules mirror the server; `ds:valid` event;
    bar pre-yield
  - `styleguide.ejs`
  - `test/pages.test.mjs`: 6 assertions retargeted to the new markup, same
    intent
  - `test/styleguide.test.mjs`
- Not changed:
  - other pages
  - `booking.js`
  - `site.js`
  - `site.css`
  - backend
  - schema
  - API
  - env

**Checks run**

- `npm test`: **218/218 pass**. That includes 15 new homepage tests, 5 of
  them in real Chromium:
  - the bar yields over booking and returns afterwards
  - Continue is never covered
  - the call-back dialog: focus, validation, trap, focus return
  - a call-back reaches the enquiries table
  - the menu drawer
- Local behaviour script (isolated `sdc_local` DB):
  - every `tel:` is `+918847879686` or `+919124839288`
  - WhatsApp is `wa.me/918847879686`
  - directions URL unchanged
  - all 9 anchors exist
  - booking end to end gave `SDC-2026-00003/4`
  - Continue reachable at every step, in 3 consecutive runs
  - deep link and card Book both open at Date
  - call-back works, including a mocked network failure that keeps typed
    values and moves focus to the error
  - no-JS: FAQ visible, booking `<noscript>` present
- Screenshots at 320/360/375/390/768/1024/1440/1920 in
  `/home/ravi/clinic-redesign-artifacts/stage-3/`. No horizontal overflow, one
  h1, no console errors at any width.
- Lighthouse on the local server (uncompressed, ×3): Perf 94, **A11y 100**
  (baseline 95), BP 100, SEO 100, CLS 0. LCP 2.9 s: the hero paragraph,
  render-delayed. Production numbers are recorded after deploy.

**Open items**

- Owner questions 1, 3, 4, 7 and 10 still shape copy. Flagged claims are kept
  verbatim (D23).
- The gallery's only item is still the promo poster, with alt text
  "Illustration: opening day" (owner question 4c).
- Treatment card images are still 1280 px with no `srcset`. The media
  pipeline has no mid-size variant; Stage 4 will look at this.

**Rollback:** `git revert <stage-3 commit>`. The homepage returns to
`site.css` and the old partials, which are still in the repo.

### Stage 3: verified on production after deploy (`55a8f74`)

**Lighthouse mobile, 3 runs (baseline from Stage 0 in brackets)**

| Metric | Now | Baseline |
|---|---|---|
| Performance | 100 / 96 / 100 | 96 |
| Accessibility | **100** | 95 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |
| LCP | **1.7–1.8 s** | 2.8 s |
| CLS | 0 | 0 |
| Page weight | **291 KiB** | 442 KiB |

The LCP element is the hero paragraph.

**Read-only behaviour on production** (every non-GET request aborted; the only
one attempted was Google Maps' own telemetry):

- The hero serves `treatment-room-480.webp` at 390 px.
- Urgent line: "open today 9:00 AM to 10:00 PM, closed 1:00 PM to 3:00 PM".
- The hours table marks today, with two sessions.
- Gallery: single figure.
- Reviews: empty state plus QR. No `AggregateRating`.
- The wizard's Continue button is reachable on steps 1 and 2.
- Live slots skip 1–3 PM.
- The action bar returns at the top of the page.
- The call-back form validates without sending.

**Screenshots** for all 4 pages × 8 widths are in
`/home/ravi/clinic-redesign-artifacts/stage-3/prod/`. No overflow, one h1 per
page.

- The first 320 px capture straight after the deploy logged a 504 and a 404:
  a cold start. Three repeat loads were clean, with the bar visible.
- Other pages are unchanged and still on `site.css`.

## Stage 4: Treatments listing, treatment pages, privacy, 404 (pushed to `main`)

**What changed for patients**

- `/services`:
  - page hero with breadcrumb and a consultation CTA (Book, Call, WhatsApp)
  - "All treatments" heading with a count
  - every active treatment as a card: category, description, detail link,
    **working Book link**, and Request a call back
  - a "Not sure what you need?" consultation section
- `/services/<slug>`, all 15 pages:
  - visible breadcrumb, with BreadcrumbList JSON-LD kept
  - hero with category, name and summary, appointment length, location, Book,
    Call, and Ask on WhatsApp (message pre-filled with the treatment)
  - image, with the stock disclosure kept
  - body sections: what it is, when it may be needed, what it generally
    involves, what it aims to do, what a consultation helps decide
  - sticky contact card: dentist, where, today's status, Book, Call back, Call
  - the treatment's own FAQs as an accordion
  - related treatments, "See all treatments", and a closing CTA
- `/privacy`: same text, new layout, ~66-character lines.
- 404 and error pages: on the new system.
- URLs, metadata, canonical tags and structured data are unchanged. No
  redirects.

**Bug fixed:** Book on `/services`, on related-treatment cards and on the 404
page did nothing. It was a `<button>` that only the homepage wizard listened
for. Verified on production before the fix. It is now a link that deep-links
into the wizard.

**Removed:**

- `public/css/site.css`
- `public/js/site.js`
- partials `header`, `footer`, `action-rail`, `treatment-grid`, `review-qr`

`fonts.css` and the Fraunces and Plex fonts stay because the admin console
uses them.

**Files**

- Added:
  - `public/css/pages.css`
  - `partials/treatment-card.ejs`
  - `partials/breadcrumbs.ejs`
  - `test/treatments.test.mjs`
- Rewritten: `services.ejs`, `service.ejs`, `404.ejs`, `error.ejs`.
- Migrated: `privacy.ejs`.
- Changed:
  - `index.ejs`: uses the shared card partial
  - `head.ejs`: design system only
  - `public.routes.js`: `ds` and `pageCss` defaults
  - `layout.css`: shared card, empty-state and CTA styles moved here
  - `home.css`
  - `README.md` and `PROJECT.md`: code map
  - tests: 6 assertions retargeted from `site.css` to `ds.css`, same intent

**Checks run**

- `npm test`: **230/230**. That includes 12 new treatment-page tests:
  - every active treatment listed with a working Book link
  - one h1 and no skipped heading level on all 15 detail pages
  - breadcrumb plus JSON-LD
  - Book, Call, WhatsApp and call-back present
  - no price anywhere
  - stock disclosure
  - in Chromium: Book on `/services` lands in the homepage wizard at Date,
    and there is no overflow or console error at 320 px on `/services`, a
    detail page and `/privacy`
- Local screenshots: 4 pages × 8 widths in
  `/home/ravi/clinic-redesign-artifacts/stage-4/`. No overflow, one h1, no
  console errors.

**Open:** owner question 11 (outcome wording in benefit lines) and D30 (card
image sizes).

**Rollback:** `git revert <stage-4 commit>` restores `site.css`, `site.js` and
the old partials.
