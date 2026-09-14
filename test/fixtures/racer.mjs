/* One competing writer, used by concurrency.test.mjs. Prints a single JSON line.
   Runs as its own OS process so the race is genuine: a pooled Postgres client
   per process, contending on the appointment_slots unique index. */
const [, , index, date, slot, startAt, serviceId] = process.argv;

const svc = await import('../../src/services/appointment.service.js');
const { closeDb } = await import('../../src/db/index.js');

// Busy-wait to the shared barrier so every process collides at the same instant.
const target = Number(startAt);
while (Date.now() < target) { /* spin */ }

try {
  const appt = await svc.createAppointment({
    name: `Racer ${index}`,
    phone: `98765${String(10000 + Number(index)).padStart(5, '0')}`,
    date, time: slot, serviceId: Number(serviceId),
  }, {});
  process.stdout.write(JSON.stringify({ ok: true, ref: appt.ref }) + '\n');
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, code: err.code, msg: err.message }) + '\n');
}
await closeDb();
process.exit(0);
