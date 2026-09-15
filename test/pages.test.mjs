/** Public page routes: treatments, local SEO, privacy, and the call-back form. */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx;
const SUITE = 'pages';
let srv, servicesRepo, settingsRepo;

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  servicesRepo = await import('../src/repositories/services.repo.js');
  settingsRepo = await import('../src/repositories/settings.repo.js');
  srv = await startServer();
  await srv.call('/api/csrf');
});
after(async () => { await srv.close(); await cleanup(ctx); });

describe('local positioning', () => {
  test('records the town and region the clinic is actually in', async () => {
    const s = await settingsRepo.get();
    assert.equal(s.city, 'Talcher');
    assert.equal(s.state, 'Odisha');
    assert.match(s.area, /Bikrampur/);
  });

  test('puts the town in addressLocality, not the neighbourhood', async () => {
    const page = await srv.call('/');
    // addressLocality is what Google matches against "dentist in <town>".
    assert.ok(page.body.includes('"addressLocality":"Talcher"'), 'town must be the locality');
    assert.ok(page.body.includes('"addressRegion":"Odisha"'));
    assert.ok(page.body.includes('Bikrampur'), 'the neighbourhood belongs in the street address');
    // ISO code, not the display name — "India" is not a value Google resolves.
    assert.ok(page.body.includes('"addressCountry":"IN"'));
  });

  test('links the clinic to the social profiles it has actually supplied', async () => {
    const page = await srv.call('/');
    assert.ok(page.body.includes('"sameAs"'));
    assert.ok(page.body.includes('instagram.com/samaldentalcare'));
    // No Facebook or YouTube link is configured, so neither may be emitted.
    assert.ok(!page.body.includes('facebook.com'), 'never link a page that does not exist');
    assert.ok(!page.body.includes('youtube.com'));
  });
});

describe('treatment pages', () => {
  test('lists every published treatment at /services', async () => {
    const r = await srv.call('/services');
    assert.equal(r.status, 200);
    const published = await servicesRepo.publicSlugs();
    assert.ok(published.length >= 8);
    for (const s of published) assert.ok(r.body.includes(`/services/${s.slug}`), s.slug);
  });

  test('renders a treatment page with its own title and markup', async () => {
    const r = await srv.call('/services/root-canal-treatment');
    assert.equal(r.status, 200);
    assert.match(r.body, /<title>Root Canal Treatment in Talcher/);
    assert.ok(r.body.includes('"@type":"MedicalProcedure"'));
    assert.ok(r.body.includes('"@type":"BreadcrumbList"'));
    assert.ok(r.body.includes('canonical" href="http://localhost:9999/services/root-canal-treatment"'));
  });

  test('offers a booking link that pre-selects the treatment', async () => {
    const r = await srv.call('/services/dental-cleaning');
    assert.ok(r.body.includes('/#appointment?treatment=dental-cleaning'));
  });

  test('an unknown slug is a 404, not an empty page', async () => {
    const r = await srv.call('/services/dental-implants');
    assert.equal(r.status, 404);
  });

  test('a treatment hidden from the website has no page', async () => {
    const svc = await servicesRepo.findPublicBySlug('teeth-whitening');
    await servicesRepo.update(svc.id, { is_active: 0 });
    try {
      assert.equal((await srv.call('/services/teeth-whitening')).status, 404);
      const list = await srv.call('/services');
      assert.ok(!list.body.includes('/services/teeth-whitening'));
    } finally {
      await servicesRepo.update(svc.id, { is_active: 1 });
    }
  });

  test('a treatment with its detail page turned off still shows as a card', async () => {
    const svc = await servicesRepo.findPublicBySlug('tooth-extraction');
    await servicesRepo.update(svc.id, { has_detail_page: 0 });
    try {
      assert.equal((await srv.call('/services/tooth-extraction')).status, 404);
      const list = await srv.call('/services');
      assert.ok(list.body.includes('Tooth Extraction'), 'the card stays, only the link goes');
      assert.ok(!list.body.includes('href="/services/tooth-extraction"'));
    } finally {
      await servicesRepo.update(svc.id, { has_detail_page: 1 });
    }
  });
});

describe('sitemap', () => {
  test('lists only routes that exist', async () => {
    const r = await srv.call('/sitemap.xml');
    const locs = [...r.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length >= 10);
    // /book was advertised for months and has never been a route.
    assert.ok(!locs.some((l) => l.endsWith('/book')), '/book is not a route');
    for (const loc of locs) {
      const path = new URL(loc).pathname;
      const res = await srv.call(path);
      assert.equal(res.status, 200, `${path} is in the sitemap but returns ${res.status}`);
    }
  });

  test('follows the treatments the clinic publishes', async () => {
    const svc = await servicesRepo.findPublicBySlug('crowns-bridges');
    await servicesRepo.update(svc.id, { has_detail_page: 0 });
    try {
      const r = await srv.call('/sitemap.xml');
      assert.ok(!r.body.includes('/services/crowns-bridges'));
    } finally {
      await servicesRepo.update(svc.id, { has_detail_page: 1 });
    }
  });
});

describe('privacy page', () => {
  test('is reachable and explains the photo consent rule', async () => {
    const r = await srv.call('/privacy');
    assert.equal(r.status, 200);
    assert.match(r.body, /consent/i);
    assert.ok(r.body.includes('Annapurna Market Complex'));
  });
});

describe('request a call back', () => {
  test('lands in the enquiry list like any other enquiry', async () => {
    const before = await srv.call('/api/csrf');
    assert.equal(before.status, 200);
    const r = await srv.call('/api/enquiries', {
      headers: { 'X-CSRF-Token': srv.csrf() },
      json: { name: 'Ravi Patnaik', phone: '9876543210', message: 'Tooth sensitive for a week', preferred_contact: 'phone' },
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
  });

  test('rejects a number that is not a mobile number', async () => {
    const r = await srv.call('/api/enquiries', {
      headers: { 'X-CSRF-Token': srv.csrf() },
      json: { name: 'Ravi Patnaik', phone: '12345', preferred_contact: 'phone' },
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.fields?.phone);
  });

  test('cannot be posted without a CSRF token', async () => {
    const r = await srv.call('/api/enquiries', {
      json: { name: 'Ravi Patnaik', phone: '9876543210' },
    });
    assert.equal(r.status, 403);
  });
});

describe('cross-page navigation', () => {
  test('anchors on a treatment page point back to the homepage', async () => {
    const r = await srv.call('/services/dental-fillings');
    // A bare "#about" on a subpage scrolls nowhere; it must be "/#about".
    assert.ok(r.body.includes('href="/#about"'));
    assert.ok(!r.body.includes('href="#about"'));
  });

  test('the homepage keeps its in-page anchors', async () => {
    const r = await srv.call('/');
    assert.ok(r.body.includes('href="#about"'));
  });
});
