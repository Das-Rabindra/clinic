/**
 * Homepage on the new design system (redesign Stage 3).
 *
 * The server half pins down what the page promises patients; the browser half
 * drives Chromium against the real app and a throwaway database, so the
 * booking and call-back requests it makes are harmless.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, browser, db;

before(async () => {
  ctx = await setupEnv('home');
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

const home = async () => (await srv.call('/')).body;

async function addGalleryPhoto(n) {
  const m = await db.one(
    `INSERT INTO media (storage, key, url, folder, mime, ext, bytes, width, height, alt)
     VALUES ('local', $1, $2, 'clinic', 'image/webp', 'webp', 1, 800, 600, $3) RETURNING id`,
    `clinic/t${n}.webp`, `/media/clinic/t${n}.webp`, `Test photo ${n}`);
  await db.run(
    `INSERT INTO gallery_items (media_id, title, category, is_published, display_order)
     VALUES (?, ?, 'clinic', 1, ?)`, m.id, `Photo ${n}`, n);
}

describe('homepage content', () => {
  test('the weekly hours show the break, as two sessions per day', async () => {
    const body = await home();
    // Seeded week: 09:00–22:00 with a 13:00–15:00 break, every day.
    const morning = body.match(/hours-table-ds__session">9:00 AM – 1:00 PM</g) || [];
    const evening = body.match(/<span class="visually-hidden-ds">and <\/span>3:00 PM – 10:00 PM</g) || [];
    assert.equal(morning.length, 7);
    assert.equal(evening.length, 7);
  });

  test('the urgent-care line states today\'s hours from the grid, break included', async () => {
    const body = await home();
    assert.match(body, /open today 9:00 AM to 10:00 PM, closed 1:00 PM to 3:00 PM/);
    assert.ok(!/open until [^<]* every day/.test(body), 'no hard-coded "every day" claim');
  });

  test('credentials appear once in the first screen, not three times', async () => {
    const body = await home();
    const hero = body.slice(body.indexOf('class="hero"'), body.indexOf('id="about"'));
    assert.equal((hero.match(/class="trust-row"/g) || []).length, 1);
    assert.ok(!hero.includes('cred-strip'));
  });

  test('exactly one persistent action bar, and no desktop rail', async () => {
    const body = await home();
    assert.equal((body.match(/data-action-bar/g) || []).length, 1);
    assert.ok(!body.includes('class="action-rail"'));
    assert.ok(!body.includes('class="mobile-bar"'));
  });

  test('the booking section asks the action bar to step aside', async () => {
    assert.match(await home(), /id="appointment" data-bar-yield/);
  });

  test('a stock hero image gives way to the clinic\'s own photograph', async () => {
    const body = await home();
    assert.match(body, /src="\/img\/clinic\/treatment-room-1086\.webp"/);
    assert.match(body, /srcset="\/img\/clinic\/treatment-room-480\.webp 480w/);
    const img = await srv.call('/img/clinic/treatment-room-720.webp');
    assert.equal(img.status, 200);
  });

  test('no rating markup while there are no genuine reviews', async () => {
    const body = await home();
    assert.ok(!body.includes('AggregateRating'));
    assert.match(body, /Testimonials coming soon/);
  });

  test('the call-back form posts the same fields as before', async () => {
    const body = await home();
    for (const name of ['name', 'phone', 'message', 'preferred_contact', 'service_id']) {
      assert.match(body, new RegExp(`id="callbackForm"[\\s\\S]*name="${name}"`), name);
    }
  });

  test('gallery: none → empty state, one → single figure without controls', async () => {
    assert.match(await home(), /Photographs coming soon/);
    await addGalleryPhoto(1);
    const one = await home();
    assert.match(one, /class="gallery-feature"/);
    assert.ok(!/data-carousel-prev aria-label="Previous photographs"/.test(one), 'no controls for one photo');
  });

  test('gallery: two to four → static grid, five or more → carousel', async () => {
    await addGalleryPhoto(2);
    assert.match(await home(), /class="gallery-grid-ds"/);
    for (const n of [3, 4, 5]) await addGalleryPhoto(n);
    const many = await home();
    assert.match(many, /aria-label="Clinic photographs, scrollable"/);
    assert.match(many, /data-carousel-next aria-label="More photographs"/);
  });
});

describe('homepage in a browser', () => {
  const btest = (name, fn) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium could not launch');
    await fn();
  });
  const phone = async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await p.goto(srv.base + '/', { waitUntil: 'networkidle0' });
    return p;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  btest('the action bar steps aside over the booking form and returns after', async () => {
    const p = await phone();
    const yielding = () => p.$eval('[data-action-bar]', (b) => b.hasAttribute('data-yield'));
    assert.equal(await yielding(), false);
    await p.evaluate(() => document.getElementById('bookingShell').scrollIntoView({ block: 'center' }));
    await sleep(400);
    assert.equal(await yielding(), true);
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    assert.equal(await yielding(), false);
    await p.close();
  });

  btest('the wizard\'s Continue button is never under the action bar', async () => {
    const p = await phone();
    await p.evaluate(() => document.getElementById('appointment').scrollIntoView());
    await p.waitForSelector('input[name="bkService"]');
    await p.click('input[name="bkService"]');
    const onTop = await p.evaluate(async () => {
      const b = document.getElementById('bookNext');
      b.scrollIntoView({ block: 'end' });
      await new Promise((r) => setTimeout(r, 400));
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === b || b.contains(hit);
    });
    await p.close();
    assert.ok(onTop, 'something covers Continue');
  });

  btest('call-back dialog: focus, validation, trapped Tab, focus returned', async () => {
    const p = await phone();
    await p.evaluate(() => document.querySelector('.treatment-card [data-callback-open]').scrollIntoView({ block: 'center' }));
    await p.click('.treatment-card [data-callback-open]');
    await sleep(200);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'cbName');
    await p.click('#cbSubmit');
    const s = await p.evaluate(() => ({
      focus: document.activeElement.id,
      phoneInvalid: document.getElementById('cbPhone').getAttribute('aria-invalid'),
      status: document.querySelector('#callbackForm [data-form-status]').textContent,
    }));
    assert.equal(s.focus, 'cbName');
    assert.equal(s.phoneInvalid, 'true');
    assert.match(s.status, /2 problems/);
    for (let i = 0; i < 10; i++) {
      await p.keyboard.press('Tab');
      assert.ok(await p.evaluate(() => Boolean(document.activeElement.closest('dialog'))), `Tab ${i + 1} escaped`);
    }
    await p.keyboard.press('Escape');
    await sleep(200);
    assert.ok(await p.evaluate(() => document.activeElement.matches('[data-callback-open]')));
    await p.close();
  });

  btest('a call-back request reaches the enquiries list', async () => {
    const p = await phone();
    await p.evaluate(() => document.querySelector('.treatment-card [data-callback-open]').scrollIntoView({ block: 'center' }));
    await p.click('.treatment-card [data-callback-open]');
    await p.type('#cbName', 'Browser Test');
    await p.type('#cbPhone', '9000000009');
    await p.click('#cbSubmit');
    await p.waitForSelector('#cbDone:not([hidden])', { timeout: 10000 });
    await p.close();
    const row = await db.one(`SELECT name, service_id FROM enquiries WHERE phone LIKE '%9000000009' ORDER BY id DESC LIMIT 1`);
    assert.equal(row.name, 'Browser Test');
    assert.ok(row.service_id, 'the treatment it was opened from is recorded');
  });

  btest('menu drawer: focus moves in, Esc closes and returns focus', async () => {
    const p = await phone();
    await p.click('[data-nav-toggle]');
    assert.ok(await p.evaluate(() => Boolean(document.activeElement.closest('#navDrawer'))));
    await p.keyboard.press('Escape');
    assert.ok(await p.evaluate(() => document.activeElement.matches('[data-nav-toggle]')));
    await p.close();
  });
});
