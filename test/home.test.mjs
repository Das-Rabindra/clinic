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
    const hero = body.slice(body.indexOf('class="cine-hero"'), body.indexOf('id="about"'));
    assert.ok(hero.length > 100, 'hero found');
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

  /* The owner chose a stock photograph for the opening scene (Oct 2026).
     It must say so, and a shared link must still show the clinic itself. */
  test('the stock hero is labelled illustrative; link previews show the clinic\'s own room', async () => {
    const body = await home();
    assert.match(body, /<img src="\/img\/stock\/hero-dental-exam-1600\.webp" alt="Illustrative photograph: /);
    assert.match(body, /class="cine-hero__caption"[^>]*>(?:<span[^>]*><\/span>)?Illustrative photograph</);
    assert.match(body, /<meta property="og:image" content="[^"]*\/img\/clinic\/treatment-room-1086\.webp"/);
    // The clinic's own photograph is still served for About and the gallery.
    assert.equal((await srv.call('/img/clinic/treatment-room-720.webp')).status, 200);
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
    assert.match(await home(), /class="gallery-grid-ds[ "]/);
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

describe('testimonials layout preview (sample content)', () => {
  test('is labelled as sample, noindex, unlinked, out of the sitemap, with no structured data', async () => {
    const r = await srv.call('/_preview/testimonials');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(r.body, /<meta name="robots" content="noindex, follow">|noindex/);
    assert.match(r.body, /Sample content &mdash; layout preview, not real reviews/);
    const cards = (r.body.match(/class="card review-card"/g) || []).length;
    assert.ok(cards > 0);
    assert.equal((r.body.match(/Sample &middot; Shared with the clinic/g) || []).length, cards, 'every card says Sample');
    assert.ok(!r.body.includes('application/ld+json'), 'no structured data at all');
    assert.ok(!(await srv.call('/sitemap.xml')).body.includes('_preview'));
    for (const page of ['/', '/services', '/privacy']) {
      assert.ok(!(await srv.call(page)).body.includes('_preview'), `${page} links to the preview`);
    }
  });

  test('the live homepage never shows the sample testimonials', async () => {
    const body = await home();
    assert.ok(!body.includes('Biswa P Tripathy'));
    assert.ok(!body.includes('Sample &middot;'));
    assert.match(body, /Testimonials coming soon/);
    assert.ok(!body.includes('AggregateRating'));
  });
});

describe('paper-card testimonials', () => {
  test('only entries with the patient\'s own words AND consent are published, once', async () => {
    const { applyTestimonials } = await import('../src/db/testimonials.js');
    const list = [
      { name: 'Card Patient', rating: 5, text: 'Exact words from the card.', date: '2026-10-10', consent: true },
      { name: 'No Words Yet', rating: 5, text: '', consent: true },
      { name: 'No Consent', rating: 5, text: 'Words here.', consent: false },
    ];
    const first = await applyTestimonials({ log: () => {}, list });
    assert.equal(first.added, 1);
    assert.deepEqual(first.waiting, ['No Words Yet', 'No Consent']);
    assert.equal((await applyTestimonials({ log: () => {}, list })).added, 0, 'idempotent');
    const row = await db.one(`SELECT source, consent_confirmed, collected_via, is_visible FROM reviews WHERE author_name = 'Card Patient'`);
    assert.equal(row.source, 'manual');
    assert.equal(row.consent_confirmed, 1);
    assert.equal(row.collected_via, 'Paper feedback card');
    const body = await home();
    assert.match(body, /Exact words from the card\./);
    assert.match(body, /Shared with the clinic/);
    assert.ok(!body.includes('Sample &middot;'));
    assert.ok(!body.includes('AggregateRating'), 'manual testimonials never feed Google rating markup');
    await db.run(`DELETE FROM reviews WHERE author_name = 'Card Patient'`);
  });

  test('nothing is published from the shipped list until card text and consent are filled in', async () => {
    const { TESTIMONIALS } = await import('../src/db/testimonials.js');
    for (const t of TESTIMONIALS) {
      if (t.consent) assert.ok(String(t.text).trim().length > 0, `${t.name}: consent without words`);
    }
  });
});

describe('cinematic layer', () => {
  test('every stock photograph is captioned as illustrative; the clinic photo carries real alt text', async () => {
    const body = await home();
    // Treatment cards are covered by one note per list (checked below); every
    // other stock image carries its own caption.
    const cards = [...body.matchAll(/<article[^>]*data-treatment-card[\s\S]*?<\/article>/g)].map((m) => m[0]);
    const cardStock = cards.filter((c) => c.includes('src="/img/stock/')).length;
    const stock = (body.match(/<img src="\/img\/stock\//g) || []).length - cardStock;
    if (cardStock) assert.match(body, /<p class="illustrative-note cards-note">Photographs are illustrative<\/p>/);
    // "Illustration" for a render, "Illustrative photograph" for a photo; the
    // hero's caption is set like a film still's.
    const notes = (body.match(/class="(?:illustrative-note|cine-hero__caption)"[^>]*>(?:<span[^>]*><\/span>)?(?:Illustrative photograph|Illustration)</g) || []).length;
    assert.ok(stock > 0);
    assert.equal(notes, stock, 'one caption per stock image');
    // A shared link shows the clinic's own room, never stock people.
    assert.match(body, /<meta property="og:image" content="[^"]*\/img\/clinic\/treatment-room-1086\.webp"/);
  });

  test('every licence is recorded for the stock images', async () => {
    const fs = await import('node:fs');
    const credits = fs.readFileSync('public/img/stock/CREDITS.md', 'utf8');
    for (const f of fs.readdirSync('public/img/stock').filter((n) => n.endsWith('.webp'))) {
      const base = f.replace(/-\d+\.webp$/, '');
      assert.ok(credits.includes(base), `${base} missing from CREDITS.md`);
    }
  });
});

describe('cinematic layer in a browser', () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btest = (name, fn) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium could not launch');
    await fn();
  });

  btest('with reduced motion nothing is hidden or animated', async () => {
    const p = await browser.newPage();
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(srv.base + '/', { waitUntil: 'networkidle0' });
    const s = await p.evaluate(() => ({
      motion: document.documentElement.classList.contains('motion'),
      hidden: [...document.querySelectorAll('[data-reveal]')].filter((e) => {
        const cs = getComputedStyle(e); return cs.opacity !== '1' || cs.clipPath !== 'none';
      }).length,
    }));
    await p.close();
    assert.equal(s.motion, false);
    assert.equal(s.hidden, 0);
  });

  btest('every reveal fires while scrolling, and the header turns solid after the hero', async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(srv.base + '/', { waitUntil: 'networkidle0' });
    assert.equal(await p.$eval('.site-header', (h) => h.classList.contains('is-transparent')), true, 'transparent over the hero');
    const height = await p.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += 500) {
      await p.evaluate((v) => window.scrollTo(0, v), y);
      await sleep(120);
    }
    await sleep(400);
    const s = await p.evaluate(() => ({
      stuck: document.querySelectorAll('[data-reveal]:not(.is-in)').length,
      transparent: document.querySelector('.site-header').classList.contains('is-transparent'),
    }));
    await p.close();
    assert.equal(s.stuck, 0, 'reveals never fired');
    assert.equal(s.transparent, false, 'header solid below the hero');
  });
});
