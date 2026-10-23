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

### Stage 4: verified on production (`a262112`)

**Lighthouse mobile, 3 runs each (Stage 0 baseline in brackets)**

| Page | Perf | A11y | LCP | Weight |
|---|---|---|---|---|
| `/services` | 98 / 98 / 100 (92) | **100** (94) | 2.4 / 2.4 / 1.5 s (**3.3 s**) | 346 KiB (443) |
| `/services/root-canal-treatment` | 98 / 99 / 99 (98) | **100** (95) | 2.3 s (2.4) | 176 KiB (223) |
| `/privacy` | 100 (100) | **100** (94) | 1.5 s (1.7) | 124 KiB (172) |

Best practices and SEO are 100 on every page. CLS is 0 on every page.

**Other checks**

- Every `<loc>` in the live sitemap returns 200. `/css/site.css` returns 404.
- 4 pages × 8 widths: no overflow, one h1 each, no console errors, and the
  action bar present below 1024 px. Screenshots are in
  `/home/ravi/clinic-redesign-artifacts/stage-4/prod/`.
- Read-only checks (non-GET requests aborted; none were attempted):
  - Book on a `/services` card lands in the homepage wizard at Date with
    that treatment chosen
  - the detail-page FAQ opens
  - the drawer takes focus
  - the call-back dialog opens from the detail page, carrying the treatment

## Stage 5: Booking UI (pushed to `main`)

The full map is in `05-booking.md`.

**Changed for patients**

- Calm five-step flow with a clear progress indicator: a numbered list on
  desktop; "Step 2 of 5 · Date" plus a bar on phones.
- Treatments are native radio cards. Descriptions are hidden on phones to
  keep the list short.
