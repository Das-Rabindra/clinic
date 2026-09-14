import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

const dir = setupEnv('booking');
let svc, apptRepo, notifRepo, settingsRepo, availability, time, patientsRepo;

before(async () => {
  await bootDb();
  svc = await import('../src/services/appointment.service.js');
  apptRepo = await import('../src/repositories/appointments.repo.js');
  patientsRepo = await import('../src/repositories/patients.repo.js');
  notifRepo = await import('../src/repositories/notifications.repo.js');
  settingsRepo = await import('../src/repositories/settings.repo.js');
  availability = await import('../src/services/availability.service.js');
  time = await import('../src/utils/time.js');
});
after(() => cleanup(dir));

const nextMonday = (offsetWeeks = 0) => {
  const tz = settingsRepo.get().timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return time.addDays(d, offsetWeeks * 7);
};

describe('appointment booking', () => {
  test('creates an appointment with a booking reference', () => {
    const appt = svc.createAppointment({
      name: 'Asha Patel', phone: '9876543210', email: 'asha@example.com',
      date: nextMonday(), time: '09:00', serviceId: 1,
    });
    assert.match(appt.ref, /^SDC-\d{4}-\d{5}$/);
    assert.equal(appt.status, 'pending');
    assert.equal(appt.patient_phone, '919876543210', 'phone is normalised');
    assert.equal(appt.service_name, 'General Dentistry');
  });

  test('rejects an invalid mobile number', () => {
    assert.throws(() => svc.createAppointment({
      name: 'Bad Phone', phone: '12345', date: nextMonday(), time: '09:30', serviceId: 1,
    }), (err) => err.code === 'INVALID_PHONE' && err.status === 400);
  });

  test('rejects a slot that is already booked', () => {
    const date = nextMonday();
    svc.createAppointment({ name: 'First', phone: '9876500001', date, time: '11:00', serviceId: 1 });
    assert.throws(() => svc.createAppointment({
      name: 'Second', phone: '9876500002', date, time: '11:00', serviceId: 1,
    }), (err) => ['SLOT_TAKEN', 'SLOT_UNAVAILABLE'].includes(err.code) && err.status === 409);
  });

  test('rejects booking on a closed day', () => {
    // Close Thursday explicitly instead of assuming a particular weekday is shut.
    let thursday = nextMonday();
    while (time.weekdayOf(thursday) !== 4) thursday = time.addDays(thursday, 1);
    const original = settingsRepo.getHoursFor(4);
    settingsRepo.upsertHours(4, { ...original, is_open: false });
    try {
      assert.throws(() => svc.createAppointment({
        name: 'Closed Day', phone: '9876500003', date: thursday, time: '10:00', serviceId: 1,
      }), (err) => err.code === 'CLOSED');
    } finally {
      settingsRepo.upsertHours(4, { ...original, is_open: true });
    }
  });

  test('rejects booking inside the lunch break', () => {
    const weekday = time.weekdayOf(nextMonday());
    const hours = settingsRepo.getHoursFor(weekday);
    assert.ok(hours.break_start_min != null, 'this test needs a configured break');
    const breakTime = time.minToHHMM(hours.break_start_min);
    assert.throws(() => svc.createAppointment({
      name: 'Break Time', phone: '9876500004', date: nextMonday(), time: breakTime, serviceId: 1,
    }), (err) => err.code === 'SLOT_UNAVAILABLE');
  });

  test('reuses the patient record for a repeat phone number', () => {
    const date = nextMonday(1);
    const a = svc.createAppointment({ name: 'Repeat Patient', phone: '9876511111', date, time: '09:00', serviceId: 1 });
    const b = svc.createAppointment({ name: 'Repeat Patient', phone: '9876511111', date, time: '09:30', serviceId: 1 });
    assert.equal(a.patient_id, b.patient_id, 'same phone must map to one patient');
    assert.equal(patientsRepo.findByPhone('919876511111').code, a.patient_code);
  });

  test('cancelling frees the slot for another patient', () => {
    const date = nextMonday(2);
    const a = svc.createAppointment({ name: 'Canceller', phone: '9876522222', date, time: '10:00', serviceId: 1 });
    assert.equal(availability.validateSlot({ date, time: '10:00', serviceId: 1 }).ok, false);

    svc.cancel(a.id, { reason: 'Changed plans' });
    assert.equal(apptRepo.findById(a.id).status, 'cancelled');
    assert.equal(availability.validateSlot({ date, time: '10:00', serviceId: 1 }).ok, true);

    const b = svc.createAppointment({ name: 'Next Patient', phone: '9876533333', date, time: '10:00', serviceId: 1 });
    assert.ok(b.id !== a.id);
  });

  test('reschedule moves the appointment and frees the original slot', () => {
    const date = nextMonday(3);
    const a = svc.createAppointment({ name: 'Mover', phone: '9876544444', date, time: '10:00', serviceId: 1 });
    const moved = svc.reschedule(a.id, { date, time: '15:00' });
    assert.equal(moved.start_min, 900);
    assert.equal(moved.status, 'rescheduled');
    assert.equal(availability.validateSlot({ date, time: '10:00', serviceId: 1 }).ok, true, 'old slot freed');
    assert.equal(availability.validateSlot({ date, time: '15:00', serviceId: 1 }).ok, false, 'new slot held');
  });

  test('a failed reschedule leaves the original booking untouched', () => {
    const date = nextMonday(4);
    const keep = svc.createAppointment({ name: 'Keeper', phone: '9876555555', date, time: '09:00', serviceId: 1 });
    const other = svc.createAppointment({ name: 'Other', phone: '9876566666', date, time: '10:00', serviceId: 1 });

    assert.throws(() => svc.reschedule(other.id, { date, time: '09:00' }),
      (err) => err.status === 409);

    const unchanged = apptRepo.findById(other.id);
    assert.equal(unchanged.start_min, 600, 'original time preserved');
    assert.equal(availability.validateSlot({ date, time: '10:00', serviceId: 1 }).ok, false,
      'original slot is still held after the failed move');
    assert.equal(apptRepo.findById(keep.id).start_min, 540);
  });

  test('status transitions are recorded in history', () => {
    const date = nextMonday(5);
    const a = svc.createAppointment({ name: 'History', phone: '9876577777', date, time: '09:00', serviceId: 1 });
    svc.confirm(a.id);
    svc.changeStatus(a.id, 'checked_in');
    svc.changeStatus(a.id, 'completed');
    const history = apptRepo.history(a.id).map((h) => h.to_status);
    assert.deepEqual(history, ['pending', 'confirmed', 'checked_in', 'completed']);
  });

  test('no-show releases the slot', () => {
    const date = nextMonday(6);
    const a = svc.createAppointment({ name: 'Absent', phone: '9876588888', date, time: '09:00', serviceId: 1 });
    svc.changeStatus(a.id, 'no_show');
    assert.equal(availability.validateSlot({ date, time: '09:00', serviceId: 1 }).ok, true);
  });
});

