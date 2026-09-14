import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

let ctx;
const SUITE = 'booking';
let svc, apptRepo, notifRepo, settingsRepo, availability, time, patientsRepo;

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  svc = await import('../src/services/appointment.service.js');
  apptRepo = await import('../src/repositories/appointments.repo.js');
  patientsRepo = await import('../src/repositories/patients.repo.js');
  notifRepo = await import('../src/repositories/notifications.repo.js');
  settingsRepo = await import('../src/repositories/settings.repo.js');
  availability = await import('../src/services/availability.service.js');
  time = await import('../src/utils/time.js');
});
after(async () => { await cleanup(ctx); });

const nextMonday = async (offsetWeeks = 0) => {
  const tz = (await settingsRepo.get()).timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return time.addDays(d, offsetWeeks * 7);
};

describe('appointment booking', () => {
  test('creates an appointment with a booking reference', async () => {
    const appt = await svc.createAppointment({
      name: 'Asha Patel', phone: '9876543210', email: 'asha@example.com',
      date: await nextMonday(), time: '09:00', serviceId: 1,
    });
    assert.match(appt.ref, /^SDC-\d{4}-\d{5}$/);
    assert.equal(appt.status, 'pending');
    assert.equal(appt.patient_phone, '919876543210', 'phone is normalised');
    assert.equal(appt.service_name, 'General Dentistry');
  });

  test('rejects an invalid mobile number', async () => {
    await assert.rejects(async () => svc.createAppointment({
      name: 'Bad Phone', phone: '12345', date: await nextMonday(), time: '09:30', serviceId: 1,
    }), (err) => err.code === 'INVALID_PHONE' && err.status === 400);
  });

  test('rejects a slot that is already booked', async () => {
    const date = await nextMonday();
    await svc.createAppointment({ name: 'First', phone: '9876500001', date, time: '11:00', serviceId: 1 });
    await assert.rejects(async () => svc.createAppointment({
      name: 'Second', phone: '9876500002', date, time: '11:00', serviceId: 1,
    }), (err) => ['SLOT_TAKEN', 'SLOT_UNAVAILABLE'].includes(err.code) && err.status === 409);
  });

  test('rejects booking on a closed day', async () => {
    // Close Thursday explicitly instead of assuming a particular weekday is shut.
    let thursday = await nextMonday();
    while (time.weekdayOf(thursday) !== 4) thursday = time.addDays(thursday, 1);
    const original = await settingsRepo.getHoursFor(4);
    await settingsRepo.upsertHours(4, { ...original, is_open: false });
    try {
      await assert.rejects(async () => svc.createAppointment({
        name: 'Closed Day', phone: '9876500003', date: thursday, time: '10:00', serviceId: 1,
      }), (err) => err.code === 'CLOSED');
    } finally {
      await settingsRepo.upsertHours(4, { ...original, is_open: true });
    }
  });

  test('rejects booking inside the lunch break', async () => {
    const weekday = time.weekdayOf(await nextMonday());
    const hours = await settingsRepo.getHoursFor(weekday);
    assert.ok(hours.break_start_min != null, 'this test needs a configured break');
    const breakTime = time.minToHHMM(hours.break_start_min);
    await assert.rejects(async () => svc.createAppointment({
      name: 'Break Time', phone: '9876500004', date: await nextMonday(), time: breakTime, serviceId: 1,
    }), (err) => err.code === 'SLOT_UNAVAILABLE');
  });

  test('reuses the patient record for a repeat phone number', async () => {
    const date = await nextMonday(1);
    const a = await svc.createAppointment({ name: 'Repeat Patient', phone: '9876511111', date, time: '09:00', serviceId: 1 });
    const b = await svc.createAppointment({ name: 'Repeat Patient', phone: '9876511111', date, time: '09:30', serviceId: 1 });
    assert.equal(a.patient_id, b.patient_id, 'same phone must map to one patient');
    assert.equal((await patientsRepo.findByPhone('919876511111')).code, a.patient_code);
  });

  test('cancelling frees the slot for another patient', async () => {
    const date = await nextMonday(2);
    const a = await svc.createAppointment({ name: 'Canceller', phone: '9876522222', date, time: '10:00', serviceId: 1 });
    assert.equal((await availability.validateSlot({ date, time: '10:00', serviceId: 1 })).ok, false);

    await svc.cancel(a.id, { reason: 'Changed plans' });
    assert.equal((await apptRepo.findById(a.id)).status, 'cancelled');
    assert.equal((await availability.validateSlot({ date, time: '10:00', serviceId: 1 })).ok, true);

    const b = await svc.createAppointment({ name: 'Next Patient', phone: '9876533333', date, time: '10:00', serviceId: 1 });
    assert.ok(b.id !== a.id);
  });

  test('reschedule moves the appointment and frees the original slot', async () => {
    const date = await nextMonday(3);
    const a = await svc.createAppointment({ name: 'Mover', phone: '9876544444', date, time: '10:00', serviceId: 1 });
    const moved = await svc.reschedule(a.id, { date, time: '15:00' });
    assert.equal(moved.start_min, 900);
    assert.equal(moved.status, 'rescheduled');
    assert.equal((await availability.validateSlot({ date, time: '10:00', serviceId: 1 })).ok, true, 'old slot freed');
    assert.equal((await availability.validateSlot({ date, time: '15:00', serviceId: 1 })).ok, false, 'new slot held');
  });

  test('a failed reschedule leaves the original booking untouched', async () => {
    const date = await nextMonday(4);
    const keep = await svc.createAppointment({ name: 'Keeper', phone: '9876555555', date, time: '09:00', serviceId: 1 });
    const other = await svc.createAppointment({ name: 'Other', phone: '9876566666', date, time: '10:00', serviceId: 1 });

    await assert.rejects(async () => svc.reschedule(other.id, { date, time: '09:00' }),
      (err) => err.status === 409);

    const unchanged = await apptRepo.findById(other.id);
    assert.equal(unchanged.start_min, 600, 'original time preserved');
    assert.equal((await availability.validateSlot({ date, time: '10:00', serviceId: 1 })).ok, false,
      'original slot is still held after the failed move');
    assert.equal((await apptRepo.findById(keep.id)).start_min, 540);
  });

  test('status transitions are recorded in history', async () => {
    const date = await nextMonday(5);
    const a = await svc.createAppointment({ name: 'History', phone: '9876577777', date, time: '09:00', serviceId: 1 });
    await svc.confirm(a.id);
    await svc.changeStatus(a.id, 'checked_in');
    await svc.changeStatus(a.id, 'completed');
    const history = (await apptRepo.history(a.id)).map((h) => h.to_status);
    assert.deepEqual(history, ['pending', 'confirmed', 'checked_in', 'completed']);
  });

  test('no-show releases the slot', async () => {
    const date = await nextMonday(6);
    const a = await svc.createAppointment({ name: 'Absent', phone: '9876588888', date, time: '09:00', serviceId: 1 });
    await svc.changeStatus(a.id, 'no_show');
    assert.equal((await availability.validateSlot({ date, time: '09:00', serviceId: 1 })).ok, true);
  });
});

