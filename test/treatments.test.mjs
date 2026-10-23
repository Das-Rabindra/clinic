/**
 * Treatments listing and detail pages on the new design system (Stage 4).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, browser, servicesRepo;

before(async () => {
  ctx = await setupEnv('treatments');
  await bootDb();
  servicesRepo = await import('../src/repositories/services.repo.js');
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

const headings = (html) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
function assertHeadingOrder(html, label) {
  const hs = headings(html);
  assert.equal(hs.filter((h) => h === 1).length, 1, `${label}: one h1`);
  for (let i = 1; i < hs.length; i++) {
    assert.ok(hs[i] <= hs[i - 1] + 1, `${label}: h${hs[i - 1]} followed by h${hs[i]}`);
  }
}

describe('/services', () => {
  test('lists every active treatment, each with a detail link and a working Book link', async () => {
    const active = await servicesRepo.list({ activeOnly: true });
    const body = (await srv.call('/services')).body;
    const cards = (body.match(/data-treatment-card/g) || []).length;
    assert.equal(cards, active.length);
    for (const s of active) {
      if (s.has_detail_page) assert.ok(body.includes(`class="card__link" href="/services/${s.slug}"`), s.slug);
      if (s.bookable) assert.ok(body.includes(`href="/#appointment?treatment=${s.slug}"`), `${s.slug} Book is a real link`);
    }
    // The Book control used to be a <button> that did nothing off the homepage.
    assert.ok(!/<button[^>]*book-service/.test(body));
  });

  test('has a consultation call to action and a logical heading order', async () => {
    const body = (await srv.call('/services')).body;
    assert.match(body, /Not sure what you need\?/);
    assert.match(body, /href="\/#appointment"/);
    assertHeadingOrder(body, '/services');
  });

  test('breadcrumb is visible and matches the BreadcrumbList data', async () => {
    const body = (await srv.call('/services')).body;
    assert.match(body, /<nav class="breadcrumbs" aria-label="Breadcrumb">/);
    assert.match(body, /<span aria-current="page">Treatments<\/span>/);
    assert.match(body, /"@type":"BreadcrumbList"/);
  });
});

describe('/services/:slug', () => {
  test('every published treatment page renders with one h1 and ordered headings', async () => {
    for (const { slug } of await servicesRepo.publicSlugs()) {
      const r = await srv.call(`/services/${slug}`);
      assert.equal(r.status, 200, slug);
      assertHeadingOrder(r.body, slug);
    }
  });

  test('carries breadcrumb, Book, Call, WhatsApp, call-back and a way back to all treatments', async () => {
    const body = (await srv.call('/services/root-canal-treatment')).body;
    assert.match(body, /<a href="\/services">Treatments<\/a>/);
    assert.match(body, /<span aria-current="page">Root Canal Treatment<\/span>/);
    assert.match(body, /"@type":"BreadcrumbList"/);
    assert.match(body, /href="\/#appointment\?treatment=root-canal-treatment"/);
    assert.match(body, /href="tel:\+918847879686"/);
    assert.match(body, /href="https:\/\/wa\.me\/918847879686\?text=[^"]*Root%20Canal%20Treatment/);
    assert.match(body, /data-callback-open data-service="\d+" data-service-name="Root Canal Treatment"/);
    assert.match(body, /href="\/services"[^>]*>See all treatments/);
  });

  test('explains what a consultation decides, in cautious terms', async () => {
    const body = (await srv.call('/services/dental-implants')).body;
    assert.match(body, /What a consultation helps decide/);
    assert.match(body, /before anything is decided/);
  });

  test('never shows a price', async () => {
    for (const { slug } of await servicesRepo.publicSlugs()) {
      const body = (await srv.call(`/services/${slug}`)).body;
      const main = body.slice(body.indexOf('<main'), body.indexOf('</main>'));
      assert.ok(!/₹|\bRs\.?\s?\d|\bINR\b/.test(main), `${slug} shows a price`);
    }
  });

  test('a stock image is disclosed as illustrative where it is shown largest', async () => {
    const { run, one } = await import('../src/db/index.js');
    await run(`INSERT INTO media (storage,key,url,folder,mime,ext,bytes,width,height,alt,is_stock)
               VALUES ('local','services/stock1','/media/stock1.webp','services','image/webp','webp',1,1280,720,'Illustration: a tooth',1)`);
    const m = await one(`SELECT id FROM media WHERE key = 'services/stock1'`);
    const svc = await servicesRepo.findPublicBySlug('dentures');
    await servicesRepo.update(svc.id, { image_media_id: m.id });
    const body = (await srv.call('/services/dentures')).body;
    assert.match(body, /Illustrative image, not a photograph of the clinic/);
  });
});

describe('treatment pages in a browser', () => {
  const btest = (name, fn) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium could not launch');
    await fn();
  });

  btest('Book on /services opens the homepage wizard with that treatment chosen', async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(srv.base + '/services', { waitUntil: 'networkidle0' });
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'networkidle0' }),
      p.click('.treatment-card .book-service'),
    ]);
    await p.waitForFunction(() => document.querySelector('.booking-progress__compact')?.textContent.includes('Date'), { timeout: 10000 });
    assert.equal(new URL(p.url()).pathname, '/');
    await p.close();
  });

  for (const path of ['/services', '/services/root-canal-treatment', '/privacy']) {
    btest(`${path}: no horizontal overflow at 320px and no console errors`, async () => {
      const p = await browser.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
      await p.setViewport({ width: 320, height: 800, isMobile: true, hasTouch: true });
      await p.goto(srv.base + path, { waitUntil: 'networkidle0' });
      const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      await p.close();
      assert.equal(over, false);
      assert.deepEqual(errors, []);
    });
  }
});
