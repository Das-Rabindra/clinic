/**
 * Booking wizard and "find or cancel" — redesign Stage 5.
 *
 * Real Chromium against the real app and a throwaway database: the happy
 * path and cancellation make genuine requests (harmless here), while every
 * failure the server or network can produce is injected with request
 * interception, so each branch is exercised deterministically.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, browser, db;

before(async () => {
  ctx = await setupEnv('bookingui');
  await bootDb();
  db = await import('../src/db/index.js');
  srv = await startServer();
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  } catch { browser = null; }
});
after(async () => {
  if (browser) await browser.close();
  await srv.close();
  await cleanup(ctx);
});

const btest = (name, fn) => test(name, async (t) => {
  if (!browser) return t.skip('Chromium could not launch');
  await fn();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A page with reduced motion, so the wizard's scroll on each step change is
 * instant. With smooth scrolling, a click straight after a step change could
 * land where a button *was* while the page was still moving; nothing
 * happened, the next wait timed out after 30 seconds, and a different test
 * failed on each unlucky run. Instant scrolling is a path the wizard already
 * supports, so nothing is mocked.
 */
async function newPage() {
  const p = await browser.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  return p;
}

/** Open the homepage with optional request mocks: [{ match(req) -> bool, respond: {status, body} | 'abort' }]. */
async function open(mocks = [], width = 390) {
  const p = await newPage();
  const posts = [];
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/appointments')) posts.push(req.url());
    const m = mocks.find((x) => x.match(req));
    if (!m) return req.continue();
    if (m.respond === 'abort') return req.abort();
    return req.respond({ status: m.respond.status, contentType: 'application/json', body: JSON.stringify(m.respond.body) });
  });
  await p.setViewport({ width, height: 844, isMobile: width < 768, hasTouch: width < 768 });
  await p.goto(srv.base + '/#appointment', { waitUntil: 'networkidle0' });
  await p.waitForSelector('input[name="bkService"]');
  return { p, posts };
}

const next = (p) => p.click('#bookNext');
const focusedId = (p) => p.evaluate(() => document.activeElement.id);

async function toTime(p) {
  await p.click('input[name="bkService"]');
  await next(p);
  await p.waitForSelector('.cal__day.has-times');
  await p.click('.cal__day.has-times');
  await next(p);
}
async function toDetails(p) {
  await toTime(p);
  await p.waitForSelector('.slot-option[data-time]');
  await p.click('.slot-option[data-time]');
  await next(p);
  await p.waitForSelector('#bkName');
}
async function fillDetails(p, phone = '9000000101') {
  await p.type('#bkName', 'Asha Test');
  await p.type('#bkPhone', phone);
}
async function toReview(p, phone) {
  await toDetails(p);
  await fillDetails(p, phone);
  await next(p);
  await p.waitForFunction(() => document.getElementById('bookNext').textContent.includes('Confirm'));
}

