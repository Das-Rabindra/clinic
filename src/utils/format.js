/** Small pure helpers shared by services, routes and views. */

/** HTML-escape. Used anywhere a string reaches markup outside EJS `<%= %>`. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

/**
 * Normalise an Indian mobile number to 12-digit 91XXXXXXXXXX.
 * Returns null when it isn't a plausible Indian mobile — used by both the
 * booking API and patient lookup so the same number always maps to one patient.
 */
export function normalisePhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return '91' + d;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return '91' + d.slice(1);
  return null;
}
/** 91XXXXXXXXXX -> XXXXXXXXXX for display. */
export const localPhone = (p) => (String(p || '').startsWith('91') ? String(p).slice(2) : String(p || ''));
export const displayPhone = (p) => '+' + String(p || '').replace(/\D/g, '');

/** Mask for logs/audit so full numbers don't spread through log storage. */
export const maskPhone = (p) => {
  const s = String(p || '');
  return s.length < 6 ? '***' : s.slice(0, 4) + '****' + s.slice(-2);
};

export const truncate = (s, n = 140) =>
  (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

/** Stable JSON for audit before/after snapshots. */
export const snap = (o) => (o == null ? null : JSON.stringify(o));

/**
 * Serialise a value for embedding inside a <script> tag.
 *
 * JSON.stringify does not escape "</script>", so any string that reaches
 * JSON-LD could otherwise close the tag and inject markup. Escaping the angle
 * brackets and ampersand keeps the JSON valid while making tag-breakout
 * impossible; U+2028/U+2029 are escaped because they are raw newlines in JS.
 */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
