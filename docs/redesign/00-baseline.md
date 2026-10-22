# Stage 0 — Baseline

Recorded 2026-10-22 against `main` @ `a51bfe0`. The live deployment serves the
same commit: `site.js`, `booking.js`, `site.css` and `fonts.css` fetched from
production are byte-identical to the repo (SHA-1 compared).

No source files were modified in this stage.

## 1. Build, lint, typecheck, test

| Command | Exists? | Result |
|---|---|---|
| `npm ci` | yes | OK. `npm audit` reports 5 vulnerabilities (2 moderate, 2 high, 1 critical). Not investigated: out of scope for a visual redesign, but listed in the audit. |
| build | **no build step**: Express + EJS, no bundler | n/a |
| lint | **no lint script or config** | n/a |
| typecheck | **plain JS, no TS / JSDoc checking** | n/a |
| `npm test` | yes (`node --test`, needs Postgres) | **153 / 153 pass**, 42 suites, 0 skipped, ~23 s. Run against a throwaway `postgres:16-alpine` on `127.0.0.1:55432` |

PROJECT.md says "92 tests" and says browser-level (Puppeteer) checks cover the
menu, dialog, slider and cards. **No browser tests exist in `test/`.** Puppeteer
is a devDependency, but no test file imports it. The docs are out of date on
this point.

## 2. Screenshots

There are 32 full-page PNGs: 4 pages × 8 widths (320, 360, 375, 390, 768, 1024,
1440, 1920). They were captured from production with Puppeteer's bundled
Chromium 152.

They are stored **outside the repo**, so binaries don't bloat git:
`/home/ravi/clinic-redesign-artifacts/baseline/screens/{home,services,rct,privacy}-<width>.png`,
plus `probe.json` (per-page layout measurements). Flow screenshots (menu,
call-back dialog, booking steps 1–5) are in `…/screens/flows/`.

Capture method: phone widths emulate mobile + touch. Each page is scrolled
through in 500 px steps, then `.reveal` sections are forced to their final
state, then the shot waits for every `<img>` to load and decode. Fixed elements
such as the mobile bar appear wherever the capture viewport left them. That is
an artifact of full-page capture, not a layout bug.

### Layout probe (all pages, all widths)

- **Horizontal overflow: none** at any width on any page.
- Exactly **one `<h1>`** on every page.
- **No console errors** on any page.
- Header: `position: sticky`, 79 px tall at every width.
- Persistent actions:
  - < 900 px: `.mobile-bar` is visible and `.action-rail` is hidden.
  - ≥ 1024 px: the rail is visible and the bar is hidden. Never both at once.
  - `body` has an 80 px bottom padding whenever the bar shows.
- Header nav: below 900 px it collapses to the hamburger. The header phone
  number shows only at ≥ 1024. The header "Book Appointment" button shows from
  768 up (hidden ≤ 400 by design).

## 3. Lighthouse (mobile, default throttling, v12.8.2, single run)

Reports are in `/home/ravi/clinic-redesign-artifacts/baseline/lighthouse/*.report.{html,json}`.

| Page | Perf | A11y | BP | SEO | LCP | CLS | TBT | FCP | Weight |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 96 | 95 | 100 | 100 | **2.8 s** | 0 | 0 ms | 0.9 s | 442 KiB |
| `/services` | 92 | 94 | 100 | 100 | **3.3 s** | 0 | 110 ms | 1.1 s | 443 KiB |
| `/services/root-canal-treatment` | 98 | 95 | 100 | 100 | 2.4 s | 0 | 0 ms | 0.9 s | 223 KiB |
| `/privacy` | 100 | 94 | 100 | 100 | 1.7 s | 0 | 0 ms | 1.1 s | 172 KiB |

LCP is over the 2.5 s budget on `/` and `/services`.

- On `/` the LCP element is the hero paragraph: text, gated on font loading
  and render-blocking CSS.
- On `/services` it is the first card image. That is a 1280 px WebP shown at
  about 358 px, with no `srcset`.

Lighthouse failures shared by every page:

