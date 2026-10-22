# Design tokens — "Calm Clinical Elegance"

**Source of truth:** `public/css/ds.css` (`:root`). This document describes
it; if they disagree, the stylesheet wins. The contrast table below is
generated from the stylesheet, and `test/design-tokens.test.mjs` re-checks it
on every `npm test`. Change a colour, and the test says whether it still
passes.

**Preview:** `/_styleguide`. It is not linked from anywhere, is marked noindex
(meta tag and `X-Robots-Tag` header), and is not in the sitemap.
Screenshots at 360, 768 and 1440 px are in
`/home/ravi/clinic-redesign-artifacts/stage-2/`.

## Colour

| Token | Value | Role |
|---|---|---|
| `--color-bg` | #F8F7F2 | Page background (warm ivory) |
| `--color-surface` | #FFFFFF | Cards, inputs, dialogs |
| `--color-accent-sage` | #DDEAE3 | **Decorative tint only.** Section background, tertiary button, hover wash |
| `--color-accent-sand` | #E9DCCB | **Decorative tint only.** Section background, neutral badge, image placeholder |
| `--color-primary` | #155E59 | Primary actions, links, selected state |
| `--color-primary-hover` | #0F4D49 | Hover/pressed for primary |
| `--color-on-primary` | #FFFFFF | Text on primary |
| `--color-text` | #252E2C | Body and heading text |
| `--color-text-muted` | #535D5A | Secondary text, derived from the text colour. At least 4.5:1 on every surface, sand included |
| `--color-border-subtle` | #E3E1D8 | Dividers and static card edges. Decorative, low contrast by design |
| `--color-border-strong` | #767E7B | Inputs, slots, toggles, option cards. At least 3:1 on every surface |
| `--color-focus` | #A8470A | Focus ring (burnt amber): 2 px, 2 px offset. At least 3:1 on every light surface, and distinct from both the teal brand and error red |
| `--color-focus-inverse` | #FFFFFF | Focus ring inside `.section--primary` / `.on-primary` |
| `--color-{success,error,warning,info}-text` | #1E6B3A / #B42318 / #8A5A00 / #1D5B9E | Status text and icons |
| `--color-{success,error,warning,info}-bg` | #E6F2EA / #FBE9E7 / #FBF1DC / #E7F0FA | Status tints. A notice carries a 1 px border and a 4 px left edge in its text colour, plus an icon and a title, so it never relies on the tint alone |
| `--color-disabled-bg` / `--color-disabled-text` | #ECEBE5 / #646C69 | Disabled controls. They are exempt from contrast rules, but stay readable anyway |

### Measured contrast (WCAG 2.x, rounded down)

