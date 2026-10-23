/**
 * The standalone About and Gallery pages, and the links that lead to them.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv;

before(async () => {
  ctx = await setupEnv('about_gallery');
  await bootDb();
  srv = await startServer();
});
after(async () => {
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

describe('/about', () => {
  test('renders the dentist, the clinic and the hours from the clinic\'s own data', async () => {
    const r = await srv.call('/about');
    assert.equal(r.status, 200);
    assertHeadingOrder(r.body, '/about');
    assert.match(r.body, /class="page-cine about-scene" data-hero/);
    assert.ok(r.body.includes('Kalinga Institute of Dental Science'));
    assert.ok(r.body.includes('/img/clinic/treatment-room-1086.webp'));
    assert.match(r.body, /class="hours-table-ds"/);
    assert.ok(r.body.includes('<link rel="canonical" href="') && r.body.includes('/about"'));
    assert.ok(r.body.includes('"BreadcrumbList"'));
  });
});

describe('/gallery', () => {
  test('shows every published photograph uncropped, grouped, with a lightbox', async () => {
    const galleryRepo = await import('../src/repositories/gallery.repo.js');
    const published = await galleryRepo.listPublic();
    const r = await srv.call('/gallery');
    assert.equal(r.status, 200);
    assertHeadingOrder(r.body, '/gallery');
    // The bundled treatment-room photograph plus everything the admin published.
    const shots = (r.body.match(/data-lightbox data-caption=/g) || []).length;
    assert.ok(shots >= published.length + 1);
    assert.match(r.body, /<dialog class="lightbox"/);
    assert.ok(r.body.includes('/js/gallery.js'));
  });

  test('the lightbox script is served', async () => {
    const r = await srv.call('/js/gallery.js');
    assert.equal(r.status, 200);
    assert.match(r.body, /showModal/);
  });
});

describe('navigation to the new pages', () => {
  for (const page of ['/', '/services', '/privacy', '/about', '/gallery']) {
    test(`${page} links About and Gallery to their pages`, async () => {
      const body = (await srv.call(page)).body;
      assert.ok(body.includes('href="/about"'), 'About link');
      assert.ok(body.includes('href="/gallery"'), 'Gallery link');
    });
  }

  test('both pages are in the sitemap', async () => {
    const xml = (await srv.call('/sitemap.xml')).body;
    assert.match(xml, /<loc>[^<]+\/about<\/loc>/);
    assert.match(xml, /<loc>[^<]+\/gallery<\/loc>/);
  });
});
