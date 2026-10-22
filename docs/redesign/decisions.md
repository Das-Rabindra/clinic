# Decisions log

| # | Date | Decision | Why | Status |
|---|---|---|---|---|
| D1 | 2026-10-22 | Keep the stack: Express + EJS + one `site.css` + vanilla JS. No framework, no bundler, no CSS tooling | Engineering rule 1. The repo is deliberately build-free | Final |
| D2 | 2026-10-22 | Fonts are self-hosted woff2 via `public/fonts/fonts.css`. This is the "framework font loader" equivalent here | Not a Next.js app. CSP `font-src 'self'` blocks external font hosts anyway | Final |
| D3 | 2026-10-22 | **Proposed:** keep `font-display: optional` with metric-matched fallbacks, instead of the prompt's `swap` | The existing code records that `swap` was the cause of a 0.21 CLS. `optional` + preload gave CLS 0. Lora would get its own metric-matched fallback | Needs your approval |
| D4 | 2026-10-22 | **Proposed:** headings in Lora, body in Inter. IBM Plex Mono either retired, or kept only for booking reference and slot times | The prompt allows two families; mono is a third. Tabular figures from Inter (`font-variant-numeric: tabular-nums`) can replace mono for times | Needs your approval |
| D5 | 2026-10-22 | Source of truth for clinic facts = existing `clinic_settings` / `clinic_hours` via `publicClinic()`. Hard-coded prose about hours is moved to derived values or owner-approved copy | Already the architecture; only the prose leaks | Final |
| D6 | 2026-10-22 | `theme-color` `#1F3D3A` → `--primary` **only if** owner question 7 is answered yes | Prompt | Pending owner question 7 |
| D7 | 2026-10-22 | Booking tests: local isolated Postgres for real POSTs; Puppeteer request interception for any deployed URL; never submit on a deployed URL | Previews may share the production DB (owner question 9a) | Final |
| D8 | 2026-10-22 | Baseline screenshots and Lighthouse reports are kept outside git, in `/home/ravi/clinic-redesign-artifacts/` | 20 MB of PNGs would bloat the repo | Revisit if you want them committed or published |
| D9 | 2026-10-22 | Content corrections ship as idempotent `content.js` entries (the existing pattern), **not** direct production DB edits | Keeps changes reviewable and reversible; admin edits remain possible | Final |