| Foreground | Background | Ratio | Min | Pass |
|---|---|---|---|---|
| `--color-text` #252E2C | `--color-bg` #F8F7F2 | 13 | 4.5 | ✔ |
| `--color-text-muted` #535D5A | `--color-bg` #F8F7F2 | 6.35 | 4.5 | ✔ |
| `--color-primary` #155E59 | `--color-bg` #F8F7F2 | 7.04 | 4.5 | ✔ |
| `--color-border-strong` #767E7B | `--color-bg` #F8F7F2 | 3.88 | 3 | ✔ |
| `--color-focus` #A8470A | `--color-bg` #F8F7F2 | 5.48 | 3 | ✔ |
| `--color-text` #252E2C | `--color-surface` #FFFFFF | 13.94 | 4.5 | ✔ |
| `--color-text-muted` #535D5A | `--color-surface` #FFFFFF | 6.81 | 4.5 | ✔ |
| `--color-primary` #155E59 | `--color-surface` #FFFFFF | 7.56 | 4.5 | ✔ |
| `--color-border-strong` #767E7B | `--color-surface` #FFFFFF | 4.16 | 3 | ✔ |
| `--color-focus` #A8470A | `--color-surface` #FFFFFF | 5.88 | 3 | ✔ |
| `--color-text` #252E2C | `--color-accent-sage` #DDEAE3 | 11.25 | 4.5 | ✔ |
| `--color-text-muted` #535D5A | `--color-accent-sage` #DDEAE3 | 5.5 | 4.5 | ✔ |
| `--color-primary` #155E59 | `--color-accent-sage` #DDEAE3 | 6.1 | 4.5 | ✔ |
| `--color-border-strong` #767E7B | `--color-accent-sage` #DDEAE3 | 3.36 | 3 | ✔ |
| `--color-focus` #A8470A | `--color-accent-sage` #DDEAE3 | 4.74 | 3 | ✔ |
| `--color-text` #252E2C | `--color-accent-sand` #E9DCCB | 10.33 | 4.5 | ✔ |
| `--color-text-muted` #535D5A | `--color-accent-sand` #E9DCCB | 5.05 | 4.5 | ✔ |
| `--color-primary` #155E59 | `--color-accent-sand` #E9DCCB | 5.6 | 4.5 | ✔ |
| `--color-border-strong` #767E7B | `--color-accent-sand` #E9DCCB | 3.08 | 3 | ✔ |
| `--color-focus` #A8470A | `--color-accent-sand` #E9DCCB | 4.35 | 3 | ✔ |
| `--color-on-primary` #FFFFFF | `--color-primary` #155E59 | 7.56 | 4.5 | ✔ |
| `--color-on-primary` #FFFFFF | `--color-primary-hover` #0F4D49 | 9.64 | 4.5 | ✔ |
| `--color-focus-inverse` #FFFFFF | `--color-primary` #155E59 | 7.56 | 3 | ✔ |
| `--color-success-text` #1E6B3A | `--color-success-bg` #E6F2EA | 5.66 | 4.5 | ✔ |
| `--color-success-text` #1E6B3A | `--color-bg` #F8F7F2 | 6.08 | 4.5 | ✔ |
| `--color-success-text` #1E6B3A | `--color-surface` #FFFFFF | 6.52 | 4.5 | ✔ |
| `--color-error-text` #B42318 | `--color-error-bg` #FBE9E7 | 5.6 | 4.5 | ✔ |
| `--color-error-text` #B42318 | `--color-bg` #F8F7F2 | 6.12 | 4.5 | ✔ |
| `--color-error-text` #B42318 | `--color-surface` #FFFFFF | 6.57 | 4.5 | ✔ |
| `--color-warning-text` #8A5A00 | `--color-warning-bg` #FBF1DC | 5.28 | 4.5 | ✔ |
| `--color-warning-text` #8A5A00 | `--color-bg` #F8F7F2 | 5.52 | 4.5 | ✔ |
| `--color-warning-text` #8A5A00 | `--color-surface` #FFFFFF | 5.92 | 4.5 | ✔ |
| `--color-info-text` #1D5B9E | `--color-info-bg` #E7F0FA | 5.99 | 4.5 | ✔ |
| `--color-info-text` #1D5B9E | `--color-bg` #F8F7F2 | 6.43 | 4.5 | ✔ |
| `--color-info-text` #1D5B9E | `--color-surface` #FFFFFF | 6.9 | 4.5 | ✔ |
| `--color-disabled-text` #646C69 | `--color-disabled-bg` #ECEBE5 | 4.51 | 4.5 | ✔ |

The decorative tints are 1.15:1 (sage) and 1.25:1 (sand) on `--color-bg`.
A test asserts they are never used as `--color-border-strong`.

### Slot states (not colour alone)

| State | Fill | Edge | Text / icon | ARIA |
|---|---|---|---|---|
| Available | surface | 1 px solid border-strong | time | `aria-pressed="false"` |
| Selected | primary | 2 px solid primary | ✓ icon + time, white | `aria-pressed="true"` |
| Unavailable (booked) | transparent | 1 px **dashed** | time **struck through** + "Booked" | `aria-disabled="true"` |
| Disabled (closed) | disabled-bg | none | muted time + "Closed" | `aria-disabled="true"` |

Only the server decides which state a slot is in. Today the wizard shows only
available slots (`01-audit.md` §4). Whether to show booked and closed slots is
a Stage 5 decision.

## Typography

| Token | Size | Family / weight | Line height |
|---|---|---|---|
| `--text-display` | 40→64 px (fluid, 360→1280) | Lora 500 | 1.15 |
| `--text-h1` | 34→48 px | Lora 500 | 1.15 |
| `--text-h2` | 28→36 px | Lora 500 | 1.25 |
| `--text-h3` (card title) | 20→22 px | Lora 600 | 1.25 |
| `--text-body-lg` | 18 px | Inter 400 | 1.65 |
| `--text-body` | **16 px**, never smaller for body or inputs | Inter 400 | 1.65 |
| `--text-small` | 14 px | Inter 400 | 1.5 |
| `--text-label` | 15 px | Inter 600 | 1.35 |
| `--text-button` | 16 px | Inter 600 | 1.35 |
| `--text-eyebrow` | 13 px, uppercase, +0.08em | Inter 600 | — |

- Prose is capped at `--measure: 68ch`.
- `font-variant-numeric: tabular-nums` on `body` aligns times and phone
  numbers, replacing IBM Plex Mono (see decisions D4).
- Fonts are self-hosted variable woff2 files in latin and latin-ext subsets:
  - Lora 400–700: 38 KB latin.
  - Inter 100–900: reuses the existing 48 KB file, which turned out to be the
    full variable font already.
- `font-display: optional` with metric-matched fallbacks (D3). Lora and Inter
  are preloaded.

