# Decisions log

| # | Date | Decision | Why | Status |
|---|---|---|---|---|
| D1 | 2026-10-22 | Keep the stack: Express + EJS + one `site.css` + vanilla JS. No framework, no bundler, no CSS tooling | Engineering rule 1. The repo is deliberately build-free | Final |
| D2 | 2026-10-22 | Fonts are self-hosted woff2 via `public/fonts/fonts.css`. This is the "framework font loader" equivalent here | Not a Next.js app. CSP `font-src 'self'` blocks external font hosts anyway | Final |
| D3 | 2026-10-22 | **Applied in Stage 2:** keep `font-display: optional` with metric-matched fallbacks, instead of the prompt's `swap` | The existing code records that `swap` was the cause of a 0.21 CLS. `optional` + preload gave CLS 0. Lora would get its own metric-matched fallback | Applied; you can reverse it at Gate 2 |
| D4 | 2026-10-22 | **Applied in Stage 2:** headings in Lora, body in Inter. IBM Plex Mono either retired, or kept only for booking reference and slot times | The prompt allows two families; mono is a third. Tabular figures from Inter (`font-variant-numeric: tabular-nums`) can replace mono for times | Applied in the new system (mono retired); reversible at Gate 2 |
| D5 | 2026-10-22 | Source of truth for clinic facts = existing `clinic_settings` / `clinic_hours` via `publicClinic()`. Hard-coded prose about hours is moved to derived values or owner-approved copy | Already the architecture; only the prose leaks | Final |
| D6 | 2026-10-22 | `theme-color` `#1F3D3A` → `--primary` **only if** owner question 7 is answered yes | Prompt | Pending owner question 7 |
| D7 | 2026-10-22 | Booking tests: local isolated Postgres for real POSTs; Puppeteer request interception for any deployed URL; never submit on a deployed URL | Previews may share the production DB (owner question 9a) | Final |
| D8 | 2026-10-22 | Baseline screenshots and Lighthouse reports are kept outside git, in `/home/ravi/clinic-redesign-artifacts/` | 20 MB of PNGs would bloat the repo | Revisit if you want them committed or published |
| D9 | 2026-10-22 | Content corrections ship as idempotent `content.js` entries (the existing pattern), **not** direct production DB edits | Keeps changes reviewable and reversible; admin edits remain possible | Final |
| D10 | 2026-10-22 | Push each stage straight to `main` | You asked for it after Stage 1. It overrides the prompt's branch-per-stage and PR rule | Final |
| D11 | 2026-10-22 | Stage 2 ships the system in **new files only**: `public/css/ds.css`, `public/js/ds.js` and the `/_styleguide` route. No live page loads them yet | `main` is production, so nothing patients see may change before Gate 2. A test asserts `/` does not load `ds.css` | Final for Stage 2 |
| D12 | 2026-10-22 | New class and token names never reuse a `site.css` name (`.button` not `.btn`, `--color-*` / `--space-*`) | Both stylesheets will coexist while pages migrate in Stages 3–5 | Final |
| D13 | 2026-10-22 | Focus ring colour is burnt amber `#A8470A`, not a teal shade | A teal ring disappears against teal buttons and sage. Amber is at least 3:1 on every light surface and is distinct from error red `#B42318`. Inverse white ring inside primary blocks | Proposed; review at Gate 2 |
| D14 | 2026-10-22 | `theme-color` is `#155E59` on the preview only. Live pages keep `#1F3D3A` until owner question 7 is answered | Prompt | Pending owner question 7 |
| D15 | 2026-10-22 | Dialogs use the native `<dialog>` element. The call-back modal will move to it in Stage 3 | Built-in inert background and Esc. Supported on Android Chrome and iOS Safari 15.4+ | Final |
| D16 | 2026-10-22 | Browser tests (Puppeteer) live in `npm test`. They skip at run time, not load time, if Chromium can't launch | The audit found that the docs claimed browser tests that didn't exist | Final |
| D17 | 2026-10-22 | The homepage uses new partials (`site-header`, `site-footer`, `quick-actions`, `icon`). Other pages keep `header`, `footer` and `action-rail` until Stage 4 migrates them; the old partials are deleted then | Each page loads exactly one design system (a test asserts this), so `ds.css` and `site.css` never fight over base styles | **Done in Stage 4**: all public pages migrated; `site.css`, `site.js` and the old partials deleted |
| D18 | 2026-10-22 | Clinic-supplied photos: **A** (treatment room) is used as the homepage hero. **B** (extracted tooth on a bloodied glove) is not used. **C** (before/after poster) is not used yet | A is the only genuine clinic photograph. B is graphic surgical material on a page meant to reassure nervous patients. C shows a patient's face, so it needs recorded patient consent (the site's own gallery rule enforces this for "Before & after"); its poster text also bakes in the unconfirmed claim "Safe & Painless Treatment" | A final; B and C are owner question 10 |
| D19 | 2026-10-22 | Hero choice rule: the admin's hero image wins unless it is flagged `is_stock`, in which case the bundled clinic photo is used | Genuine beats stock, and admin control is kept for a future real photo | Final |
| D20 | 2026-10-22 | The booking wizard keeps its markup and logic. `booking.css` is an interim re-skin of its `site.css` rules in the new tokens, loaded without blocking first paint | Stage 5 owns the wizard | **Superseded in Stage 5**: wizard rebuilt. `booking.css` now loads normally, because a deep link lands on the wizard first and must not flash unstyled |
| D21 | 2026-10-22 | `theme-color` is `#155E59` on pages using the new system | You approved the visual system at Gate 2, which uses `--primary #155E59` | Final |
| D22 | 2026-10-22 | Gallery category filters and the lightbox are removed from the homepage. Layout follows the count: 1 photo = single figure; 2–4 = grid; 5+ = scroll-snap carousel with buttons and no autoplay | Prompt §3.6. With one photo, a lightbox with Prev/Next was the audit's issue #3 | Final |
| D23 | 2026-10-22 | The urgent-care band is restyled from a red alarm to a calm warning tint. Its hours now come from today's grid, break included. The claim "keeps time free for urgent problems" is **kept**, pending owner question 3c | Prompt: claims are neither silently kept nor silently dropped | Pending owner question 3c |
| D24 | 2026-10-22 | The action bar hides while any part of the booking section is on screen or within 120 px of it, and while a text field has focus | A threshold-based trigger left a brief window where the bar still covered Continue | Final |
| D25 | 2026-10-22 | Stage 4 also migrates `/privacy`, the 404 page and the error page | They shared the old header and footer; migrating them lets the public site drop `site.css` entirely | Final |
| D26 | 2026-10-22 | Treatment-card Book is a real link (`/#appointment?treatment=<slug>`). On the homepage `booking.js` intercepts it and opens the wizard in place | It was a `<button>`, which did nothing on `/services`, on related treatments or on the 404 page. Verified broken on production before the fix | Final |
| D27 | 2026-10-22 | `/services` stays one flat grid, not grouped by category | 15 treatments across 10 categories, 7 of them with a single treatment. Grouping would add headings without helping anyone find anything | Final |
| D28 | 2026-10-22 | Detail-page headings are reworded for cautious language: "What to expect at your appointment" becomes "What the treatment generally involves", and "What this treatment does for you" becomes "What it aims to do". A "What a consultation helps decide" section replaces the plain disclaimer, with the same meaning | Prompt §4 and the medical-language rule. The benefit lines themselves are clinic copy and stay unchanged pending owner question 11 | Final for headings |
| D29 | 2026-10-22 | `fonts.css`, Fraunces and IBM Plex Mono stay in the repo | The admin console still uses them | Final |
| D30 | 2026-10-22 | Card images are still 1280 px with no `srcset` | The media pipeline makes only a ≤2000 px display image and a 480 px square thumb. A mid-size variant means changing the media service, which is backend and needs your approval. Mitigation for now: lazy-load all cards except the first on `/services`, which gets `fetchpriority=high` | Proposal: add a 640 px variant in the media service (Stage 6 or later) |
| D31 | 2026-10-22 | Build "Find or cancel your appointment" on the existing lookup and cancel endpoints | The FAQ and privacy page already promised online cancellation (audit C2). No backend change. Owner question 8 recommended option 1; reversible | Final unless the owner chooses option 2 |
| D32 | 2026-10-22 | The live wizard shows only available and selected slot states | The public API returns free slots only. Booked or closed slots would be invented | Final |
| D33 | 2026-10-22 | No automatic retry after a network failure on submit. One automatic retry on a `CSRF` rejection | A lost response may mean the booking succeeded, so a blind retry could book twice. A CSRF rejection is certain to have done nothing | Final |
| D34 | 2026-10-22 | Client phone rule = the server's `normalisePhone()` (6–9 + 9 digits, optional 91 or 0 prefix) | The old client rule rejected 0-prefixed numbers the server accepts | Final |
| D35 | 2026-10-22 | Hover styles on slots and calendar days apply only under `(hover: hover)` and never to a selected item | On touch screens `:hover` stuck to the tapped slot and washed out its selected state (white text on a pale background) | Final |
| D36 | 2026-10-22 | Invented testimonials are not added, even with real people's names supplied | Fabricated reviews mislead patients, contradict the page's own "genuine feedback only" statement, and fall under India's CCPA rules on fake reviews. Genuine testimonials go through Admin → Reviews ("Shared with the clinic"), with the patient's own words and consent | Final |

**D30 — resolved 2026-10-23 (owner approved the backend change).** The
media service now also stores an 800px `medium` variant of every upload
wider than 800px. Pages that show an uploaded image at screen size (the
doctor's portrait, gallery photographs, treatment images and cards) offer
`srcset="<medium> 800w, <full> Nw"`, and the browser picks the size it
needs.

Images uploaded before this get their variant from the scheduled job, never
at boot: a cold start must stay fast, after the 504s. The job runs
`backfillMediums()` each cron tick: 12 per run within a 20s budget, the
doctor's portrait first. Until an image has its variant, pages keep using
the full image.
