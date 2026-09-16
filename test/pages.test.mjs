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
    assert.ok(published.length >= 14);
    for (const s of published) assert.ok(r.body.includes(`/services/${s.slug}`), s.slug);
  });

  test('covers the treatments the clinic confirmed it offers', async () => {
    // Implants, orthodontics and aesthetic dentistry came from the clinic's own
    // opening material; dentures, wisdom teeth and gum treatment were
    // confirmed directly. None of them are inferred.
    for (const slug of ['dental-implants', 'braces-aligners', 'aesthetic-dentistry',
                        'dentures', 'wisdom-tooth', 'gum-treatment']) {
      const svc = await servicesRepo.findPublicBySlug(slug);
      assert.ok(svc, `${slug} should exist`);
      assert.ok(svc.who_needs, `${slug} needs page content, not an empty page`);
      assert.ok(svc.what_to_expect);
      assert.ok(svc.benefits);
      assert.equal((await srv.call(`/services/${slug}`)).status, 200);
    }
  });

  test('has no page for a treatment the clinic has not confirmed', async () => {
    // Nothing is listed on inference. These have never been confirmed, so a
    // patient must not be able to land on a page offering them.
    for (const slug of ['smile-makeover', 'sedation-dentistry', 'jaw-surgery']) {
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

describe('header on a phone', () => {
  test('keeps the brand line short enough not to widen the page', async () => {
    const r = await srv.call('/');
    // The full address is nearly twice the length of the doctor's name it
    // replaced and the sub-line is nowrap, so putting it here pushed the header
    // 53px past the viewport on a 414px phone — wide phones broke while narrow
    // ones passed, because below 400px the header CTA is hidden and it fit.
    const m = r.body.match(/class="brand-sub">([^<]*)</);
    assert.ok(m, 'the header carries a location line');
    const line = m[1].trim();
    assert.ok(line.length <= 24, `brand line is ${line.length} chars: "${line}"`);
    assert.ok(line.includes('Talcher'), 'the town is the part worth keeping');
    // The full address still belongs further down the page.
    assert.ok(r.body.includes('FCI Township'), 'the full address stays in the body');
  });

  test('lets the brand block shrink instead of pushing the header wider', async () => {
    const css = await srv.call('/css/site.css');
    assert.match(css.body, /\.brand-text\{[^}]*min-width:0/,
      'a flex item defaults to min-width:auto, which is what lets nowrap text widen the header');
  });
});

describe('mobile menu', () => {
  test('the panel is not nested inside the header', async () => {
    const r = await srv.call('/');
    /*
     * The header carries backdrop-filter, and a filter makes an element the
     * containing block for its position:fixed descendants. Nested inside it the
     * panel's inset resolved against the 70px header rather than the viewport,
     * so it opened as a 40px sliver with the page showing through — while still
     * reporting display:block and aria-expanded="true", which is why a check
     * for "does it open" passed straight over it.
     */
    const headerEnd = r.body.indexOf('</header>');
    const panelStart = r.body.indexOf('id="mobilePanel"');
    assert.ok(headerEnd > -1 && panelStart > -1);
    assert.ok(panelStart > headerEnd,
      'the panel must be a sibling of <header>, not a descendant of it');
  });

  test('every page carries the panel, so the menu works away from home', async () => {
    for (const path of ['/', '/services', '/services/dentures', '/privacy']) {
      const r = await srv.call(path);
      assert.ok(r.body.includes('id="mobilePanel"'), path);
      assert.ok(r.body.indexOf('id="mobilePanel"') > r.body.indexOf('</header>'), path);
    }
  });
});