- `color-contrast`: footer `.foot-alt` "(alt)" is 45 %-opacity paper on pine.
- `heading-order`: footer `<h4>` follows `<h2>`, and on `/services` the card
  `<h3>` follows `<h1>`.
- `uses-responsive-images`: 185 KiB wasted on `/`, 208 KiB on `/services`.
- `render-blocking-resources`, `unminified-css`, `unused-css-rules`.

Single runs vary by ±5 points. Later comparisons should use the median of 3.

## 4. Behaviour (production, read-only)

The automation **intercepted and aborted every non-GET request**. No booking or
call-back was submitted to production.

### Booking wizard (390 px)

- Step 1 lists 15 bookable treatments, including Emergency Dental Care.
- After Continue, `GET /api/appointments/calendar?days=60&service_id=…` returned
  200. 9 days are enabled. A day's accessible name is the ISO date plus the slot
  count, e.g. "2026-10-23, 22 slots".
- After Continue, `GET /api/appointments/availability?date=…&service_id=…`
  returned 200. Slots run 9:00 AM–12:30 PM and 3:00 PM–9:30 PM, so **the
  server correctly excludes the 1–3 PM break**. They are grouped Morning,
  Afternoon and Evening.
- Details step:
  - Invalid phone (`12345`): `#f-phone` gets the `.invalid` class.
  - Focus is not moved to the error.
  - No `aria-describedby` and no live region.
- Confirm step: summary card plus a "Confirm Booking" button. **Not pressed on
  production.**
- After a step change, focus stays on `<body>`: nothing is announced and focus
  is not moved.
- Deep link `/#appointment?treatment=root-canal-treatment` opens at step 2
  (Date) and strips the query from the URL. ✔

### Booking wizard on the local isolated DB (`sdc_local`, not production)

- A full booking succeeds and returns reference `SDC-2026-00001`.
- **Duplicate-submit guard holds.** Two simultaneous Confirm clicks created one
  appointment.
- The confirmation screen shows **no WhatsApp button**. `window.__SDC_WHATSAPP`
  is referenced in `booking.js:192` but never set anywhere.
- A hit-test at 390 px found that the wizard's **Continue button sat under the
  fixed mobile bar**: `elementFromPoint` returned `.bar-book`. Puppeteer's click
  on Continue landed on the bar's "Book Appointment" link. The exact scroll
  position needs a real-device check.

### Call-back dialog (375 px, opened from a treatment card)

- Opens with the treatment name ("About General Dentistry").
- **Initial focus is not placed in the dialog**: `activeElement` is `<body>`.
- Empty submit shows "Please enter your name." and "Enter a valid 10-digit
  mobile number." It makes **no network request**: client validation blocks it.
- The errors have no `aria-invalid`, no `aria-describedby` and no live region.
- **No focus trap.** 12 Tab presses all landed outside the dialog. Esc closes
  it.
- On mobile the only way into the dialog is the call icon on a treatment card.
  The side rail's "Request a call back" exists only at ≥ 900 px.

### Mobile menu (375 px)

- Opens: `aria-expanded="true"`, panel `display:block` (730 px), body scroll
  locked.
- **No focus trap.** After the panel's last link, Tab moves to the hero CTAs
  behind the panel.
- The toggle's `aria-label` stays "Open menu" while the menu is open.
- Esc closes the menu and returns focus to the toggle. ✔

### Links

- `Call Now` and every call action is a plain `tel:+918847879686`.
  The second line is `tel:+919124839288`.
- WhatsApp: `https://wa.me/918847879686?text=…` with `target=_blank` and
  `rel=noopener`.
- Directions: `https://www.google.com/maps/dir/?api=1&destination=20.9033969,85.1743727`.
- Review link and QR: `https://maps.app.goo.gl/9SURk8sfiWBojto18`.
- Map: a Google Maps `<iframe>`, lazily attached by IntersectionObserver.
  It loads Google's Maps JS inside the frame.
- From `/services/root-canal-treatment` every nav hash link is root-prefixed
  (`/#about`, `/#faq` …). Clicking FAQ lands on `/#faq` with the heading at
  324 px. ✔
- Treatment page Book links go to `/#appointment?treatment=<slug>`. ✔
