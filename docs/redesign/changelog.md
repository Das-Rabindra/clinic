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
