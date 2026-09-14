/** Public API surface + patient self-service flows. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

const dir = setupEnv('api');
let srv, settingsRepo, time, limiter;

before(async () => {
  await bootDb();
  settingsRepo = await import('../src/repositories/settings.repo.js');
  time = await import('../src/utils/time.js');
  limiter = await import('../src/middleware/ratelimit.js');
  srv = await startServer();
  await srv.call('/api/csrf');
});
after(async () => { await srv.close(); cleanup(dir); });

const nextMonday = (w = 0) => {
  const tz = settingsRepo.get().timezone;
  let d = time.addDays(time.todayIn(tz), 3);
  while (time.weekdayOf(d) !== 1) d = time.addDays(d, 1);
  return time.addDays(d, w * 7);
};
const post = (path, json) => srv.call(path, { headers: { 'X-CSRF-Token': srv.csrf() }, json });

describe('public API', () => {
  test('serves clinic details with composed address and hours', async () => {
    const r = await srv.call('/api/clinic');
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Samal Dental Care');
    assert.match(r.body.address, /Annapurna Market Complex/);
    assert.equal(r.body.hours.length, 7);
    assert.ok(r.body.directions_url.startsWith('https://www.google.com/maps'));
    assert.ok('is_open' in r.body.today);
  });

  test('serves only active services', async () => {
    const r = await srv.call('/api/services');
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 8);
    assert.ok(r.body.every((s) => typeof s.duration_min === 'number'));
  });

  test('serves published FAQs with placeholders resolved on the page', async () => {
    const r = await srv.call('/api/faqs');
    assert.ok(r.body.length >= 5);
    const page = await srv.call('/');
    assert.ok(!page.body.includes('{{phone}}'), 'placeholders must be resolved when rendered');
    assert.ok(!page.body.includes('{{address}}'));
  });

  test('reports an honest empty reviews state', async () => {
    const r = await srv.call('/api/reviews');
    assert.deepEqual(r.body.reviews, []);
    assert.equal(r.body.count, 0);
    assert.equal(r.body.average, null, 'no rating is invented when nothing is synced');
  });

  test('omits AggregateRating from structured data when there are no reviews', async () => {
    const page = await srv.call('/');
    assert.ok(page.body.includes('"@type":"Dentist"'));
    assert.ok(!page.body.includes('aggregateRating'), 'never publish a rating without real reviews');
  });

  test('exposes opening hours in structured data', async () => {
    const page = await srv.call('/');
    assert.ok(page.body.includes('OpeningHoursSpecification'));
  });

  test('serves robots.txt and sitemap.xml', async () => {
    const robots = await srv.call('/robots.txt');
    assert.match(robots.body, /Disallow: \/admin/);
    const sitemap = await srv.call('/sitemap.xml');
    assert.match(sitemap.body, /<urlset/);
  });
});

describe('availability API', () => {
  test('returns slots for an open day', async () => {
    const r = await srv.call(`/api/appointments/availability?date=${nextMonday()}&service_id=1`);
    assert.equal(r.status, 200);
    assert.equal(r.body.open, true);
    assert.ok(r.body.slots.length > 0);
    assert.ok(r.body.slots.every((s) => s.available), 'public availability lists only free slots');
  });

  test('rejects a malformed date', async () => {
    const r = await srv.call('/api/appointments/availability?date=13-09-2026');
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'VALIDATION');
  });

  test('the calendar overview reports each day and a next-available hint', async () => {
    const r = await srv.call('/api/appointments/calendar?days=14&service_id=1');
    assert.equal(r.status, 200);
    assert.equal(r.body.days.length, 14);
    assert.ok(r.body.days.every((d) => typeof d.open === 'boolean'));
    assert.ok(r.body.days.every((d) => typeof d.available_count === 'number'));
    assert.ok(r.body.next_available, 'a next-available hint is provided');
  });

  test('a declared holiday shows as closed in the overview', async () => {
    const settings = await import('../src/repositories/settings.repo.js');
    const target = nextMonday(1);
    const id = settings.addHoliday({ date: target, reason: 'Festival' });
    try {
      const r = await srv.call('/api/appointments/calendar?days=21&service_id=1');
      const day = r.body.days.find((d) => d.date === target);
      assert.ok(day, 'the date is within the overview window');
      assert.equal(day.open, false);
      assert.equal(day.reason, 'HOLIDAY');
      assert.equal(day.available_count, 0);
    } finally {
      settings.deleteHoliday(id);
    }
  });
});

describe('patient self-service', () => {
  let ref;
  const phone = '9812345670';

  test('books an appointment', async () => {
    const r = await post('/api/appointments', {
      name: 'Self Service', phone, email: 'ss@example.com',
      date: nextMonday(1), time: '10:00', service_id: 1,
    });
    assert.equal(r.status, 201);
    ref = r.body.appointment.ref;
    assert.match(ref, /^SDC-/);
  });

  test('looks up the booking with the matching phone number', async () => {
    const r = await srv.call(`/api/appointments/${ref}?phone=${phone}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.ref, ref);
    assert.ok(!('patient_phone' in r.body), 'the public view exposes no raw contact data');
  });

  test('refuses a lookup with the wrong phone number', async () => {
    const r = await srv.call(`/api/appointments/${ref}?phone=9999999999`);
    assert.equal(r.status, 404, 'must not confirm that the booking exists');
  });

  test('downloads a calendar invite', async () => {
    const r = await srv.call(`/api/appointments/${ref}/calendar.ics?phone=${phone}`);
    assert.equal(r.status, 200);
    assert.match(r.body, /BEGIN:VCALENDAR/);
    assert.match(r.body, /BEGIN:VEVENT/);
    assert.ok(r.body.includes(ref));
  });

  test('cancels with the matching phone number and frees the slot', async () => {
    const r = await post(`/api/appointments/${ref}/cancel`, { phone, reason: 'Changed plans' });
    assert.equal(r.status, 200);
    assert.equal(r.body.appointment.status, 'cancelled');

    const avail = await srv.call(`/api/appointments/availability?date=${nextMonday(1)}&service_id=1`);
    assert.ok(avail.body.slots.some((s) => s.time === '10:00'), 'the slot is bookable again');
  });

  test('refuses to cancel with the wrong phone number', async () => {
    const r2 = await post('/api/appointments', {
      name: 'Protected', phone: '9812345671', date: nextMonday(2), time: '10:00', service_id: 1,
    });
    const r = await post(`/api/appointments/${r2.body.appointment.ref}/cancel`, { phone: '9000000000' });
    assert.equal(r.status, 404);
  });
});

describe('enquiries', () => {
  test('accepts a valid enquiry', async () => {
    const r = await post('/api/enquiries', {
      name: 'Curious Patient', phone: '9812345699',
      message: 'Do you treat children?', preferred_contact: 'whatsapp',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.ok, true);
  });

  test('rejects an invalid phone number', async () => {
    const r = await post('/api/enquiries', { name: 'Bad', phone: '12345', message: 'hi' });
    assert.equal(r.status, 400);
  });
});

describe('rate limiting', () => {
  test('throttles repeated booking attempts from one client', async () => {
    limiter._reset();
    const results = [];
    for (let i = 0; i < 9; i++) {
      results.push(await post('/api/appointments', {
        name: `Spam ${i}`, phone: `98120000${String(i).padStart(2, '0')}`,
        date: nextMonday(3), time: '09:00', service_id: 1,
      }));
    }
    assert.ok(results.some((r) => r.status === 429), 'the limiter must eventually reject');
    limiter._reset();
  });
});
