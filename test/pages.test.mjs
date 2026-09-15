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
    assert.ok(published.length >= 11);
    for (const s of published) assert.ok(r.body.includes(`/services/${s.slug}`), s.slug);
  });

  test('covers the treatments the clinic confirmed it offers', async () => {
    // Implants, orthodontics and aesthetic dentistry are on the clinic's own
    // opening material and were confirmed directly.
    for (const slug of ['dental-implants', 'braces-aligners', 'aesthetic-dentistry']) {
      const svc = await servicesRepo.findPublicBySlug(slug);
      assert.ok(svc, `${slug} should exist`);
      assert.ok(svc.who_needs, `${slug} needs page content, not an empty page`);
      assert.ok(svc.what_to_expect);
      assert.ok(svc.benefits);
      assert.equal((await srv.call(`/services/${slug}`)).status, 200);
    }
  });

  test('has no page for a treatment the clinic has not confirmed', async () => {
    // Dentures, wisdom-tooth surgery and gum treatment are deliberately absent.
    for (const slug of ['dentures', 'wisdom-tooth', 'gum-treatment', 'smile-makeover']) {
      assert.equal((await srv.call(`/services/${slug}`)).status, 404, slug);
    }
  });

  test('gives every treatment card its own artwork', async () => {
    const r = await srv.call('/services');
    // A slug with no branch in treatment-art.ejs silently falls back to the
    // general-dentistry mirror, which would make two cards identical.
    const art = await import('node:fs/promises')
      .then((fs) => fs.readFile('src/views/public/partials/treatment-art.ejs', 'utf8'));
    for (const s of await servicesRepo.publicSlugs()) {
      assert.ok(art.includes(`'${s.slug}'`) || s.slug === 'general-dentistry',
        `${s.slug} has no artwork branch and would reuse the generic mirror`);
    }
    assert.ok(r.body.includes('tx-art'));
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
    const r = await srv.call('/services/teeth-transplant');
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

describe('content security policy', () => {
  test('permits the origins the pages genuinely load from', async () => {
    const r = await srv.call('/');
    const csp = r.headers.get('content-security-policy');
    const directive = (name) =>
      (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '');

    const img = directive('img-src');
    assert.ok(img.includes("'self'"));
    // Google review author avatars.
    assert.ok(img.includes('googleusercontent.com'));
    const style = directive('style-src');
    assert.ok(style.includes('https://fonts.googleapis.com'), 'the page loads Google Fonts');
    const font = directive('font-src');
    assert.ok(font.includes('https://fonts.gstatic.com'));
    // The map is an iframe, and both embeds the app can emit must be allowed.
    const frame = directive('frame-src');
    assert.ok(frame.includes('https://www.google.com'));
    assert.ok(frame.includes('https://www.openstreetmap.org'),
      'mapEmbedUrl() emits an OpenStreetMap embed once coordinates are set');
  });

  test('allows the blob store to serve uploaded images', async () => {
    /*
     * `blob:` in img-src is the client-side object-URL scheme, not Vercel Blob.
     * Without the storage host every uploaded photo was fetched with a 200 and
     * then refused by the browser — empty frames on the live site, and no way
     * for the admin who uploaded it to tell why.
     */
    const { imageSources } = await import('../src/middleware/security.js');

    const blob = imageSources('blob');
    assert.ok(blob.includes('blob.vercel-storage.com'),
      `the blob host must be allowed to serve images; got: ${blob}`);

    // An explicit base URL narrows the wildcard to that one origin.
    const pinned = imageSources('blob', 'https://abc123.public.blob.vercel-storage.com/x/y.webp');
    assert.ok(pinned.includes('https://abc123.public.blob.vercel-storage.com'));
    assert.ok(!pinned.includes('*.public.blob'), 'a known origin should not stay a wildcard');

    // A malformed value must not drop the host entirely.
    assert.ok(imageSources('blob', 'not a url').includes('blob.vercel-storage.com'));

    // The local driver serves from the app's own origin, so it needs nothing extra.
    assert.ok(!imageSources('local').includes('vercel-storage'));
  });
});

describe('about section', () => {
  test('does not print the doctor bio twice when it restates the About copy', async () => {
    const r = await srv.call('/');
    const body = r.body;
    // The seeded bio differs from about_body only by a conjunction, so an
    // exact-match guard let the section repeat itself almost word for word.
    const phrase = 'holds a BDS';
    const occurrences = body.split(phrase).length - 1;
    assert.equal(occurrences, 1, `"${phrase}" appears ${occurrences} times in the About section`);
  });

  test('still shows a bio that says something the About copy does not', async () => {
    const doctorsRepo = await import('../src/repositories/doctors.repo.js');
    const doctor = await doctorsRepo.primary();
    const original = doctor.bio;
    const distinct = 'She has a particular interest in treating anxious patients.';
    await doctorsRepo.update(doctor.id, { bio: distinct });
    try {
      const r = await srv.call('/');
      assert.ok(r.body.includes(distinct), 'a genuinely different bio must still render');
    } finally {
      await doctorsRepo.update(doctor.id, { bio: original });
    }
  });

  test('gives the credential list its own styling hook', async () => {
    const r = await srv.call('/');
    assert.ok(r.body.includes('class="cred-list"'));
    const css = await srv.call('/css/site.css');
    // Only `.doctor-cred-list` was ever styled, so every row rendered as
    // unspaced running text: "QualificationBDS, FRCD".
    assert.match(css.body, /\.cred-list\b/, 'the class the template uses must be styled');
  });
});
