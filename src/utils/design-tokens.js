/**
 * Design-token helpers.
 *
 * public/css/ds.css is the only place colours are defined. This reads them
 * back out so the style-guide swatches and the contrast test can never drift
 * from the stylesheet the browser actually loads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DS_CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/css/ds.css');

/** Every `--color-*: #RRGGBB` declared in the :root block, in source order. */
export function colorTokens(css = fs.readFileSync(DS_CSS, 'utf8')) {
  const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
  const out = new Map();
  for (const m of root.matchAll(/(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out.set(m[1], m[2].toUpperCase());
  return out;
}

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG 2.x contrast ratio, rounded down to two decimals so 4.499 never reads as 4.5. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.floor(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * The pairs the system promises, with the minimum each must meet.
 * 4.5 = text (WCAG 1.4.3); 3 = UI components and focus indicators (1.4.11).
 */
export const CONTRAST_RULES = [
  ...['--color-bg', '--color-surface', '--color-accent-sage', '--color-accent-sand'].flatMap(bg => [
    { fg: '--color-text', bg, min: 4.5 },
    { fg: '--color-text-muted', bg, min: 4.5 },
    { fg: '--color-primary', bg, min: 4.5 },
    { fg: '--color-border-strong', bg, min: 3 },
    { fg: '--color-focus', bg, min: 3 },
  ]),
  { fg: '--color-on-primary', bg: '--color-primary', min: 4.5 },
  { fg: '--color-on-primary', bg: '--color-primary-hover', min: 4.5 },
  { fg: '--color-focus-inverse', bg: '--color-primary', min: 3 },
  ...['success', 'error', 'warning', 'info'].flatMap(k => [
    { fg: `--color-${k}-text`, bg: `--color-${k}-bg`, min: 4.5 },
    { fg: `--color-${k}-text`, bg: '--color-bg', min: 4.5 },
    { fg: `--color-${k}-text`, bg: '--color-surface', min: 4.5 },
  ]),
  { fg: '--color-disabled-text', bg: '--color-disabled-bg', min: 4.5 },
  { fg: '--color-night-ink', bg: '--color-night', min: 4.5 },
  { fg: '--color-night-muted', bg: '--color-night', min: 4.5 },
  { fg: '--color-mint', bg: '--color-night', min: 4.5 },
  { fg: '--color-focus-inverse', bg: '--color-night', min: 3 },
  // The footer's end credits.
  { fg: '--color-night-ink', bg: '--color-night-deep', min: 4.5 },
  { fg: '--color-night-muted', bg: '--color-night-deep', min: 4.5 },
  { fg: '--color-mint', bg: '--color-night-deep', min: 4.5 },
  { fg: '--color-focus-inverse', bg: '--color-night-deep', min: 3 },
];
