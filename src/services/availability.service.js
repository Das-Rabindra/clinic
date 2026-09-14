/**
 * Availability engine.
 *
 * Slots are never accepted from the client. They are derived server-side from:
 *   doctor schedule (falling back to clinic hours)
 *   minus break periods
 *   minus holidays / temporary closures
 *   minus admin-blocked slots
 *   minus slots already occupied by appointments
 *   minus slots too close to now (booking lead time)
 *   minus slots where the service duration would not fit before closing
 *
 * Everything is computed in the clinic's timezone via utils/time.js.
 */
import * as settingsRepo from '../repositories/settings.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import * as apptRepo from '../repositories/appointments.repo.js';
import {
  weekdayOf, localToUtc, utcToLocal, todayIn, addDays, daysBetween,
  minToHHMM, minTo12h, isDateStr,
} from '../utils/time.js';

/** Effective working window for a doctor on a weekday. */
export function windowFor(doctorId, weekday, settings = settingsRepo.get()) {
  const own = doctorId ? doctorsRepo.scheduleFor(doctorId, weekday) : null;
  const src = own || settingsRepo.getHoursFor(weekday);
  if (!src || !src.is_open) return null;
  return {
    open: src.open_min,
    close: src.close_min,
    breakStart: src.break_start_min,
    breakEnd: src.break_end_min,
    inherited: !own,
  };
}

/** Interval of the booking grid: doctor override, else clinic default. */
export function intervalFor(doctor, settings = settingsRepo.get()) {
  return doctor?.slot_interval_min || settings.slot_interval_min || 30;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/**
 * Compute availability for one date.
 * Returns { date, open, reason?, slots: [{ time, label, minutes, available }] }
 */
export function getDayAvailability({ date, serviceId = null, doctorId = null, includeTaken = false }) {
  const settings = settingsRepo.get();
  const tz = settings.timezone || 'Asia/Kolkata';

  if (!isDateStr(date)) return { date, open: false, reason: 'INVALID_DATE', slots: [] };

  const doctor = doctorId ? doctorsRepo.findById(doctorId) : doctorsRepo.primary();
  if (!doctor) return { date, open: false, reason: 'NO_DOCTOR', slots: [] };

  const service = serviceId ? servicesRepo.findBookable(serviceId) : null;
  if (serviceId && !service) return { date, open: false, reason: 'INVALID_SERVICE', slots: [] };

  const interval = intervalFor(doctor, settings);
  const duration = Math.max(service?.duration_min || interval, interval);

  const today = todayIn(tz);
  const horizon = settings.booking_horizon_days ?? 60;
  if (daysBetween(today, date) < 0) return { date, open: false, reason: 'PAST_DATE', slots: [], doctor_id: doctor.id };
  if (daysBetween(today, date) > horizon) {
    return { date, open: false, reason: 'BEYOND_HORIZON', slots: [], doctor_id: doctor.id };
  }

  const win = windowFor(doctor.id, weekdayOf(date), settings);
  if (!win) return { date, open: false, reason: 'CLOSED', slots: [], doctor_id: doctor.id };

  // Full-day holiday closes the date outright; partial holidays become busy ranges.
  const holidays = settingsRepo.holidaysOn(date, doctor.id);
  const fullDay = holidays.find(h => h.is_full_day);
  if (fullDay) {
    return {
      date, open: false, reason: 'HOLIDAY',
      reason_text: fullDay.reason || 'Clinic closed', slots: [], doctor_id: doctor.id,
    };
  }

  /* Busy ranges: break, partial holidays, admin blocks, existing appointments. */
  const busy = [];
  if (win.breakStart != null && win.breakEnd != null) busy.push([win.breakStart, win.breakEnd]);
  for (const h of holidays) {
    if (h.start_min != null && h.end_min != null) busy.push([h.start_min, h.end_min]);
  }
  for (const b of settingsRepo.blockedOn(date, doctor.id)) busy.push([b.start_min, b.end_min]);

  const occupied = new Set(apptRepo.occupiedSlots(doctor.id, date));

  // Earliest bookable instant, honouring the lead time.
  const leadMs = (settings.booking_lead_hours ?? 0) * 3600000;
  const earliest = new Date(Date.now() + leadMs);
  const earliestLocal = utcToLocal(earliest, tz);
  const minMinutes = earliestLocal.date < date ? -1
    : earliestLocal.date > date ? Infinity
      : earliestLocal.minutes;

  const slots = [];
  for (let m = win.open; m + duration <= win.close; m += interval) {
    const end = m + duration;
    let available = true;
    let why = null;

    // Every grid slot the appointment would occupy must be free.
    for (let s = m; s < end; s += interval) {
      if (occupied.has(s)) { available = false; why = 'booked'; break; }
    }
    if (available) {
      for (const [bs, be] of busy) {
        if (overlaps(m, end, bs, be)) { available = false; why = 'blocked'; break; }
      }
    }
    if (available && m < minMinutes) { available = false; why = 'too_soon'; }

    if (available || includeTaken) {
      slots.push({
        time: minToHHMM(m),
        label: minTo12h(m),
        minutes: m,
        end_minutes: end,
        available,
        ...(includeTaken && why ? { reason: why } : {}),
      });
    }
  }

  return {
    date,
    open: true,
    doctor_id: doctor.id,
    doctor_name: doctor.name,
    service_id: service?.id ?? null,
    duration_min: duration,
    interval_min: interval,
    timezone: tz,
    hours: { open: minToHHMM(win.open), close: minToHHMM(win.close) },
    slots,
  };
}

/**
 * Which of the next N days have at least one free slot - powers the calendar
 * step, so patients never click into an empty day.
 */
export function getMonthOverview({ from, days = 30, serviceId = null, doctorId = null }) {
  const settings = settingsRepo.get();
  const tz = settings.timezone || 'Asia/Kolkata';
  const start = isDateStr(from) ? from : todayIn(tz);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const day = getDayAvailability({ date, serviceId, doctorId });
    out.push({
      date,
      open: day.open,
      reason: day.reason ?? null,
      reason_text: day.reason_text ?? null,
      available_count: day.slots.filter(s => s.available).length,
    });
  }
  return out;
}