## Space, layout, shape, motion

| Group | Tokens |
|---|---|
| Space (4 px base) | `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48 · `-16` 64 · `-20` 80 · `-24` 96 |
| Containers | `--container-max` 1200 px · `--container-narrow` 960 px · `--gutter` 16→32 px (16 px at phone widths) |
| Rhythm | `--section-y` 56→112 px · gaps `--gap-sm` 12 · `--gap-md` 24 · `--gap-lg` 32 |
| Breakpoints | 480 · 768 · 1024 · 1280. Media queries can't read custom properties, so these are a convention. The old CSS has 9 ad-hoc breakpoints |
| Radius | `--radius-sm` 6 (inputs, badges, slots) · `--radius-md` 12 (cards, buttons, dialogs) · `--radius-pill` 999 (chips only) |
| Border | `--border-width` 1 px · `--border-width-strong` 2 px (focus, selected, invalid) |
| Elevation | `--shadow-1`: resting interactive card, sticky header after scroll. `--shadow-2`: hover, booking panel, dialog. Nothing else |
| Motion | 150 / 200 / 250 ms, `--ease-out`. Transform and opacity only; colour fades on hover are the exception. Everything is off under `prefers-reduced-motion` |
| Targets | `--target-min` 44 px. Buttons are 48 px, small buttons 40 px (desktop only) |
| Header | `--header-height` 64 px (72 px from 768). `html { scroll-padding-top }` keeps anchors and focused elements clear of the sticky header (WCAG 2.4.11) |

## Primitives (`ds.css` + `ds.js`)

Class names are chosen so they don't collide with `site.css` while both
stylesheets exist during Stages 3–5.

| Primitive | Classes | States / behaviour |
|---|---|---|
| Button | `.button` + `--primary` `--secondary` `--tertiary` `--text` `--inverse`, `--small`, `--block` | hover, focus-visible, active (1 px press), `:disabled`/`aria-disabled`, `aria-busy="true"` loading spinner |
| Link | `.link`, `.link--quiet`, `.link--arrow`, `.prose a` | Always underlined; thicker underline on hover |
| Card | `.card`, `.card--interactive` (stretched `.card__link`, other controls layered above), `.card--tint`; `__media` (3:2), `__body`, `__title`, `__text`, `__footer` | Shadow only when interactive |
| Badge | `.badge` + `--neutral` `--success` `--warning` `--error` `--info` | — |
| Form | `.form-field`, `.form-label`, `.form-hint`, `.form-error`, `.input`, `.select`, `.textarea`, `.check`, `.fieldset`, `.option-card` | `aria-invalid` gives a 2 px error edge. Errors are linked with `aria-describedby`. `form[data-validate]` pattern: live summary, focus on first problem, values never cleared |
| Slot | `.slot-grid`, `.slot-option` (+ `--unavailable`, `--disabled`) | Four states, see above |
| Accordion | `[data-accordion]` `.accordion__item` / `__trigger` (`aria-expanded`, `aria-controls`) / `__panel` (`role=region`) | Open without JS. Fade, not height animation |
| Header & nav | `.site-header` (sticky, `--shadow-1` after scroll), `.site-nav`, `.nav-toggle[data-nav-toggle]`, `.nav-drawer` | Drawer: focus moves in, Tab is trapped, Esc and links close it, focus returns, label switches Menu/Close, scroll is locked |
| Dialog | native `<dialog class="dialog">`, `[data-dialog-open]`, `[data-dialog-close]` | `showModal()` makes the page inert. First field focused. Tab wrap (Chrome otherwise escapes to `<body>`). Esc and backdrop close. Focus returns to the opener |
| Feedback | `.notice` + `--success` `--error` `--warning` `--info`, `.spinner-ds` | Icon + title + edge, never tint alone |
| Layout | `.container`, `--narrow`, `.section` + `--surface` `--sage` `--sand` `--primary`, `.section-heading` (+ `--center`, `__lede`), `.stack`, `.cluster`, `.grid-auto`, `.bento` (`--3`, `__wide`, `__tall`) | Bento only in the hero trust block, benefits and the contact cluster |
| Action bar | `.action-bar[data-action-bar]`, `__item`, `__item--primary`; `body.has-action-bar` | Below 1024 px only. Safe-area inset. Yields (`data-yield`) while a text field has focus or any `[data-bar-yield]` region (the booking form) is on screen |
| Utilities | `.text-display`, `.text-h1–3`, `.text-body-lg`, `.text-small`, `.text-muted`, `.eyebrow-label`, `.prose`, `.visually-hidden-ds`, `.skip-to-content` | — |

Sizes (gzip): `ds.js` 2.8 kB, `ds.css` 8.8 kB. No dependencies; well inside the
~10 kB-per-dependency budget.
