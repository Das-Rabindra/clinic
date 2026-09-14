import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

const dir = setupEnv('avail');
let availability, settingsRepo, apptRepo, patientsRepo, tx, time;

before(async () => {
  await bootDb();
  availability = await import('../src/services/availability.service.js');
  settingsRepo = await import('../src/repositories/settings.repo.js');
  apptRepo = await import('../src/repositories/appointments.repo.js');
  patientsRepo = await import('../src/repositories/patients.repo.js');
  time = await import('../src/utils/time.js');
  ({ tx } = await import('../src/db/index.js'));
});
after(() => cleanup(dir));

/** A Monday comfortably inside the booking horizon. */
const monday = () => {
  const tz = settingsRepo.get().timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return d;
};

describe('availability engine', () => {
  test('generates slots inside clinic hours', () => {
    // Derived from the configured hours rather than hardcoded, so changing the
    // clinic's timetable does not break the test.
    const weekday = time.weekdayOf(monday());
    const configured = settingsRepo.getHoursFor(weekday);
    const day = availability.getDayAvailability({ date: monday(), serviceId: 1 });

    assert.equal(day.open, true);
    assert.equal(day.hours.open, time.minToHHMM(configured.open_min));
    assert.equal(day.hours.close, time.minToHHMM(configured.close_min));
    assert.ok(day.slots.length > 0);
    assert.ok(day.slots.every((s) => s.minutes >= configured.open_min),
      'no slot starts before opening');
    assert.ok(day.slots.every((s) => s.end_minutes <= configured.close_min),
      'no slot runs past closing');
  });

  test('excludes the configured lunch break', () => {
    const weekday = time.weekdayOf(monday());
    const configured = settingsRepo.getHoursFor(weekday);
    assert.ok(configured.break_start_min != null, 'this test needs a configured break');

    const day = availability.getDayAvailability({ date: monday(), serviceId: 1 });
    const offered = day.slots.map((s) => s.minutes);

    for (let m = configured.break_start_min; m < configured.break_end_min; m += day.interval_min) {
      assert.ok(!offered.includes(m), `${time.minToHHMM(m)} is inside the break and must not be offered`);
    }
    assert.ok(offered.includes(configured.break_end_min),
      `${time.minToHHMM(configured.break_end_min)} is after the break and should be offered`);
    assert.ok(offered.some((m) => m < configured.break_start_min), 'morning slots still exist');
  });

  test('reports a day the clinic has marked closed', () => {
    // Close Wednesday explicitly rather than assuming any weekday is shut.
    const wednesday = (() => {
      let d = monday();
      while (time.weekdayOf(d) !== 3) d = time.addDays(d, 1);
      return d;
    })();
    const original = settingsRepo.getHoursFor(3);
    settingsRepo.upsertHours(3, { ...original, is_open: false });
    try {
      const day = availability.getDayAvailability({ date: wednesday, serviceId: 1 });
      assert.equal(day.open, false);
      assert.equal(day.reason, 'CLOSED');
      assert.deepEqual(day.slots, []);
    } finally {
      settingsRepo.upsertHours(3, { ...original, is_open: true });
    }
  });

  test('rejects past dates and dates beyond the horizon', () => {
    const tz = settingsRepo.get().timezone;
    const past = availability.getDayAvailability({ date: time.addDays(time.todayIn(tz), -1) });
    assert.equal(past.reason, 'PAST_DATE');
    const far = availability.getDayAvailability({ date: time.addDays(time.todayIn(tz), 400) });
    assert.equal(far.reason, 'BEYOND_HORIZON');
  });

  test('a full-day holiday closes the date', () => {
    const date = monday();
    const id = settingsRepo.addHoliday({ date, reason: 'Festival' });
    const day = availability.getDayAvailability({ date, serviceId: 1 });
    assert.equal(day.open, false);
    assert.equal(day.reason, 'HOLIDAY');
    assert.equal(day.reason_text, 'Festival');
    settingsRepo.deleteHoliday(id);
  });

  test('blocked slots are removed from availability', () => {
    const date = monday();
    const id = settingsRepo.addBlocked({ doctor_id: 1, date, start_min: 540, end_min: 660, reason: 'Servicing' });
    const day = availability.getDayAvailability({ date, serviceId: 1 });
    const times = day.slots.map((s) => s.time);
    assert.ok(!times.includes('09:00'));
    assert.ok(!times.includes('10:30'));
    assert.ok(times.includes('11:00'));
    settingsRepo.deleteBlocked(id);
  });

  test('a 60-minute booking consumes two 30-minute slots', () => {
    const date = time.addDays(monday(), 7);
    const { patient } = patientsRepo.upsertByPhone({ name: 'Slot Test', phone: '919000000001' });
    const check = availability.validateSlot({ date, time: '10:00', serviceId: 4 });
    assert.equal(check.ok, true);
    assert.equal(check.slot.duration_min, 60);

    tx(() => apptRepo.insertWithSlots({
      patient_id: patient.id, doctor_id: check.slot.doctor_id, service_id: 4,
      service_name: 'RCT', date, start_min: check.slot.start_min, end_min: check.slot.end_min,
      duration_min: 60, starts_at_utc: check.slot.starts_at_utc,
    }, check.slot.interval_min));

    const after = availability.getDayAvailability({ date, serviceId: 1 });
    const times = after.slots.map((s) => s.time);
    assert.ok(!times.includes('10:00'), '10:00 must be taken');
    assert.ok(!times.includes('10:30'), '10:30 must also be taken by the 60-min booking');
    assert.ok(times.includes('11:00'));
  });

  test('a service cannot be booked if it would run past closing', () => {
    const closeMin = settingsRepo.getHoursFor(time.weekdayOf(monday())).close_min;
    const day = availability.getDayAvailability({ date: monday(), serviceId: 4 });
    const last = day.slots[day.slots.length - 1];
    assert.ok(last.end_minutes <= closeMin, 'last slot must finish by closing time');
    assert.equal(day.duration_min, 60, 'this service is an hour long');
  });

  test('validateSlot rejects a time that is not on the grid', () => {
    const r = availability.validateSlot({ date: monday(), time: '10:07', serviceId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SLOT_UNAVAILABLE');
  });
});

describe('timezone handling', () => {
  test('local clinic time converts to the correct UTC instant', () => {
    const utc = time.localToUtc('2026-09-15', 630, 'Asia/Kolkata');
    assert.equal(utc.toISOString(), '2026-09-15T05:00:00.000Z');
  });
  test('round-trips through UTC without drift', () => {
    const utc = time.localToUtc('2026-09-15', 630, 'Asia/Kolkata');
    const local = time.utcToLocal(utc, 'Asia/Kolkata');
    assert.equal(local.date, '2026-09-15');
    assert.equal(local.minutes, 630);
  });
  test('handles a DST timezone correctly on both sides of the change', () => {
    assert.equal(time.localToUtc('2026-07-01', 630, 'America/New_York').toISOString(), '2026-07-01T14:30:00.000Z');
    assert.equal(time.localToUtc('2026-01-15', 630, 'America/New_York').toISOString(), '2026-01-15T15:30:00.000Z');
  });
});