describe('booking wizard', () => {
  btest('valid booking: confirmation only after the server answers, with a reference', async () => {
    const { p, posts } = await open();
    await toReview(p);
    assert.match(await p.$eval('.booking__summary', (e) => e.textContent), /Asha Test/);
    await next(p);
    await p.waitForSelector('.booking__ref');
    const ref = await p.$eval('.booking__ref strong', (e) => e.textContent);
    assert.match(ref, /^SDC-\d{4}-\d{5}$/);
    assert.equal(posts.length, 1);
    assert.equal(await focusedId(p), 'bookingTitle', 'focus moves to the confirmation heading');
    await p.waitForFunction((r) => document.getElementById('bookingStatus').textContent.includes(r), {}, ref);
    const ics = await p.$eval('.booking__done a[href*="calendar.ics"]', (a) => a.getAttribute('href'));
    const icsRes = await srv.call(ics);
    assert.equal(icsRes.status, 200);
    assert.ok(await p.$('.booking__done a[href^="https://wa.me/"]'), 'WhatsApp button on confirmation');
    const row = await db.one('SELECT status FROM appointments WHERE ref = ?', ref);
    assert.ok(['pending', 'confirmed'].includes(row.status));
    await p.close();
  });

  btest('each step change moves focus to the step heading and announces it', async () => {
    const { p } = await open();
    await p.click('input[name="bkService"]');
    await next(p);
    await p.waitForSelector('.cal__day.has-times');
    assert.equal(await focusedId(p), 'bookingTitle');
    await p.waitForFunction(() => /Calendar loaded|Step 2/.test(document.getElementById('bookingStatus').textContent));
    const label = await p.$eval('.cal__day.has-times', (b) => b.getAttribute('aria-label'));
    assert.match(label, /^[A-Z][a-z]+day \d+ [A-Z][a-z]+, \d+ times? available$/, `readable day label: ${label}`);
    await p.close();
  });

  btest('missing fields: inline errors, aria-invalid, described-by, focus on first, nothing cleared', async () => {
    const { p, posts } = await open();
    await toDetails(p);
    await p.type('#bkEmail', 'kept@example.com');
    await next(p);
    await sleep(100);
    const s = await p.evaluate(() => ({
      focus: document.activeElement.id,
      invalid: document.getElementById('bkName').getAttribute('aria-invalid'),
      described: document.getElementById('bkName').getAttribute('aria-describedby'),
      err: document.getElementById('bkNameErr').textContent,
      phoneErr: document.getElementById('bkPhoneErr').textContent,
      email: document.getElementById('bkEmail').value,
    }));
    assert.equal(s.focus, 'bkName');
    assert.equal(s.invalid, 'true');
    assert.match(s.described, /bkNameErr/);
    assert.match(s.err, /name/);
    assert.ok(s.phoneErr.length > 0);
    assert.equal(s.email, 'kept@example.com');
    assert.equal(posts.length, 0);
    await p.close();
  });

  btest('invalid phone is caught; a leading-0 number (accepted by the server) is not', async () => {
    const { p } = await open();
    await toDetails(p);
    await fillDetails(p, '12345');
    await next(p);
    await sleep(100);
    assert.equal(await focusedId(p), 'bkPhone');
    await p.$eval('#bkPhone', (e) => { e.value = ''; });
    await p.type('#bkPhone', '09000000102');
    await next(p);
    await p.waitForFunction(() => document.getElementById('bookNext').textContent.includes('Confirm'));
    await p.close();
  });

  btest('no free times on a day: honest empty state with a way back', async () => {
    const { p } = await open([{
      match: (r) => r.url().includes('/api/appointments/availability'),
      respond: { status: 200, body: { date: '2030-01-01', open: true, slots: [] } },
    }]);
    await toTime(p);
    await p.waitForSelector('.booking__empty [data-goto="1"]');
    await p.click('.booking__empty [data-goto="1"]');
    await p.waitForSelector('.cal__day');
    await p.close();
  });

  btest('calendar fails to load: error notice with retry and call/WhatsApp fallback', async () => {
    let fail = true;
    const { p } = await open([{
      match: (r) => r.url().includes('/api/appointments/calendar') && fail,
      respond: { status: 500, body: { error: 'x', code: 'INTERNAL' } },
    }]);
    await p.click('input[name="bkService"]');
    await next(p);
    await p.waitForSelector('#bookingNotice [data-retry]');
    assert.equal(await focusedId(p), 'bookingNotice');
    assert.ok(await p.$('#bookingNotice a[href^="tel:"]'));
    fail = false;
    await p.click('[data-retry]');
    await p.waitForSelector('.cal__day.has-times');
    await p.close();
  });

  btest('slot taken before submit: back to times, told why, details kept', async () => {
    const { p } = await open([{
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/appointments'),
      respond: { status: 409, body: { error: 'That time was just booked.', code: 'SLOT_TAKEN' } },
    }]);
    await toReview(p);
    await next(p);
    await p.waitForSelector('#bookingNotice');
    await p.waitForSelector('.slot-option[data-time]');
    const s = await p.evaluate(() => ({
      notice: document.getElementById('bookingNotice').textContent,
      step: document.querySelector('.booking-progress__compact').textContent,
      pressed: document.querySelectorAll('.slot-option[aria-pressed="true"]').length,
    }));
    assert.match(s.notice, /just gone/);
    assert.match(s.step, /Step 3/);
    assert.equal(s.pressed, 0, 'the vanished time is not still selected');
    await p.click('.slot-option[data-time]');
    await next(p);
    assert.equal(await p.$eval('#bkName', (e) => e.value), 'Asha Test', 'details survived');
    await p.close();
  });

  btest('network failure on submit: no false success, honest message, fallbacks, details kept', async () => {
    const { p } = await open([{
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/appointments'),
      respond: 'abort',
    }]);
    await toReview(p);
    await next(p);
    await p.waitForSelector('#bookingNotice');
    const s = await p.evaluate(() => ({
      text: document.getElementById('bookingNotice').textContent,
      tel: Boolean(document.querySelector('#bookingNotice a[href^="tel:"]')),
      ref: Boolean(document.querySelector('.booking__ref')),
      summary: document.querySelector('.booking__summary').textContent,
    }));
    assert.match(s.text, /could not confirm/i);
    assert.ok(s.tel);
    assert.equal(s.ref, false);
    assert.match(s.summary, /Asha Test/);
    await p.close();
  });

  btest('server rejection: field errors map back to the details step', async () => {
    const { p } = await open([{
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/appointments'),
      respond: { status: 400, body: { error: 'Please check the highlighted fields.', code: 'VALIDATION', fields: { phone: 'Enter a valid mobile number.' } } },
    }]);
    await toReview(p);
    await next(p);
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'bkPhone');
    assert.match(await p.$eval('#bkPhoneErr', (e) => e.textContent), /valid mobile/);
    await p.close();
  });

  btest('rate limited: explained, with call and WhatsApp offered', async () => {
    const { p } = await open([{
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/appointments'),
      respond: { status: 429, body: { error: 'Too many', code: 'RATE_LIMITED' } },
    }]);
    await toReview(p);
    await next(p);
    await p.waitForSelector('#bookingNotice');
    assert.match(await p.$eval('#bookingNotice', (e) => e.textContent), /Too many attempts/);
    assert.ok(await p.$('#bookingNotice a[href^="https://wa.me/"]'));
    await p.close();
  });

  btest('duplicate submit: a double click sends one request', async () => {
    const { p, posts } = await open();
    await toReview(p, '9000000103');
    await p.evaluate(() => { const b = document.getElementById('bookNext'); b.click(); b.click(); b.click(); });
    await p.waitForSelector('.booking__ref');
    assert.equal(posts.length, 1);
    await p.close();
  });

  btest('the Continue button is clear of the action bar on a phone at every step', async () => {
    const { p } = await open();
    const clear = () => p.evaluate(async () => {
      const b = document.getElementById('bookNext');
      b.scrollIntoView({ block: 'end' });
      await new Promise((r) => setTimeout(r, 350));
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === b || b.contains(hit);
    });
    await p.click('input[name="bkService"]');
    assert.ok(await clear(), 'treatment step');
    await next(p);
    await p.waitForSelector('.cal__day.has-times');
    await p.click('.cal__day.has-times');
    assert.ok(await clear(), 'date step');
    await next(p);
    await p.waitForSelector('.slot-option[data-time]');
    await p.click('.slot-option[data-time]');
    assert.ok(await clear(), 'time step');
    await p.close();
  });
});