- Calendar:
  - readable day names
  - an "Earliest free time" shortcut (from the server's `next_available`)
  - full or closed days disabled and announced as such
- Times are grouped Morning, Afternoon and Evening, with large tap targets.
  The selected time shows a check mark and a 2 px border, not colour alone.
- Details:
  - inline errors next to each field
  - phone rule identical to the server's
  - a reminder not to type medical history
- A review step before confirming, with a link to the policy.
- The confirmation appears only after the server responds. It shows the
  booking reference, Add to calendar, **WhatsApp the clinic** (previously
  never shown), and Book another.
- Every error has a specific message. Call and WhatsApp are always offered
  when booking can't go ahead. Nothing typed is lost.
- **New "Already booked? Find or cancel your appointment"** panel, using the
  existing server endpoints.

**Files**

- Rewritten: `public/js/booking.js`, `public/css/booking.css`, and the
  booking section of `index.ejs`.
- Changed:
  - `ds.js`: mobile rule matches the server
  - `ds.css`: hover only on hover-capable devices
  - `public.routes.js`: `booking.css` loads normally
  - `test/home.test.mjs` and `test/treatments.test.mjs`: new selectors
- Added: `test/booking-ui.test.mjs`, `docs/redesign/05-booking.md`.
- **Not changed:** any API, server validation, schema, availability logic,
  appointment creation, reference numbers, cancellation logic, or
  notifications.

**Tests actually run**

`npm test`: **245/245 pass**. The 15 new booking tests run in Chromium against
an isolated database:

| Case | Result |
|---|---|
| Valid booking: confirmation after 201 only; reference format; focus; announcement; ICS 200; WhatsApp button; DB row | ✔ |
| Focus and announcement on step change; readable day labels | ✔ |
| Missing fields: errors, `aria-invalid`, described-by, focus on first, values kept, nothing sent | ✔ |
| Invalid phone caught; 0-prefixed phone accepted | ✔ |
| No free times on a day (mocked) | ✔ |
| Calendar fails to load (mocked 500), then retry | ✔ |
| Slot taken before submit (mocked 409) | ✔ |
| Network failure on submit (aborted): no false success | ✔ |
| Server rejection with field errors (mocked 400) | ✔ |
| Rate limited (mocked 429) | ✔ |
| Duplicate submit: three clicks, one POST | ✔ |
| Continue clear of the action bar on a phone, every step | ✔ |
| Find + cancel with explicit confirmation; DB status `cancelled` | ✔ |
| Wrong phone: not found, nothing leaked | ✔ |
| Completed booking: not cancellable online | ✔ |
| Rescheduling | Not supported for patients (server is admin-only); the panel says to call or message |

Step screenshots at 390 and 1440 px are in
`/home/ravi/clinic-redesign-artifacts/stage-5/`.

**Rollback:** `git revert <stage-5 commit>` restores the previous wizard. No
data migration is involved.

### Stage 5 follow-ups

- **Hero:** the headline is now 34–52 px with balanced line breaks. The admin
  line break applies only on phones. The photo shape matches the text
  column's height at each width. This answers the feedback that the top text
  looked too big and misaligned.
- **`/_preview/testimonials`**, for the client demo:
  - shows the testimonials section filled with 8 **sample** cards, using the
    supplied names with sample wording I wrote
  - a "Sample content, not real reviews" banner, and every card labelled
    "Sample"
  - noindex (meta and header), unlinked, not in the sitemap, no structured
    data; tests assert all of this, and that the live homepage never shows
    the sample cards
- **Testimonials section** moved into `partials/reviews.ejs`, shared by the
  homepage and the preview.
- **Real testimonials:** the owner says these patients gave written comments
  on paper.
  - Route: **Admin → Reviews → add testimonial**, with the patient's **own
    words** from the card, "collected via: feedback card", and the consent
    tick.
  - The database enforces consent before anything shows.
  - The homepage switches to the carousel automatically.

### Stage 5: verified on production (`9876692`)

- The booking POST was **mocked** in the browser. Every other non-GET request
  was aborted, and none were attempted.
- **Deep link:** `/#appointment?treatment=root-canal-treatment` opens at
  "Step 2 of 5 · Date". Day labels read "Friday 23 October, 20 times
  available". The earliest-time shortcut works.
- **Live slots:** they skip the 1–3 PM break, and a 60-minute root canal is
  not offered at 12:30.
- **Validation:** an empty submit puts focus on Full name.
- **Confirmation:** the mocked confirmation shows the reference and the
  WhatsApp button.
- `/_preview/testimonials` returns 200 with `X-Robots-Tag: noindex, nofollow`.
  The homepage still shows the genuine-only empty state.

## Stage 6: production-readiness QA

See `06-qa.md`. Verified fixes: focus kept clear of the mobile bar (WCAG 2.4.11) and an h1 added to the preview page. Every page meets the budget (LCP 1.5–2.4 s, CLS 0, A11y/SEO 100). Vercel blocked the last two deploys (needs a dashboard check). npm audit fixes await approval.

### Deploys unblocked (2026-10-22)

Vercel had blocked six commits: "GitHub couldn't verify an account for the commit". They were authored as `das.rabindra@github.com`, which is not on the GitHub account. The repo now commits as the account's GitHub noreply address, and `b349850` deployed everything waiting. Verified live:

- the focus fix
- the preview page h1
- the password-reset fix (an invalid token now returns `INVALID_TOKEN`)
- the security updates
- booking (mocked confirmation)

## Cinematic redesign: "Quiet confidence" (2026-10-23, `64c001e` → `04edd7e`)

**What changed**

- **Opening scene:** the real treatment room full-bleed, with a slow push-in
  and gentle parallax. The Lora headline is revealed line by line, its last
  line in mint italic. A rail carries credentials and today's open-now
  status. The header is transparent over the hero and solid below it.
- **Numbered chapters:** 01 dentist · 02 clinic · 03 treatments · 04 inside
  the clinic · 05 words from patients · 06 questions · 07 book (night) ·
  08 visit · closing scene (night) · footer wordmark. Each has its own
  composition: no repeated card grids.
- **Treatment variety:** large image tiles for the lead two, numbered
  editorial rows for the next four, then the index.
- **Motion:** reveals and image wipes using transform, opacity and clip-path
  only. Everything is off under reduced motion, and nothing is ever hidden
  without JS.
- **Imagery:** three CC0 images via Openverse, credited in
  `public/img/stock/CREDITS.md` and captioned "Illustrative photograph".
  No stock image represents the clinic, its dentist or its patients. No
  hero video.

**Verified on production**

| Page | Perf | A11y | LCP (median of 3) | CLS |
|---|---|---|---|---|
| `/` | 98–99 | 100 | 2.15 s | 0 |
| `/services` | 98–100 | 100 | 2.35 s | ~0 |
| `/services/root-canal-treatment` | 97–98 | 100 | 2.42 s | 0 |
| `/privacy` | 100 | 100 | 1.52 s | 0 |

- Best practices and SEO are 100 on all four. 5 pages × 8 widths: no
  overflow, no errors.
- Booking on production, with the final submission mocked: deep link, step
  focus, confirmation and WhatsApp all work.
- `npm test`: 271/271.

**Issues found and fixed during the pass**

- Chrome's IntersectionObserver honours `clip-path`, so image reveals never
  fired. They are now observed through their parent.
- Images waiting to reveal widened the page on phones by 1–5 px. Reveal
  frames now clip.
- The hero preload `imagesizes` didn't match the `<img sizes>`, so the
  photo downloaded twice.
- The footer wordmark was under 3:1.
- The night chapter's heading colour leaked into the white booking card.
- The tall gallery cell cropped a poster's text.

## Inner pages go cinematic (2026-10-23)

/services, each treatment page, /privacy and the 404 now share the
homepage's visual language.

- **Opening scene:** each page opens on a night scene, and the header sits
  transparent over it (`[data-hero]`). A treatment page uses its own
  photograph as the backdrop. Stock photos are captioned "Illustrative
  image, not a photograph of the clinic".
- **Treatments index:** two lead tiles, then numbered editorial rows, as on
  the homepage.
- **Treatment page:** the body is numbered chapters next to a sticky contact
  card, followed by split FAQs, related treatments as rows, and a closing
  night scene.
- **Privacy:** the text is unchanged, laid out as numbered chapters.
- **404:** popular treatments are shown as rows.
- **CSS:** tiles, rows, split FAQs and the closing scene moved from
  `home.css` to `layout.css` so every page can use them.
- **Checks:** `npm test` passes 271/271. The local width sweep across
  320–1920 px found no overflow and one h1 per page.

## About and Gallery pages (2026-10-23)

About and Gallery used to be homepage sections that the menu scrolled to.
They are now pages of their own, in the same cinematic style.

- **/about:** the page opens on a night scene with the dentist's portrait
  framed beside the name. Below it come four chapters:
  1. The dentist: About copy, credentials and languages.
  2. The clinic: story text and the clinic's real treatment-room photo
     shown wide.
  3. Inside the clinic: three gallery photos.
  4. Find us: address, phone numbers and the weekly hours with the break.

  It ends on a closing night scene. All of this comes from what the clinic
  has entered; nothing new is claimed.
- **/gallery:**
  - The treatment-room photo is the scene behind the title.
  - Every published photo is grouped into a numbered chapter by its
    category, shown uncropped in columns.
  - "Before & after" carries the consent note.
  - A small `<dialog>` lightbox (`public/js/gallery.js`) opens each photo.
    It supports arrow keys and Escape, returns focus afterwards, and falls
    back to a plain link without JS.
- **Links:**
  - The menu's About goes to /about. The menu item "Clinic" is renamed
    "Gallery" and goes to /gallery.
  - The footer links and the JSON-LD dentist `url` now point to /about.
  - The homepage sections stay, with links to the new pages.
- **Sitemap:** both pages are added. Gallery lastmod comes from the newest
  published photo.
- **Checks:** `npm test` passes 280/280 (new `about-gallery.test.mjs`). The
  local width sweep found nothing.

## Testimonials and FAQ pages, footer wordmark fix (2026-10-23)

- **/testimonials:** opens on the night scene, with the "genuine feedback
  only" rule stated up front.
  - With real reviews, it shows the rating (and what it is based on) in the
    scene, and the reviews as a wall of quotes.
  - Until then, it says "Testimonials coming soon" and invents nothing.
    While empty it is noindex and stays out of the sitemap.
  - "Share your experience" offers a Google review (link and QR) or telling
    the clinic directly. A named testimonial needs permission, as the
    privacy policy says.
- **/faq:** the 12 general questions plus every treatment's own (64 answers
  in 16 sections).
  - Each section is a numbered chapter with an accordion. Treatment
    sections link to the treatment page.
  - A topic index sits beside the questions: sticky on desktop, a row of
    pills on phones.
  - FAQPage markup is not duplicated here.