describe('notification isolation (spec §33)', () => {
  test('booking succeeds and queues notifications when no provider is configured', () => {
    const before = notifRepo.list({}).total;
    const appt = svc.createAppointment({
      name: 'Notify Test', phone: '9876599999', email: 'n@example.com',
      date: nextMonday(7), time: '09:00', serviceId: 1,
    });
    assert.ok(appt.ref, 'appointment was created');
    const after = notifRepo.list({});
    assert.ok(after.total > before, 'notifications were queued');
    const forAppt = after.rows.filter((n) => n.appointment_id === appt.id);
    assert.ok(forAppt.some((n) => n.channel === 'whatsapp' && n.recipient_role === 'patient'));
    assert.ok(forAppt.some((n) => n.recipient_role === 'clinic'), 'clinic is alerted too');
  });

  test('a provider failure never destroys the appointment', async () => {
    const appt = svc.createAppointment({
      name: 'Resilient', phone: '9876512121', date: nextMonday(7), time: '09:30', serviceId: 1,
    });
    const notifications = await import('../src/services/notification/index.js');
    // No provider is configured in tests, so every send resolves as not_configured.
    await notifications.processQueue(50);

    const stored = apptRepo.findById(appt.id);
    assert.equal(stored.status, 'pending', 'appointment survives delivery problems');

    const rows = notifRepo.list({}).rows.filter((n) => n.appointment_id === appt.id);
    assert.ok(rows.every((n) => n.status === 'not_configured'),
      'unsent messages are recorded honestly, never marked as sent');
    assert.ok(rows.every((n) => n.last_error && n.last_error.length > 0), 'the reason is recorded');
  });

  test('reminders are deduplicated', async () => {
    const appt = svc.createAppointment({
      name: 'Reminder', phone: '9876513131', date: nextMonday(7), time: '10:00', serviceId: 1,
    });
    const { reminder } = await import('../src/jobs/handlers/reminders.js');
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    const count = notifRepo.list({}).rows
      .filter((n) => n.appointment_id === appt.id && n.template === 'reminder_24h' && n.channel === 'whatsapp').length;
    assert.equal(count, 1, 'the same reminder must not be queued twice');
  });

  test('a cancelled appointment produces no reminder', async () => {
    const appt = svc.createAppointment({
      name: 'Cancelled Reminder', phone: '9876514141', date: nextMonday(7), time: '10:30', serviceId: 1,
    });
    svc.cancel(appt.id, { reason: 'test' });
    const { reminder } = await import('../src/jobs/handlers/reminders.js');
    await reminder({ appointmentId: appt.id, template: 'reminder_24h' });
    const count = notifRepo.list({}).rows
      .filter((n) => n.appointment_id === appt.id && n.template === 'reminder_24h').length;
    assert.equal(count, 0);
  });
});
