/**
 * The double-booking guarantee.
 *
 * SQLite writes are serialised in-process, so a genuine race needs separate OS
 * processes competing for the same database file. Each child aligns on a shared
 * timestamp barrier and then tries to claim the identical slot.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let ctx;
const SUITE = 'race';
let settingsRepo, apptRepo, time, availability;

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  settingsRepo = await import('../src/repositories/settings.repo.js');
  apptRepo = await import('../src/repositories/appointments.repo.js');
  time = await import('../src/utils/time.js');
  availability = await import('../src/services/availability.service.js');
});
after(async () => { await cleanup(ctx); });

const nextMonday = async (offsetWeeks = 0) => {
  const tz = (await settingsRepo.get()).timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return time.addDays(d, offsetWeeks * 7);
};

/** Spawn N processes that all try to book (date, slot) at the same instant. */
async function stampede(n, date, slot, serviceId = 1) {
  const startAt = Date.now() + 1200;
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL,   // the suite's isolated database
    DATA_DIR: process.env.DATA_DIR,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    APP_SECRET: process.env.APP_SECRET,
    RUN_JOBS: 'false',
    NODE_ENV: 'test',
  };
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      run(process.execPath, [path.join(here, 'fixtures', 'racer.mjs'),
        String(i), date, slot, String(startAt), String(serviceId)], { env, cwd: path.join(here, '..') })
        .then(({ stdout }) => JSON.parse(stdout.trim().split('\n').pop()))
        .catch((err) => ({ ok: false, code: 'PROCESS_ERROR', msg: String(err.message).slice(0, 300) })))
  );
  return results;
}

describe('double-booking prevention', () => {
  test('16 concurrent processes: exactly one booking is created', async () => {
    const date = await nextMonday();
    const slot = '10:00';
    const results = await stampede(16, date, slot);

    const wins = results.filter((r) => r.ok);
    const rejected = results.filter((r) => !r.ok && ['SLOT_TAKEN', 'SLOT_UNAVAILABLE'].includes(r.code));
    const unexpected = results.filter((r) => !r.ok && !['SLOT_TAKEN', 'SLOT_UNAVAILABLE'].includes(r.code));

    assert.deepEqual(unexpected, [], 'no process should crash or error unexpectedly');
    assert.equal(wins.length, 1, `exactly one booking should win, got ${wins.length}`);
    assert.equal(rejected.length, 15, 'every other process must be cleanly rejected');

    // And the database agrees: one appointment, holding its slots exactly once.
    const held = await apptRepo.occupiedSlots(1, date);
    assert.deepEqual(held, [time.hhmmToMin(slot)],
      `exactly one 30-minute slot is held at ${slot}`);
  }, { timeout: 60000 });

  test('concurrent bookings for different slots all succeed', async () => {
    const date = await nextMonday(1);
    const slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
    const startAt = Date.now() + 1200;
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL, RUN_JOBS: 'false', NODE_ENV: 'test' };

    const results = await Promise.all(slots.map((slot, i) =>
      run(process.execPath, [path.join(here, 'fixtures', 'racer.mjs'),
        String(100 + i), date, slot, String(startAt), '1'], { env, cwd: path.join(here, '..') })
        .then(({ stdout }) => JSON.parse(stdout.trim().split('\n').pop()))
        .catch((err) => ({ ok: false, code: 'PROCESS_ERROR', msg: String(err.message).slice(0, 200) }))));

    const wins = results.filter((r) => r.ok);
    assert.equal(wins.length, slots.length, 'distinct slots must not block each other');
    assert.equal(new Set(wins.map((w) => w.ref)).size, slots.length, 'each gets a unique booking reference');
  }, { timeout: 60000 });

  test('a 60-minute treatment blocks an overlapping 30-minute booking', async () => {
    const date = await nextMonday(2);
    // Pick an hour that is inside opening hours and clear of any break, so the
    // test exercises overlap rather than the break rules.
    const day = await availability.getDayAvailability({ date, serviceId: 4 });
    const anchor = day.slots.find((s) =>
      s.available && day.slots.some((n) => n.minutes === s.minutes + day.interval_min && n.available));
    assert.ok(anchor, 'need two consecutive free slots');

    const second = time.minToHHMM(anchor.minutes + day.interval_min);
    const third = time.minToHHMM(anchor.minutes + day.interval_min * 2);

    // Root canal (id 4) is 60 minutes, so it occupies both anchor and second.
    const first = await stampede(1, date, anchor.time, 4);
    assert.equal(first[0].ok, true, `booking ${anchor.time} should succeed`);

    const overlap = await stampede(1, date, second, 1);
    assert.equal(overlap[0].ok, false, 'the overlapping half of the hour must be unavailable');
    assert.ok(['SLOT_TAKEN', 'SLOT_UNAVAILABLE'].includes(overlap[0].code));

    const after = await stampede(1, date, third, 1);
    assert.equal(after[0].ok, true, 'the slot after the treatment is still free');
  }, { timeout: 60000 });
});