- **Navigation:** the menu's Testimonials and FAQ, and the footer links, go
  to the new pages. The homepage sections stay, with links to them.
- **Footer wordmark:** it was sized from the viewport width, which clipped
  the final "e" of "Care" at 320–390 px and at 1920 px and wider. It is now
  sized from its container's width (`100cqi / 8.1`; the line is 7.81× its
  font size), so it fits at every width.
- **Checks:** `npm test` passes 285/285. The width sweep found nothing.

## Contact page (2026-10-23)

- **/contact** has four parts:
  - **Night scene:** "Visit the clinic", the address, today's live status,
    and Get directions / Call / WhatsApp buttons.
  - **01 Reach the clinic:** cards for Call (both lines), WhatsApp and
    Request a call back, plus Email when one is set.
  - **02 Find us:** the lazy-loaded map beside the address and directions.
  - **03 Opening hours:** the hours as a sentence plus the weekly table,
    with today highlighted and the break shown.

  It ends on a closing booking scene.
- **Navigation:** the menu's Contact and the drawer's "Contact & directions"
  go to /contact. The homepage Visit section stays, with a link to it.
- **Code:** `weekHoursFor()` and `addressHtmlFor()` are now shared by
  /about and /contact.
- **Checks:** `npm test` passes 287/287. The width sweep found nothing.