/**
 * Validate a requested slot before booking. The booking path calls this *and*
 * relies on the database constraint - this produces good error messages, the
 * constraint produces the guarantee.
 */
export function validateSlot({ date, time, serviceId, doctorId }) {
  const day = getDayAvailability({ date, serviceId, doctorId });
  if (!day.open) return { ok: false, code: day.reason || 'CLOSED', day };
  const slot = day.slots.find(s => s.time === time && s.available);
  if (!slot) return { ok: false, code: 'SLOT_UNAVAILABLE', day };

  const settings = settingsRepo.get();
  const tz = settings.timezone || 'Asia/Kolkata';
  return {
    ok: true,
    slot: {
      date,
      start_min: slot.minutes,
      end_min: slot.end_minutes,
      duration_min: day.duration_min,
      interval_min: day.interval_min,
      doctor_id: day.doctor_id,
      starts_at_utc: localToUtc(date, slot.minutes, tz).toISOString(),
    },
  };
}

/** Next date with any availability, for the "soonest appointment" hint. */
export function nextAvailableDate({ serviceId = null, doctorId = null, within = 60 } = {}) {
  const settings = settingsRepo.get();
  const tz = settings.timezone || 'Asia/Kolkata';
  const start = todayIn(tz);
  for (let i = 0; i < within; i++) {
    const date = addDays(start, i);
    const day = getDayAvailability({ date, serviceId, doctorId });
    const free = day.slots.filter(s => s.available);
    if (free.length) return { date, first: free[0].time, label: free[0].label, count: free.length };
  }
  return null;
}
