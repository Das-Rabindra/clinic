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