## Booking page (2026-10-23)

- **/book:** the booking wizard sits inside the opening night scene itself,
  since booking is the page's whole purpose. Beside it are the breadcrumb,
  "Book an appointment", the three steps, today's status and the
  call/WhatsApp/call-back fallback. "Find or cancel" stays under the wizard.
  Below the scene, "Good to know" covers where, when and changing plans.
- **Same wizard everywhere:** the wizard and "find or cancel" markup moved
  into `partials/booking-panel.ejs`, which both the homepage and /book use.
  The hidden "Online booking" heading takes a level so heading order holds on
  both.
- **Deep links:** `/book?treatment=<slug>` opens on the Date step with that
  treatment chosen, then drops the query from the address. The canonical URL
  stays /book. The homepage's `/#appointment?treatment=` links (including
  old shared ones) still work.
- **Links:** Book buttons everywhere except the homepage now go to /book or
  /book?treatment=. This covers treatment cards, treatment pages, the header
  CTA, the phone action bar, the drawer, the footer and every closing scene.
  On the homepage they still open the wizard in place.
- **Sitemap:** /book is listed. The old "/book is not a route" test now
  checks that it is listed and live.
- **Fix:** text buttons inside a page scene were dark on night. They are now
  light, except inside the white booking panel.
- **Checks:** `npm test` passes 289/289, with new browser tests for /book
  and the deep link.

## Clinic photo swap and /book layout-shift fix (2026-10-23)

- **New photo:** the homepage "A calm, modern clinic" photo was a dental
  probe, which the owner didn't like. It is now a backlit fresh-mint leaf
  (rawpixel, CC0), still captioned "Illustrative photograph". The probe
  files are removed and `CREDITS.md` is updated.
- **Layout shift on /book:** the wizard's progress row was empty until
  `booking.js` filled it, so the wizard dropped 35–45px in the first screen.
  CLS was 0.132 on the live site. The row's height (51px, or 65px from 640px
  up) is now reserved in `booking.css`, and the wizard no longer moves.

## Cold-start 504 fix (2026-10-23, approved by the owner)

**Symptom:** the first request after a deploy sometimes returned 504
(seen on /contact and /book?treatment=…). Every later request was fine.

**Cause:**
1. Each serverless cold start ran migrations and the full seed: 135
   sequential queries.