describe('notification isolation (spec §33)', () => {
  test('booking succeeds and queues notifications when no provider is configured', async () => {
    const before = (await notifRepo.list({})).total;
    const appt = await svc.createAppointment({
      name: 'Notify Test', phone: '9876599999', email: 'n@example.com',
      date: await nextMonday(7), time: '09:00', serviceId: 1,
    });
    assert.ok(appt.ref, 'appointment was created');
    const after = await notifRepo.list({});
    assert.ok(after.total > before, 'notifications were queued');
    const forAppt = after.rows.filter((n) => n.appointment_id === appt.id);
    assert.ok(forAppt.some((n) => n.channel === 'whatsapp' && n.recipient_role === 'patient'));
    assert.ok(forAppt.some((n) => n.recipient_role === 'clinic'), 'clinic is alerted too');
  });

  test('a provider failure never destroys the appointment', async () => {
    const appt = await svc.createAppointment({
      name: 'Resilient', phone: '9876512121', date: await nextMonday(7), time: '09:30', serviceId: 1,
    });
    const notifications = await import('../src/services/notification/index.js');
    // No provider is configured in tests, so every send resolves as not_configured.
    await notifications.processQueue(50);

    const stored = await apptRepo.findById(appt.id);
    assert.equal(stored.status, 'pending', 'appointment survives delivery problems');

    const rows = (await notifRepo.list({})).rows.filter((n) => n.appointment_id === appt.id);
    assert.ok(rows.every((n) => n.status === 'not_configured'),
      'unsent messages are recorded honestly, never marked as sent');
    assert.ok(rows.every((n) => n.last_error && n.last_error.length > 0), 'the reason is recorded');
  });

  test('reminders are deduplicated', async () => {
    const appt = await svc.createAppointment({
      name: 'Reminder', phone: '9876513131', date: await nextMonday(7), time: '10:00', serviceId: 1,
    });
    const { reminder } = await import('../src/jobs/handlers/reminders.js');
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    const count = (await notifRepo.list({})).rows
      .filter((n) => n.appointment_id === appt.id && n.template === 'reminder_24h' && n.channel === 'whatsapp').length;
    assert.equal(count, 1, 'the same reminder must not be queued twice');
  });

  test('a cancelled appointment produces no reminder', async () => {
    const appt = await svc.createAppointment({
      name: 'Cancelled Reminder', phone: '9876514141', date: await nextMonday(7), time: '10:30', serviceId: 1,
    });
    await svc.cancel(appt.id, { reason: 'test' });
    const { reminder } = await import('../src/jobs/handlers/reminders.js');
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    const count = (await notifRepo.list({})).rows
      .filter((n) => n.appointment_id === appt.id && n.template === 'reminder_24h').length;
    assert.equal(count, 0);
  });
});
