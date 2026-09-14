import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

let ctx;
const SUITE = 'avail';
let availability, settingsRepo, apptRepo, patientsRepo, tx, time;

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  availability = await import('../src/services/availability.service.js');
  settingsRepo = await import('../src/repositories/settings.repo.js');
  apptRepo = await import('../src/repositories/appointments.repo.js');
  patientsRepo = await import('../src/repositories/patients.repo.js');
  time = await import('../src/utils/time.js');
  ({ tx } = await import('../src/db/index.js'));
});
after(async () => { await cleanup(ctx); });

/** A Monday comfortably inside the booking horizon. */
const monday = async () => {
  const tz = (await settingsRepo.get()).timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return d;
};

describe('availability engine', () => {
  test('generates slots inside clinic hours', async () => {
    // Derived from the configured hours rather than hardcoded, so changing the
    // clinic's timetable does not break the test.
    const weekday = time.weekdayOf(await monday());
    const configured = await settingsRepo.getHoursFor(weekday);
    const day = await availability.getDayAvailability({ date: await monday(), serviceId: 1 });

    assert.equal(day.open, true);
    assert.equal(day.hours.open, time.minToHHMM(configured.open_min));
    assert.equal(day.hours.close, time.minToHHMM(configured.close_min));
    assert.ok(day.slots.length > 0);
    assert.ok(day.slots.every((s) => s.minutes >= configured.open_min),
      'no slot starts before opening');
    assert.ok(day.slots.every((s) => s.end_minutes <= configured.close_min),
      'no slot runs past closing');
  });

  test('excludes the configured lunch break', async () => {
    const weekday = time.weekdayOf(await monday());
    const configured = await settingsRepo.getHoursFor(weekday);
    assert.ok(configured.break_start_min != null, 'this test needs a configured break');

    const day = await availability.getDayAvailability({ date: await monday(), serviceId: 1 });
    const offered = day.slots.map((s) => s.minutes);

    for (let m = configured.break_start_min; m < configured.break_end_min; m += day.interval_min) {
      assert.ok(!offered.includes(m), `${time.minToHHMM(m)} is inside the break and must not be offered`);
    }
    assert.ok(offered.includes(configured.break_end_min),
      `${time.minToHHMM(configured.break_end_min)} is after the break and should be offered`);
    assert.ok(offered.some((m) => m < configured.break_start_min), 'morning slots still exist');
  });

  test('reports a day the clinic has marked closed', async () => {
    // Close Wednesday explicitly rather than assuming any weekday is shut.
    let wednesday = await monday();
    while (time.weekdayOf(wednesday) !== 3) wednesday = time.addDays(wednesday, 1);
    const original = await settingsRepo.getHoursFor(3);
    await settingsRepo.upsertHours(3, { ...original, is_open: false });
    try {
      const day = await availability.getDayAvailability({ date: wednesday, serviceId: 1 });
      assert.equal(day.open, false);
      assert.equal(day.reason, 'CLOSED');
      assert.deepEqual(day.slots, []);
    } finally {
      await settingsRepo.upsertHours(3, { ...original, is_open: true });
    }
  });

  test('rejects past dates and dates beyond the horizon', async () => {
    const tz = (await settingsRepo.get()).timezone;
    const past = await availability.getDayAvailability({ date: time.addDays(time.todayIn(tz), -1) });
    assert.equal(past.reason, 'PAST_DATE');
    const far = await availability.getDayAvailability({ date: time.addDays(time.todayIn(tz), 400) });
    assert.equal(far.reason, 'BEYOND_HORIZON');
  });

  test('a full-day holiday closes the date', async () => {
    const date = await monday();
    const id = await settingsRepo.addHoliday({ date, reason: 'Festival' });
    const day = await availability.getDayAvailability({ date, serviceId: 1 });
    assert.equal(day.open, false);
    assert.equal(day.reason, 'HOLIDAY');
    assert.equal(day.reason_text, 'Festival');
    await settingsRepo.deleteHoliday(id);
  });

  test('blocked slots are removed from availability', async () => {
    const date = await monday();
    const id = await settingsRepo.addBlocked({ doctor_id: 1, date, start_min: 540, end_min: 660, reason: 'Servicing' });
    const day = await availability.getDayAvailability({ date, serviceId: 1 });
    const times = day.slots.map((s) => s.time);
    assert.ok(!times.includes('09:00'));
    assert.ok(!times.includes('10:30'));
    assert.ok(times.includes('11:00'));
    await settingsRepo.deleteBlocked(id);
  });

  test('a 60-minute booking consumes two 30-minute slots', async () => {
    const date = time.addDays(await monday(), 7);
    const { patient } = await patientsRepo.upsertByPhone({ name: 'Slot Test', phone: '919000000001' });
    const check = await availability.validateSlot({ date, time: '10:00', serviceId: 4 });
    assert.equal(check.ok, true);
    assert.equal(check.slot.duration_min, 60);

    await tx(async () => await apptRepo.insertWithSlots({
      patient_id: patient.id, doctor_id: check.slot.doctor_id, service_id: 4,
      service_name: 'RCT', date, start_min: check.slot.start_min, end_min: check.slot.end_min,
      duration_min: 60, starts_at_utc: check.slot.starts_at_utc,
    }, check.slot.interval_min));

    const after = await availability.getDayAvailability({ date, serviceId: 1 });
    const times = after.slots.map((s) => s.time);
    assert.ok(!times.includes('10:00'), '10:00 must be taken');
    assert.ok(!times.includes('10:30'), '10:30 must also be taken by the 60-min booking');
    assert.ok(times.includes('11:00'));
  });

  test('a service cannot be booked if it would run past closing', async () => {
    const closeMin = (await settingsRepo.getHoursFor(time.weekdayOf(await monday()))).close_min;
    const day = await availability.getDayAvailability({ date: await monday(), serviceId: 4 });
    const last = day.slots[day.slots.length - 1];
    assert.ok(last.end_minutes <= closeMin, 'last slot must finish by closing time');
    assert.equal(day.duration_min, 60, 'this service is an hour long');
  });

  test('validateSlot rejects a time that is not on the grid', async () => {
    const r = await availability.validateSlot({ date: await monday(), time: '10:07', serviceId: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SLOT_UNAVAILABLE');
  });
});

describe('timezone handling', () => {
  test('local clinic time converts to the correct UTC instant', async () => {
    const utc = time.localToUtc('2026-09-15', 630, 'Asia/Kolkata');
    assert.equal(utc.toISOString(), '2026-09-15T05:00:00.000Z');
  });
  test('round-trips through UTC without drift', async () => {
    const utc = time.localToUtc('2026-09-15', 630, 'Asia/Kolkata');
    const local = time.utcToLocal(utc, 'Asia/Kolkata');
    assert.equal(local.date, '2026-09-15');
    assert.equal(local.minutes, 630);
  });
  test('handles a DST timezone correctly on both sides of the change', async () => {
    assert.equal(time.localToUtc('2026-07-01', 630, 'America/New_York').toISOString(), '2026-07-01T14:30:00.000Z');
    assert.equal(time.localToUtc('2026-01-15', 630, 'America/New_York').toISOString(), '2026-01-15T15:30:00.000Z');
  });
});
