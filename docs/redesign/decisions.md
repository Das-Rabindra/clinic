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
