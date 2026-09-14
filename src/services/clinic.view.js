/**
 * The public projection of clinic settings. One place decides what is safe to
 * expose, so both the SSR views and /api/clinic stay in sync.
 */
import * as settingsRepo from '../repositories/settings.repo.js';
import * as mediaRepo from '../repositories/media.repo.js';
import { WEEKDAYS } from '../config/constants.js';
import { minToHHMM, minTo12h, todayIn, weekdayOf } from '../utils/time.js';

const mediaUrl = async (id, fallback = null) =>
  (id ? ((await mediaRepo.findById(id))?.url ?? fallback) : fallback);

export async function publicClinic() {
  const s = await settingsRepo.get();
  const address = await settingsRepo.fullAddress(s);
  const hours = await settingsRepo.getHours();
  const tz = s.timezone || 'Asia/Kolkata';
  const today = todayIn(tz);
  const todayHours = hours.find(h => h.weekday === weekdayOf(today));
  const holidayToday = (await settingsRepo.holidaysOn(today, null)).find(h => h.is_full_day);

  return {
    name: s.name,
    doctor: s.doctor_name,
    qualification: s.qualification,
    registration: s.registration,
    institution: s.institution,
    tagline: s.tagline,
    description: s.description,
    phone: s.phone,
    phone_intl: s.phone_intl,
    whatsapp: s.whatsapp,
    email: s.email,
    address,
    address_parts: {
      line1: s.address_line1, line2: s.address_line2, area: s.area,
      city: s.city, state: s.state, postal_code: s.postal_code, country: s.country,
    },
    maps_url: s.maps_url,
    place_id: s.place_id,
    latitude: s.latitude,
    longitude: s.longitude,
    directions_url: directionsUrl(s, address),
    map_embed_url: mapEmbedUrl(s, address),
    reviews_url: s.reviews_url,
    instagram_url: s.instagram_url,
    facebook_url: s.facebook_url,
    site_url: s.site_url,
    timezone: tz,
    logo_url: await mediaUrl(s.logo_media_id, '/img/logo-96.png'),
    booking: {
      slot_interval_min: s.slot_interval_min,
      lead_hours: s.booking_lead_hours,
      horizon_days: s.booking_horizon_days,
    },
    hours: hours.map(h => ({
      weekday: h.weekday, day: WEEKDAYS[h.weekday], is_open: h.is_open === 1,
      open: minToHHMM(h.open_min), close: minToHHMM(h.close_min),
      open_label: minTo12h(h.open_min), close_label: minTo12h(h.close_min),
      break_start: h.break_start_min != null ? minToHHMM(h.break_start_min) : null,
      break_end: h.break_end_min != null ? minToHHMM(h.break_end_min) : null,
    })),
    today: {
      date: today,
      day: WEEKDAYS[weekdayOf(today)],
      is_open: Boolean(todayHours?.is_open) && !holidayToday,
      closure_reason: holidayToday?.reason || null,
      open: todayHours?.is_open ? minTo12h(todayHours.open_min) : null,
      close: todayHours?.is_open ? minTo12h(todayHours.close_min) : null,
    },
  };
}

/** Prefer the admin's verified place link; fall back to an address query. */
/** Prefer the admin's verified place link; fall back to an address query.
 *  Settings must be passed in — an async default parameter would resolve to a
 *  Promise rather than the row. */
export function directionsUrl(s, address) {
  if (s.latitude && s.longitude) {
    const dest = `${s.latitude},${s.longitude}`;
    const placeId = s.place_id ? `&destination_place_id=${encodeURIComponent(s.place_id)}` : '';
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}${placeId}`;
  }
  if (s.maps_url) return s.maps_url;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function mapEmbedUrl(s, address) {
  if (s.latitude && s.longitude) {
    const d = 0.004;
    const bbox = `${s.longitude - d}%2C${s.latitude - d}%2C${s.longitude + d}%2C${s.latitude + d}`;
    // OpenStreetMap embed needs no API key and shows an exact pin.
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${s.latitude}%2C${s.longitude}`;
  }
  return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
}

export async function whatsappLink(text) {
  const s = await settingsRepo.get();
  if (!s.whatsapp) return null;
  const msg = text || `Hello ${s.name}, I would like to enquire about booking a dental appointment.`;
  return `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}`;
}