2. The migration lock was a *session-level* advisory lock, taken and
   released by separate statements outside a transaction. Through a
   transaction-mode pooler (Neon's pooled endpoint), those statements can
   run on different server connections, so the unlock could miss. The lock
   then stayed held, and the next cold start waited on it until Vercel's
   30-second limit.

**Fix:**
- `migrate.js` runs everything in one transaction under a
  *transaction-level* lock, with one savepoint per file. It uses a new lock
  key, so a lock leaked under the old key can't block it.
- New `src/db/boot.js`, `ensureDatabase()`:
  - **Fast path:** one query compares a stored fingerprint with a hash of
    the migrations, seed sources, bundled gallery photos and admin-env
    flag. If they match, boot is done.
  - **Slow path:** one transaction takes a boot lock (waits at most 15s),
    checks again, then runs migrate + seed and records the fingerprint.
    Only the first boot after those files change does this work.
  - If another instance holds the lock, this one serves instead of
    waiting for a 504.
- `api/index.js` and `src/server.js` use `ensureDatabase()` and log how
  long it took. `npm run seed` still runs the full seed on demand.

**Checks:** new `test/boot.test.mjs` covers:
- one query on the fast path;
- re-running after a change;
- two concurrent boots;
- serving when another instance holds the lock;
- a leaked old-key lock not blocking migrations;
- no session lock left behind.

The slow path was also checked against a single-connection pool, as
production runs. `npm test` passes 295/295.

## Homepage hero, more cinematic (2026-10-23)

- **Film grade, not a wash:**
  - The flat teal overlay is gone. The photo gets a slight grade (less
    saturation, more contrast, a little darker).
  - Darkness gathers only where the words sit (lower-left), with a vignette
    closing the frame, so the chair, lamp and cabinet on the right keep
    their own light and colour.
  - Fine static film grain on top (a tiny inline SVG).
- **Phones get an establishing shot:**
  - The clear photograph fills the top of the screen.
  - The words sit below on deep night instead of fighting the photo
    across the full width.
- **Opening:**
  - Letterbox bars part (clip-path) while the camera eases back.
  - The headline lines rise as before and are larger (up to 6rem).
  - A caption like a film still, "The treatment room, Samal Dental Care",
    names the real photograph (desktop; only for the clinic's own photo).
- **Scroll:**
  - As the visitor scrolls on, the words lift and fade, a dimmer deepens
    the scene, and the photo keeps its parallax.
  - Transform and opacity only; all of it is off under reduced motion.
- **Contrast, measured over the photo:** the brightest 1% of background
  pixels behind each line, compared with the text colour.
  - Before (live), worst case: eyebrow 2.1 and intro 2.6 on phones;
    headline 3.3 on desktop.
  - Now, worst case at 390/768/1440/1920px: eyebrow ≥7.4, headline ≥4.88,
    intro ≥5.2, note ≥11.6, caption ≥7.7.
- **Checks:** `npm test` passes 295/295. The width sweep found nothing.
  - One run had two time-dependent booking-UI failures: late in the day,
    today's few remaining slots get used up. They pass alone and on rerun,
    so this is a pre-existing flake, not this change.

## Booking test flake fixed (2026-10-23)

**Correction:** the hero entry above called the two booking-UI failures
"time-dependent" (today's slots running out). That was wrong. Two time-based
theories were tested and both disproved:
- Today cut down to one slot: tests still passed with the old helper.
- A live probe across the 2-hour lead-time cutoff at 18:30 IST: the booking
  still succeeded.

**Real cause:** instrumented runs caught a failure stuck on the Review step,
with no booking request ever sent. The Confirm click had not landed. On each
step change the wizard smooth-scrolls itself into view, and a scripted click
straight after a step change can hit where the button *was* while the page
is still moving. Nothing happens, the next wait times out after 30 seconds,
and a different test fails on each unlucky run (about 1 run in 6).

**Fix:** the booking UI tests open pages with `prefers-reduced-motion:
reduce`, a path the wizard already supports, so the scroll is instant.
Nothing on the site changed; people are unaffected, since they wait for the
page to settle before tapping.

**Checks:** `test/booking-ui.test.mjs` passed 30 runs in a row (it failed
about 1 run in 6 before). `npm test` passes 295/295.

## Footer as end credits (2026-10-23)

- **Night:** the footer is now a night scene in a new `--color-night-deep`
  (#072624), a shade below the closing scenes so it reads as the credits
  after the last scene.
  - A faint projector glow at the top, the hero's film grain, and a hairline
    where the scene ends.
- **Credits:** column headings in spaced mint capitals, with links in
  night-ink and a mint underline that draws on hover. The status pill,
  social link and focus rings are recoloured for night.
- **Wordmark:** "Samal *Dental* Care" set light on night, with Dental in
  italic mint. Each word rises from its own mask as the footer comes into
  view, through motion.js `[data-reveal]`, and stays static under reduced
  motion.
- **Back to top:** a link to `#main` (the skip-link target) sits beside the
  privacy link.
- **Contrast:** the four `--color-night-deep` pairs are added to
  `CONTRAST_RULES`: ink 14.3:1, muted 9.5:1, mint 9.98:1, focus 16:1.
- **Wordmark clipping, properly fixed:** the earlier `100cqi / 8.1` assumed
  the line is 7.81× its font size. That is true only when the browser slants
  upright Lora. With the real italic (preloaded on the homepage, and cached
  on any page after a first visit) it is 8.11×, so the final "e" still
  clipped by 2px. The divisor is now 8.4. Measured on four pages at seven
  widths, first and cached visits: at least 10px to spare everywhere.
- **Checks:** `npm test` passes 299/299.

## Homepage clinic image: the owner's dental illustration (2026-10-23)

- **New image:** the owner supplied `dental.jpg` to replace the leaf in "A
  calm, modern clinic". It is a 3D render (a tooth, an implant, a mirror and
  a syringe on blue), so the caption is "Illustration" rather than
  "Illustrative photograph".
- **Licence:** the image's metadata marks it as commercial stock. The owner
  confirmed the clinic holds a licence, and that is recorded in
  `public/img/stock/CREDITS.md` under a new "Licensed" section. The CC0
  images stay under "Public domain".
- **Encoding:** re-encoded to WebP at 640/1024/1600px, with all metadata
  stripped (the Photoshop and stock-description fields too).
- **Crop:** biased to 64% 55% so the tooth, implant and mirror stay in frame
  in the square desktop crop.
- **Clean-up:** the leaf files are removed.
- **Test:** the caption test accepts either caption, still one per stock
  image.

## Owner's free photographs placed (2026-10-23)

The owner supplied free stock photographs (Freepik; two credit Wavebreak
Media in their metadata) and chose where three go.

**Placements:**

| Photo | Where |
|---|---|
| Dentist examining a female patient with tools | Homepage opening scene (owner's choice) |
| Dentist curing a filling with UV light | Beside "Book an appointment" (was the dental lamp) |
| Dentist examining a female patient's teeth | Beside "Your smile deserves attentive, modern care" (was the bamboo toothbrushes) |
| Patient during a procedure | Treatments page scene |
| Gloved hand with instruments | Questions page scene; the plain studio backdrop is extended on the left so the instruments sit right, clear of the text |

**Honesty rules:**
- Every one is captioned "Illustrative photograph", including the hero
  caption on phones (it had been desktop-only). The hero's alt text also
  starts "Illustrative photograph:".
- Link previews (og:image) keep the clinic's own treatment-room photo, so a
  shared link never shows stock people as the clinic.
- The real photo still appears on About and in the gallery.
- A clinic-uploaded (non-stock) hero in the admin still takes priority.

**Attribution:** the Freepik free licence requires it.
- The footer reads "Illustrative photographs by Wavebreak Media and others
  on Freepik".
- `CREDITS.md` has a Freepik section listing each file, its title and
  creator where the metadata names one.
- The unused CC0 lamp and toothbrush files are removed.

**Contrast:** photo scenes (Treatments, Questions and every treatment page)
now use the hero's approach.
- Desktop: ~90% night over the text column, with the photo clear on the
  right.
- Phones: the photo as a band at the top, with the text on solid night
  below.
- Measured worst case over the photo:

  | Element | Before | Now |
  |---|---|---|
  | Eyebrow on phones | as low as 2.5 | 7.4–9.2 at every width |
  | Headline on phones | as low as 3.2 | 7.6–11.6 at every width |
  | Breadcrumbs | — | 7.8–12.8 |
  | Hero, every line | — | ≥ 5.05 |

**Encoding:** WebP at sizes for each slot, with metadata stripped. The hero
is 25KB at 1600px.

**Tests:** the old "stock hero gives way to the clinic photo" test is
replaced to match the owner's decision: the hero is labelled illustrative
and og:image is the clinic's room. The caption-count test now includes the
hero caption. `npm test` passes 299/299, and the width sweep (5 pages × 8
widths) found nothing.
- **Follow-up:** /services largest content paint was 2.53–2.65s after the
  new scene photo. The first treatment tile still loaded eagerly at
  `fetchpriority="high"` (it was the largest element before the photo) and
  competed with the scene image. It now lazy-loads like the other tiles.

## About and Gallery use the owner's photographs (2026-10-23)

- **Gallery:** the scene behind the title is now the UV-curing photograph.
  Its caption reads "Illustrative photograph · the clinic's own photographs
  are below", because a stock image over "Inside the clinic" must not pass as
  the clinic. The gallery wall is unchanged and stays the clinic's own
  photographs only.
- **About:** the scene gets the smile-exam photograph as a darkened
  backdrop, captioned, behind Dr. Samal's real portrait. "The clinic"
  section keeps the real treatment-room photograph.
- **Tablets (768–1023px):** About's portrait stacks under the words, so the
  scene is shaded evenly there. Under the column shade the intro measured
  4.45:1; now it is 6.37:1.
- **Phone captions:** anchored by their last line just above the
  breadcrumb, inside both margins, so a two-line caption grows up into the
  photo.
- **Contrast:** every line in both scenes is ≥ 4.79:1 at every width (the
  Gallery caption on phones is the lowest).
- **Encoding:** larger WebP sizes added for the two backdrops (1600/2048).
  `CREDITS.md` lists the new uses.
- **Checks:** `npm test` passes 299/299, and the width sweep (4 pages × 8
  widths) found nothing.
- **Follow-up, About speed:** the backdrop became the largest element, so
  it is now the preloaded, high-priority image (the portrait loads
  normally). It also gets its own lighter encoding, `about-scene-*`
  (quality 56; 22KB instead of 36KB at the size phones fetch), since it sits
  under deep shade. The unused `smile-exam-2048` is removed. Contrast is
  unchanged.
- **Follow-up, loading order (all pages):**
  - The opening-photograph preload moved to the top of the head, ahead of
    the font preloads and stylesheets. After them, its request started
    1–1.7s late on /about.
  - On About, the portrait (a 114KB original) is now `fetchpriority="low"`,
    so it no longer competes with the backdrop.
  - Live LCP, 3–5 Lighthouse runs each:

    | Page | LCP |
    |---|---|
    | /about | 1.74–2.42s (was 2.73–3.08s) |
    | / | 1.75–1.83s (was ~2.2s) |
    | /gallery | 1.84–2.05s |
    | /services | 1.75–2.42s |
    | /faq | 1.59–1.86s |

    Accessibility 100 and CLS 0 everywhere. Fonts now queue behind the
    photo; with `font-display: optional` a slow link may show the
    metric-matched fallback for that visit, never a layout shift.

## Contact and Testimonials use the owner's photographs (2026-10-23)

- **Contact:** the scene's backdrop is the dentist-with-mirror photograph
  (the homepage hero's), captioned "Illustrative photograph".
- **Testimonials:** the backdrop is the close-up smile, chosen because it
  shows no recognisable face. A stock face beside "Words from patients"
  would read as one of the reviewers.
  - It is captioned "Illustrative photograph · not a patient of the clinic".
  - It is mirrored so the smile sits in the lit right-hand side, not under
    the text. The flip is on the wrapper, because the image's own transform
    belongs to the push-in animation.
- **Code:** a new `partials/scene-photo.ejs` (image + shade, optional
  position and flip) serves both scenes; routes preload the backdrop.
- **Contrast:** every line in both scenes is ≥ 6.95:1 at every width.
- **Checks:** tests assert both captions. `npm test` passes 299/299, and the
  width sweep found nothing.
