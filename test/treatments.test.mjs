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
      if (s.bookable) assert.ok(body.includes(`href="/book?treatment=${s.slug}"`), `${s.slug} Book is a real link`);
    }
    // The Book control used to be a <button> that did nothing off the homepage.
    assert.ok(!/<button[^>]*book-service/.test(body));
  });

  test('has a consultation call to action and a logical heading order', async () => {
    const body = (await srv.call('/services')).body;
    assert.match(body, /Not sure what you need\?/);
    assert.match(body, /href="\/book"/);
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
    assert.match(body, /href="\/book\?treatment=root-canal-treatment"/);
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

  /* Every published treatment is mapped to one of the owner's photographs
     today; a treatment added later falls back to its own admin image, which
     must still be disclosed when it is stock. */
  test('a treatment\'s own stock image is disclosed as illustrative where it is shown largest', async () => {
    const { treatmentScene } = await import('../src/routes/public.routes.js');
    const later = { slug: 'added-later', image_url: '/media/stock1.webp', image_width: 1280, image_height: 720, image_alt: 'A tooth', image_is_stock: 1 };
    assert.equal(treatmentScene(later).caption, 'Illustrative image, not a photograph of the clinic');
    assert.equal(treatmentScene(later).url, '/media/stock1.webp');
    assert.equal(treatmentScene({ ...later, image_is_stock: 0 }).caption, null);
    assert.equal(treatmentScene({ slug: 'added-later', image_url: null }), null);
  });
});

describe('treatment page scenes', () => {
  /* Each treatment's own admin image is its picture; the one treatment with
     none (emergency care) gets one of the owner's photographs. */
  test('the owner\'s photographs go only where they match, and never twice', async () => {
    const want = { 'dental-emergency': 'dental-instruments' };
    const seen = new Map();
    for (const { slug } of await servicesRepo.publicSlugs()) {
      const body = (await srv.call(`/services/${slug}`)).body;
      const scene = body.slice(body.indexOf('<main'), body.indexOf('CHAPTERS'));
      const img = (scene.match(/<img src="([^"]+)"/) || [])[1] || null;
      if (want[slug]) {
        assert.equal(img, `/img/stock/${want[slug]}-1600.webp`, `${slug} uses ${want[slug]}`);
        assert.match(scene, /<p class="page-cine__credit[^"]*">(?:<span[^>]*><\/span>)?Illustrative photograph<\/p>/, `${slug} is captioned`);
      } else {
        assert.ok(!img || !img.startsWith('/img/stock/'), `${slug} keeps its own image, not ${img}`);
      }
      if (img) {
        assert.ok(!seen.has(img), `${slug} repeats the image of ${seen.get(img)}`);
        seen.set(img, slug);
      }
    }
  });
});

describe('treatment pages in a browser', () => {
  const btest = (name, fn) => test(name, async (t) => {
    if (!browser) return t.skip('Chromium could not launch');
    await fn();
  });

  btest('Book on /services opens /book with that treatment chosen', async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(srv.base + '/services', { waitUntil: 'networkidle0' });
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'networkidle0' }),
      p.click('.treatment-card .book-service'),
    ]);
    await p.waitForFunction(() => document.querySelector('.booking-progress__compact')?.textContent.includes('Date'), { timeout: 10000 });
    assert.equal(new URL(p.url()).pathname, '/book');
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
