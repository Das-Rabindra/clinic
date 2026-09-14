/**
 * All clinic scheduling is expressed as (date, minutes-from-midnight) in the
 * clinic's timezone. This module is the single place that converts between that
 * representation and absolute UTC instants. Using Intl means the conversion is
 * correct for any timezone including DST ones, without a date library.
 */

/** Offset (in minutes) of `tz` from UTC at the given instant. */
export function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  // Interpret the wall-clock reading in tz as if it were UTC, then diff.
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour % 24), +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Convert a clinic-local (YYYY-MM-DD, minutes) to a UTC Date.
 * Two-pass: guess with the offset at the naive instant, then correct using the
 * offset that actually applies at the resulting instant (handles DST edges).
 */
export function localToUtc(dateStr, minutes, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0);
  let offset = tzOffsetMinutes(new Date(naive), tz);
  let utc = new Date(naive - offset * 60000);
  const offset2 = tzOffsetMinutes(utc, tz);
  if (offset2 !== offset) utc = new Date(naive - offset2 * 60000);
  return utc;
}

/** Current clinic-local date + minutes for an instant. */
export function utcToLocal(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (+p.hour % 24) * 60 + +p.minute,
  };
}

/** Today's date string (YYYY-MM-DD) in the clinic timezone. */
export const todayIn = (tz, at = new Date()) => utcToLocal(at, tz).date;

/** Weekday index (0=Sunday) of a YYYY-MM-DD date string. */
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:30" from 570. */
export function minToHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
/** 570 from "09:30". Returns null if malformed. */
export function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
/** "9:30 AM" — patient-facing display. */
export function minTo12h(min) {
  const h24 = Math.floor(min / 60), m = min % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

/** "15 September 2026" */
export function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
/** "Mon, 15 Sep" */
export function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Inclusive day difference b - a. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
