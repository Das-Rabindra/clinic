/**
 * The standalone About, Gallery, Testimonials and FAQ pages, and the links
 * that lead to them.
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
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
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
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
    assert.ok(r.body.includes('/js/gallery.js'));
  });

  test('the lightbox script is served', async () => {
    const r = await srv.call('/js/gallery.js');
    assert.equal(r.status, 200);
    assert.match(r.body, /showModal/);
  });
});

describe('/testimonials', () => {
  test('with no reviews it says so honestly, invents nothing and stays out of search', async () => {
    const r = await srv.call('/testimonials');
    assert.equal(r.status, 200);
    assertHeadingOrder(r.body, '/testimonials');
    assert.match(r.body, /Testimonials coming soon/);
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
    assert.match(r.body, /<meta name="robots" content="noindex, follow">/);
    assert.ok(!r.body.includes('class="testimony"'), 'no testimony cards');
    assert.ok(!r.body.includes('rating-hero'), 'no rating without reviews');
    assert.ok(!r.body.includes('AggregateRating'));
    assert.ok(!(await srv.call('/sitemap.xml')).body.includes('/testimonials'));
  });

  test('shows a visible review, and only then is indexed and listed', async () => {
    const reviewsRepo = await import('../src/repositories/reviews.repo.js');
    const t = await reviewsRepo.createManual({ author_name: 'Test Patient', rating: 5, text: 'Test wording for the suite.', is_visible: 1, consent_confirmed: 1 });
    try {
      const r = await srv.call('/testimonials');
      assertHeadingOrder(r.body, '/testimonials with a review');
      assert.match(r.body, /class="testimony"/);
      assert.ok(r.body.includes('Test wording for the suite.'));
      assert.match(r.body, /<meta name="robots" content="index, follow">/);
      assert.ok((await srv.call('/sitemap.xml')).body.includes('/testimonials'));
    } finally {
      await reviewsRepo.deleteManual(t.id);
    }
  });
});

describe('/faq', () => {
  test('groups the general questions and every treatment\'s own, with unique accordion ids', async () => {
    const r = await srv.call('/faq');
    assert.equal(r.status, 200);
    assertHeadingOrder(r.body, '/faq');
    assert.match(r.body, /id="visiting"/);
    assert.ok(r.body.includes('href="/services/root-canal-treatment"'), 'links a treatment group to its page');
    const ids = [...r.body.matchAll(/id="(faq-q-[^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 20);
    assert.equal(new Set(ids).size, ids.length, 'accordion ids are unique');
    assert.ok(!r.body.includes('{{'), 'placeholders are resolved');
  });
});

describe('/contact', () => {
  test('gives every way to reach the clinic, the map, the address and the week', async () => {
    const r = await srv.call('/contact');
    assert.equal(r.status, 200);
    assertHeadingOrder(r.body, '/contact');
    assert.ok(r.body.includes('href="tel:'), 'call link');
    assert.ok(r.body.includes('data-callback-open'), 'call-back button');
    assert.match(r.body, /<iframe[^>]+data-src="https:\/\/[^"]*google[^"]*"/);
    assert.ok(r.body.includes('Annapurna Market Complex'));
    assert.equal((r.body.match(/<tr[ >]/g) || []).length, 7, 'seven days of hours');
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
  });
});

describe('privacy, book and 404 scenes', () => {
  test('the 404 page still answers 404, on the plain scene', async () => {
    const r = await srv.call('/no-such-page');
    assert.equal(r.status, 404);
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
  });

  for (const page of ['/privacy', '/book']) {
    test(`${page} opens on the plain scene`, async () => {
      const r = await srv.call(page);
    // Each illustrative photograph is used once across the site; this page
    // opens on the plain night scene.
    assert.match(r.body, /class="page-cine[^"]*" [^>]*data-hero/);
    assert.ok(!/class="page-cine page-cine--photo/.test(r.body), 'no scene photograph');
    });
  }
});

describe('each illustrative photograph is used once across the site', () => {
  /* The owner's request. A treatment's card is the same subject as its page,
     so cards are not counted; a <link rel="preload"> is not shown, so only
     <img> elements count. */
  test('no stock photograph appears in two places', async () => {
    const servicesRepo = await import('../src/repositories/services.repo.js');
    const pages = ['/', '/services', '/about', '/gallery', '/contact', '/testimonials',
      '/faq', '/privacy', '/book', '/no-such-page',
      ...(await servicesRepo.publicSlugs()).map((s) => `/services/${s.slug}`)];
    const uses = new Map();
    for (const page of pages) {
      const body = (await srv.call(page)).body
        .replace(/<article[^>]*data-treatment-card[\s\S]*?<\/article>/g, '');
      for (const m of body.matchAll(/<img [^>]*src="\/img\/stock\/([a-z-]+)-\d+\.webp"/g)) {
        if (!uses.has(m[1])) uses.set(m[1], []);
        uses.get(m[1]).push(page);
      }
    }
    assert.ok(uses.size >= 5, `expected the photographs to be in use, saw ${[...uses.keys()]}`);
    for (const [photo, where] of uses) {
      assert.equal(where.length, 1, `${photo} is used ${where.length} times: ${where.join(', ')}`);
    }
  });
});

describe('navigation to the new pages', () => {
  for (const page of ['/', '/services', '/privacy', '/about', '/gallery', '/testimonials', '/faq', '/contact']) {
    test(`${page} links every section page`, async () => {
      const body = (await srv.call(page)).body;
      for (const href of ['/about', '/gallery', '/testimonials', '/faq', '/contact']) {
        assert.ok(body.includes(`href="${href}"`), `${href} link`);
      }
    });
  }

  test('both pages are in the sitemap', async () => {
    const xml = (await srv.call('/sitemap.xml')).body;
    assert.match(xml, /<loc>[^<]+\/about<\/loc>/);
    assert.match(xml, /<loc>[^<]+\/gallery<\/loc>/);
    assert.match(xml, /<loc>[^<]+\/faq<\/loc>/);
    assert.match(xml, /<loc>[^<]+\/contact<\/loc>/);
  });
});
