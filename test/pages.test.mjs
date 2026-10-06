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
    /* Fonts are self-hosted: loading them from Google was the entire cause of
       the site's CLS, so neither font host should be permitted any more. */
    const style = directive('style-src');
    assert.ok(!style.includes('fonts.googleapis.com'), 'fonts are served from this origin');
    const font = directive('font-src');
    assert.ok(font.includes("'self'"));
    assert.ok(!font.includes('fonts.gstatic.com'));
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

describe('contact details', () => {
  test('publishes the primary number and keeps the old one as a second line', async () => {
    const s = await settingsRepo.get();
    assert.equal(s.phone, '8847879686');
    assert.equal(s.phone_intl, '+918847879686');
    assert.equal(s.phone_secondary, '9124839288');

    const r = await srv.call('/');
    // Every tel: link must dial the primary except the ones that deliberately
    // offer the alternative.
    const tels = [...r.body.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tels.length >= 4);
    assert.ok(tels.filter((t) => t === '+918847879686').length >= tels.length - 2,
      `primary should dominate: ${JSON.stringify(tels)}`);
    assert.ok(tels.includes('+919124839288'), 'the second line is published too');
  });

  test('WhatsApp always uses the primary number', async () => {
    const r = await srv.call('/');
    const was = [...r.body.matchAll(/wa\.me\/(\d+)/g)].map((m) => m[1]);
    assert.ok(was.length > 0);
    // Messaging a number that is not on WhatsApp fails silently for the patient.
    assert.deepEqual([...new Set(was)], ['918847879686']);
    assert.match(decodeURIComponent(r.body.match(/wa\.me\/\d+\?text=([^"]+)/)[1]),
      /I would like to book an appointment at Samal Dental Care/);
  });

  test('carries the clinic coordinates so directions reach the door', async () => {
    const s = await settingsRepo.get();
    assert.ok(Math.abs(s.latitude - 20.9033969) < 0.0001);
    assert.ok(Math.abs(s.longitude - 85.1743727) < 0.0001);
    const r = await srv.call('/api/clinic');
    assert.match(r.body.directions_url, /destination=20\.903/);
  });
});

describe('opening hours', () => {
  test('are 9:00 AM to 10:00 PM every day', async () => {
    const hours = await settingsRepo.getHours();
    assert.equal(hours.length, 7);
    for (const h of hours) {
      assert.equal(h.is_open, 1, `weekday ${h.weekday}`);
      assert.equal(h.open_min, 540);
      assert.equal(h.close_min, 1320);
    }
  });

  test('the FAQ states the hours the grid actually holds', async () => {
    const r = await srv.call('/');
    // The answer is a placeholder resolved at render, so it cannot drift from
    // the table above it the way fixed text did.
    assert.match(r.body, /open every day from 9:00 AM to 10:00 PM/);
    assert.ok(!r.body.includes('8:00 AM to 9:00 PM'), 'no stale timings anywhere');
  });

  test('no two published FAQs ask the same thing', async () => {
    const faqs = (await (await import('../src/repositories/content.repo.js'))
      .listFaqs({ publishedOnly: true }));
    const qs = faqs.map((f) => f.question.toLowerCase());
    assert.equal(new Set(qs).size, qs.length);
    // The thin seeded location/contact questions were superseded.
    assert.ok(!qs.includes('where is samal dental care located?'));
    assert.ok(!qs.includes('how can i contact the clinic?'));
  });
});

describe('call back about a treatment', () => {
  test('records which treatment the request was about', async () => {
    const svc = await servicesRepo.findPublicBySlug('root-canal-treatment');
    await srv.call('/api/csrf');
    const r = await srv.call('/api/enquiries', {
      headers: { 'X-CSRF-Token': srv.csrf() },
      json: { name: 'Anita Sahoo', phone: '9876500011', preferred_contact: 'phone', service_id: svc.id },
    });
    assert.equal(r.status, 201);
    const repo = await import('../src/repositories/content.repo.js');
    const e = await repo.findEnquiry(r.body.id);
    assert.equal(e.service_id, svc.id);
    assert.equal(e.service_name, 'Root Canal Treatment');
  });

  test('an unknown treatment is dropped, not a reason to lose the request', async () => {
    const r = await srv.call('/api/enquiries', {
      headers: { 'X-CSRF-Token': srv.csrf() },
      json: { name: 'Anita Sahoo', phone: '9876500012', service_id: 999999 },
    });
    assert.equal(r.status, 201, 'the patient still gets their call back');
    const repo = await import('../src/repositories/content.repo.js');
    assert.equal((await repo.findEnquiry(r.body.id)).service_id, null);
  });
});

describe('FAQ accordion', () => {
  test('every published question ships an answer with real content', async () => {
    const repo = await import('../src/repositories/content.repo.js');
    const faqs = await repo.listFaqs({ publishedOnly: true });
    assert.ok(faqs.length >= 10);
    for (const f of faqs) {
      assert.ok(f.answer && f.answer.trim().length > 40, `"${f.question}" has a thin answer`);
      assert.ok(!/\{\{\w+\}\}/.test(
        f.answer.replaceAll('{{hours}}', '').replaceAll('{{phone}}', '')
          .replaceAll('{{phone2}}', '').replaceAll('{{address}}', '')
          .replaceAll('{{clinic}}', '').replaceAll('{{whatsapp}}', '')),
        `"${f.question}" uses an unknown placeholder`);
    }
  });

  test('renders every answer into the page, not just the questions', async () => {
    const r = await srv.call('/');
    const repo = await import('../src/repositories/content.repo.js');
    for (const f of await repo.listFaqs({ publishedOnly: true })) {
      // A distinctive fragment, with placeholders and entities avoided.
      /*
       * Compare on words only: the page HTML-escapes quotes and dashes, so a
       * literal match fails on punctuation the answer never lost. And probe
       * the longest run that contains no placeholder — a probe spanning
       * {{hours}} can never match, because the placeholder has been replaced
       * by the time it reaches the page.
       */
      const words = (t) => t.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      const run = f.answer.split(/\{\{\w+\}\}/)
        .reduce((a, b) => (words(b).length > words(a).length ? b : a), '');
      const probe = words(run).slice(0, 6).join(' ');
      const page = words(r.body).join(' ');
      assert.ok(page.includes(probe), `answer missing from the page: "${f.question}"`);
    }
  });

  test('the answer panel can actually be opened', async () => {
    /*
     * `.faq-a` collapses to max-height:0 and nothing in the stylesheet ever
     * expanded it, while the padding was written against `.faq-a-inner` — a
     * class the markup has never contained. Clicking a question did nothing.
     */
    const css = (await srv.call('/css/site.css')).body;
    assert.match(css, /\.js \.faq-a\{[^}]*max-height:0/,
      'collapsed state must be gated on JS being present');
    assert.match(css, /\.faq-a > p\{/,
      'the answer padding must target the element the markup actually renders');
    // Only a selector counts — the comment above the rule names the old class.
    assert.ok(!/\.faq-a-inner\s*[{,]/.test(css),
      'no rules left pointing at a class that is never rendered');

    const js = (await srv.call('/js/site.js')).body;
    assert.match(js, /maxHeight = panel\.scrollHeight/,
      'opening must set the measured height so no answer is clipped');

    const page = (await srv.call('/')).body;
    assert.match(page, /classList\.add\('js'\)/,
      'the js class must be set before paint, or the answers flash open on load');
  });
});

describe('fixes from the audit', () => {
  test('opening hours markup splits around the midday break', async () => {
    const r = await srv.call('/');
    const dentist = [...r.body.matchAll(/application\/ld\+json">(.*?)<\/script>/gs)]
      .map((m) => JSON.parse(m[1])).find((d) => d['@type'] === 'Dentist');
    const spec = dentist.openingHoursSpecification;
    // A single 09:00-22:00 block told Google the clinic was open at 2 PM.
    assert.equal(spec.length, 14, 'two blocks per open day');
    assert.ok(spec.some((s) => s.opens === '09:00' && s.closes === '13:00'));
    assert.ok(spec.some((s) => s.opens === '15:00' && s.closes === '22:00'));
    assert.ok(!spec.some((s) => s.opens === '09:00' && s.closes === '22:00'));
  });

  test('the clinic node carries an image and no price claim', async () => {
    const r = await srv.call('/');
    const dentist = [...r.body.matchAll(/application\/ld\+json">(.*?)<\/script>/gs)]
      .map((m) => JSON.parse(m[1])).find((d) => d['@type'] === 'Dentist');
    assert.ok(dentist.image, 'image is expected on a LocalBusiness');
    assert.match(dentist.image, /^https?:\/\//, 'must be absolute');
    assert.ok(!('priceRange' in dentist), 'the clinic does not publish prices');
    assert.ok(Array.isArray(dentist.areaServed) && dentist.areaServed.length);
  });

  test('no price is shown anywhere on a treatment page', async () => {
    const svc = await servicesRepo.findPublicBySlug('root-canal-treatment');
    await servicesRepo.update(svc.id, { price_from: 4500, show_price: 1 });
    try {
      const r = await srv.call('/services/root-canal-treatment');
      assert.ok(!r.body.includes('4500'), 'a price must not render even when one is stored');
      assert.ok(!r.body.includes('₹'));
    } finally {
      await servicesRepo.update(svc.id, { price_from: null, show_price: 0 });
    }
  });

  test('each treatment page carries its own questions', async () => {
    const a = await srv.call('/services/root-canal-treatment');
    const b = await srv.call('/services/dentures');
    assert.match(a.body, /Does a root canal hurt\?/);
    assert.match(b.body, /How long do dentures last\?/);
    // The identical generic block used to repeat across all 14 URLs.
    assert.ok(!a.body.includes('Do I need to book before visiting?'));
  });

  test('related treatments differ by page and make clinical sense', async () => {
    const pick = async (slug) => {
      const r = await srv.call(`/services/${slug}`);
      return [...r.body.matchAll(/<a href="\/services\/([a-z-]+)" class="tx-link"/g)].map((m) => m[1]);
    };
    const rct = await pick('root-canal-treatment');
    const dent = await pick('dentures');
    assert.notDeepEqual(rct, dent, 'every page used to suggest the same three');
    assert.ok(rct.includes('crowns-bridges'), 'a root-treated tooth usually needs a crown');
    assert.ok(dent.includes('dental-implants'));
  });

  test('an urgent-care route exists and the homepage points at it', async () => {
    assert.equal((await srv.call('/services/dental-emergency')).status, 200);
    const home = await srv.call('/');
    assert.match(home.body, /In pain today\?/);
    assert.ok(home.body.includes('/services/dental-emergency'));
  });

  test('the homepage leads with six treatments, not fourteen', async () => {
    const r = await srv.call('/');
    const cards = (r.body.match(/class="tx-card"/g) || []).length;
    assert.equal(cards, 6, 'fourteen near-identical cards buried the section');
    assert.match(r.body, /Also treated at the clinic/);
  });

  test('the map embed does not depend on WebGL', async () => {
    const r = await srv.call('/api/clinic');
    // OpenStreetMap's embed renders through WebGL and shows an error without it.
    assert.ok(!r.body.map_embed_url.includes('openstreetmap'));
    assert.match(r.body.map_embed_url, /google\.com\/maps/);
    assert.match(r.body.map_embed_url, /20\.903/);
  });

  test('the 404 page carries the site layout and a way to reach the clinic', async () => {
    const r = await srv.call('/no-such-page');
    assert.equal(r.status, 404);
    assert.ok(r.body.includes('id="mobilePanel"'), 'navigation');
    assert.ok(r.body.includes('tel:'), 'a phone number');
    assert.ok(r.body.includes('footer'), 'the footer');
    assert.match(r.body, /noindex/);
  });

  test('the lightbox no longer ships an empty heading', async () => {
    const r = await srv.call('/');
    const empties = [...r.body.matchAll(/<h([1-6])[^>]*>\s*<\/h\1>/g)];
    assert.equal(empties.length, 0, `empty headings: ${empties.map((m) => m[0]).join(', ')}`);
  });

  test('label colours clear WCAG AA on every page ground', async () => {
    const css = (await srv.call('/css/site.css')).body;
    const sage = css.match(/--sage-text:\s*(#[0-9A-Fa-f]{6})/);
    assert.ok(sage, 'a text-safe sage token must exist');
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const ground of ['#FAF8F3', '#F1EDE4', '#FFFFFF']) {
      assert.ok(ratio(sage[1], ground) >= 4.5,
        `${sage[1]} on ${ground} is ${ratio(sage[1], ground).toFixed(2)}:1`);
    }
    // The raw sage stays for strokes but must not be used for small text.
    assert.ok(!/\.eyebrow[^}]*color:var\(--sage\)[^-]/.test(css));
  });
});

describe('image provenance', () => {
  test('a licensed image is relabelled and disclosed, not captioned as the clinic’s work', async () => {
    const { run, one } = await import('../src/db/index.js');
    const { applyContent } = await import('../src/db/content.js');
    const svc = await servicesRepo.findPublicBySlug('teeth-whitening');

    await run(`INSERT INTO media (storage,key,url,folder,mime,ext,bytes,width,height,alt)
               VALUES ('local','services/t1','/media/t1.webp','services','image/webp','webp',900,1280,720,?)`,
      'Before and after a smile makeover, Samal Dental Care, Talcher');
    const m = await one(`SELECT id FROM media WHERE key = 'services/t1'`);
    await servicesRepo.update(svc.id, { image_media_id: m.id });
    try {
      await applyContent({ log: () => {} });
      const after = await one('SELECT alt, is_stock FROM media WHERE id = ?', m.id);
      // Claiming a stock before-and-after as this clinic's result is a claim
      // about clinical outcomes, not a caption.
      assert.ok(!/Samal Dental Care/.test(after.alt), `still claims the clinic: "${after.alt}"`);
      assert.match(after.alt, /^Illustration:/);
      assert.equal(after.is_stock, 1);

      const page = await srv.call('/services/teeth-whitening');
      assert.match(page.body, /Illustrative image/, 'said plainly where the photo is largest');
      assert.ok(!page.body.includes('Before and after a smile makeover, Samal Dental Care'));
    } finally {
      await servicesRepo.update(svc.id, { image_media_id: null });
      await run('DELETE FROM media WHERE id = ?', m.id);
    }
  });

  test('a genuine clinic photograph is left alone', async () => {
    const { run, one } = await import('../src/db/index.js');
    const { applyContent } = await import('../src/db/content.js');
    await run(`INSERT INTO media (storage,key,url,folder,mime,ext,bytes,width,height,alt)
               VALUES ('local','clinic/t2','/media/t2.webp','clinic','image/webp','webp',900,800,800,?)`,
      'Opening day at the clinic');
    const m = await one(`SELECT id FROM media WHERE key = 'clinic/t2'`);
    try {
      await applyContent({ log: () => {} });
      const after = await one('SELECT alt, is_stock FROM media WHERE id = ?', m.id);
      assert.equal(after.alt, 'Opening day at the clinic');
      assert.equal(after.is_stock, 0);
    } finally {
      await run('DELETE FROM media WHERE id = ?', m.id);
    }
  });
});