describe('find or cancel a booking', () => {
  async function book(phone) {
    const { p } = await open();
    await toReview(p, phone);
    await next(p);
    await p.waitForSelector('.booking__ref');
    const ref = await p.$eval('.booking__ref strong', (e) => e.textContent);
    await p.close();
    return ref;
  }

  btest('looks up by reference and phone, then cancels after an explicit confirmation', async () => {
    const ref = await book('9000000104');
    const { p, posts } = await open();
    await p.click('#manage summary');
    await p.type('#mgRef', ref.toLowerCase());
    await p.type('#mgPhone', '9000000104');
    await p.click('#manageForm [type=submit]');
    await p.waitForSelector('#manageCard');
    assert.equal(await focusedId(p), 'manageCard');
    assert.match(await p.$eval('#manageCard', (e) => e.textContent), /call or message the clinic/, 'rescheduling is not offered online');
    await p.click('#manageCancel');
    await p.waitForSelector('#manageConfirm');
    assert.equal(posts.length, 0, 'nothing is cancelled before the second click');
    await p.click('#manageConfirm');
    await p.waitForFunction(() => document.querySelector('#manageResult')?.textContent.includes('Appointment cancelled'));
    const row = await db.one('SELECT status FROM appointments WHERE ref = ?', ref);
    assert.equal(row.status, 'cancelled');
    await p.close();
  });

  btest('wrong phone for a real reference: not found, nothing revealed', async () => {
    const ref = await book('9000000105');
    const { p } = await open();
    await p.click('#manage summary');
    await p.type('#mgRef', ref);
    await p.type('#mgPhone', '9000000999');
    await p.click('#manageForm [type=submit]');
    await p.waitForSelector('#manageResult #bookingNotice');
    const text = await p.$eval('#manageResult', (e) => e.textContent);
    assert.match(text, /No appointment matches/);
    assert.ok(!text.includes('Asha'), 'no booking details leak');
    await p.close();
  });

  btest('a booking that cannot be cancelled says so and offers to call', async () => {
    const ref = await book('9000000106');
    await db.run(`UPDATE appointments SET status = 'completed' WHERE ref = ?`, ref);
    const { p } = await open();
    await p.click('#manage summary');
    await p.type('#mgRef', ref);
    await p.type('#mgPhone', '9000000106');
    await p.click('#manageForm [type=submit]');
    await p.waitForSelector('#manageCard');
    assert.equal(await p.$('#manageCancel'), null);
    assert.match(await p.$eval('#manageCard', (e) => e.textContent), /can no longer be changed online/);
    await p.close();
  });
});

describe('the /book page', () => {
  btest('runs the same wizard, and ?treatment= arrives with the treatment chosen', async () => {
    const p = await newPage();
    await p.setRequestInterception(true);
    p.on('request', (req) => (req.method() === 'POST' ? req.abort() : req.continue()));
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await p.goto(srv.base + '/book?treatment=root-canal-treatment', { waitUntil: 'networkidle0' });
    // Step 2 (Date) with the treatment already chosen, and the query dropped.
    await p.waitForSelector('.cal__day');
    assert.match(await p.$eval('#bookingSteps', (e) => e.textContent), /Step 2 of 5/);
    assert.equal(new URL(p.url()).search, '');
    assert.equal(await p.$eval('h1', (e) => e.textContent.trim()), 'Book an appointment');
    await p.close();
  });

  btest('without a treatment it opens on step 1', async () => {
    const p = await newPage();
    await p.goto(srv.base + '/book', { waitUntil: 'networkidle0' });
    await p.waitForSelector('input[name="bkService"]');
    await p.close();
  });
});
