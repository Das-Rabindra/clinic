/**
 * Server-rendered public pages. Rendering on the server (rather than fetching
 * on the client) keeps the content crawlable and means the page is useful
 * before any JavaScript runs.
 */
import { Router } from 'express';
import * as settingsRepo from '../repositories/settings.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as galleryRepo from '../repositories/gallery.repo.js';
import * as contentRepo from '../repositories/content.repo.js';
import * as mediaRepo from '../repositories/media.repo.js';
import * as reviewsService from '../services/google/reviews.service.js';
import * as seo from '../services/seo.service.js';
import { publicClinic, whatsappLink } from '../services/clinic.view.js';
import { esc, jsonForScript } from '../utils/format.js';
import { weekdayOf, todayIn } from '../utils/time.js';
import { issuePublicToken } from '../middleware/csrf.js';
import { colorTokens, contrast } from '../utils/design-tokens.js';

const router = Router();

/* The clinic's own treatment-room photograph, supplied by the clinic in
   October 2026 and re-encoded to WebP (EXIF stripped) at three widths. */
const CLINIC_PHOTO = {
  url: '/img/clinic/treatment-room-1086.webp',
  srcset: '/img/clinic/treatment-room-480.webp 480w, /img/clinic/treatment-room-720.webp 720w, /img/clinic/treatment-room-1086.webp 1086w',
  sizes: '(min-width: 1024px) 560px, calc(100vw - 32px)',
  width: 1086,
  height: 1086,
  alt: 'The treatment room at Samal Dental Care, with the dental chair beside the consultation desk',
};

const CATEGORY_LABELS = {
  clinic: 'Clinic', reception: 'Reception', treatment_room: 'Treatment room',
  exterior: 'Exterior', equipment: 'Equipment', waiting_area: 'Waiting area',
  team: 'Team', doctor: 'Doctor', treatment: 'Before & after',
};

/** Inline star SVGs, matching the honey accent used across the design. */
function starsHtml(rating) {
  const r = Math.round(Number(rating) || 0);
  let out = '';
  for (let i = 1; i <= 5; i++) {
    out += `<svg viewBox="0 0 24 24" class="${i <= r ? 'star-on' : 'star-off'}" stroke-width="1.5" aria-hidden="true"><path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.9l7-1L12 1.5l3 6.4 7 1-5 4.8 1.2 6.9z"/></svg>`;
  }
  return out;
}

function formatReviewDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/**
 * Is the doctor's own bio worth printing under the About copy?
 *
 * Only when it actually says something the About copy does not. The seeded bio
 * is a shorter restatement of it, so an exact `!==` comparison let both render
 * and the section repeated itself almost word for word. Comparing on
 * normalised text — case, punctuation and spacing removed — catches the
 * restatement, while a genuinely different bio the clinic has written still
 * shows.
 */
function saysSomethingNew(bio, about) {
  if (!bio) return false;
  if (!about) return true;

  const words = (t) => String(t).toLowerCase().match(/[a-z0-9]+/g) || [];
  const bioWords = words(bio);
  const aboutWords = new Set(words(about));
  if (!bioWords.length) return false;

  /* Below a handful of words the ratio is too coarse to trust, so fall back to
     an exact comparison. */
  if (bioWords.length < 5) return bioWords.join(' ') !== [...words(about)].join(' ');

  /* The seeded bio differs from the About copy by a single conjunction
     ("BDS, FRCD" against "BDS and FRCD"), which defeats a substring test but
     leaves every word accounted for. */
  const covered = bioWords.filter((w) => aboutWords.has(w)).length;
  return covered / bioWords.length < 0.9;
}

/**
 * The clinic's opening hours as a sentence, built from the live weekly grid.
 *
 * FAQ answers used to state the timings as fixed text, so changing the hours
 * in the admin panel left the FAQ contradicting the table directly above it.
 * Collapsing identical days keeps it readable whether the clinic opens the
 * same hours all week or varies them.
 */
function hoursSentence(clinic) {
  const open = clinic.hours.filter(h => h.is_open);
  if (!open.length) return 'Please call the clinic for current timings';

  const shape = (h) => `${h.open_label} to ${h.close_label}` +
    (h.break_start && h.break_end
      ? `, with a break between ${h.break_start_label} and ${h.break_end_label}`
      : '');
  const same = open.length === 7 && open.every(h => shape(h) === shape(open[0]));
  if (same) return `every day from ${shape(open[0])}`;

  /* Mixed week: list each open day so nothing is implied that is not true. */
  return open
    .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7))
    .map(h => `${h.day} ${shape(h)}`)
    .join('; ');
}

/**
 * A day's hours as display text, break included.
 *
 * The weekly table used to print opening and closing time only, so it said
 * "09:00 – 22:00" while the FAQ, the booking engine and the structured data
 * all knew about the 1–3 PM break. Every visible statement of the hours now
 * comes from here.
 */
function dayHours(h) {
  if (!h || !h.is_open) return { closed: true, text: 'Closed' };
  const hasBreak = h.break_start && h.break_end;
  return {
    closed: false,
    text: `${h.open_label} – ${h.close_label}`,
    breakText: hasBreak ? `Closed ${h.break_start_label} – ${h.break_end_label}` : null,
    sessions: hasBreak
      ? [`${h.open_label} – ${h.break_start_label}`, `${h.break_end_label} – ${h.close_label}`]
      : [`${h.open_label} – ${h.close_label}`],
  };
}

/** Resolve FAQ placeholders so answers track the clinic's real details. */
function resolveFaq(text, clinic) {
  return String(text || '')
    .replaceAll('{{phone}}', clinic.phone || '')
    .replaceAll('{{phone2}}', clinic.phone_secondary || '')
    .replaceAll('{{whatsapp}}', clinic.phone || '')
    .replaceAll('{{hours}}', hoursSentence(clinic))
    .replaceAll('{{address}}', clinic.address || '')
    .replaceAll('{{clinic}}', clinic.name || '')
    /* A clinic with only one line should not read "or 
". */
    .replace(/\s*(?:,|\bor\b|\band\b)?\s*\(\s*\)/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Locals every public page needs: branding, contact actions and the footer.
 *
 * Collected in one place so a new page cannot quietly ship with a broken logo
 * or a missing WhatsApp link, and so the header/footer partials can assume
 * these are always present.
 */
export async function publicLocals(opts) { return baseLocals(opts); }

async function baseLocals({ navBase = '/' } = {}) {
  const settings = await settingsRepo.get();
  const clinic = await publicClinic();
  const todayIdx = weekdayOf(todayIn(clinic.timezone));

  const logo = settings.logo_media_id ? await mediaRepo.findById(settings.logo_media_id) : null;
  const favicon = settings.favicon_media_id ? await mediaRepo.findById(settings.favicon_media_id) : null;
  const reviewQr = settings.review_qr_media_id
    ? await mediaRepo.findById(settings.review_qr_media_id) : null;

  /* A short list for the footer: the treatments patients most often look for,
     taken from the clinic's own ordering rather than hardcoded. */
  const footerServices = (await servicesRepo.list({ activeOnly: true, featuredFirst: true }))
    .filter(s => s.has_detail_page).slice(0, 6);

  return {
    /* Every public page renders on the design system (ds.css); pages add
       their own stylesheet, the homepage overriding this default. */
    ds: true,
    pageCss: ['/css/pages.css'],
    settings,
    clinic: { ...clinic, youtube_url: settings.youtube_url, today: { ...clinic.today, weekdayIndex: todayIdx } },
    navBase,
    logoUrl: logo?.url || '/img/logo-96.png',
    reviewQr,
    faviconUrl: favicon?.url || '/img/logo-64.png',
    whatsappUrl: await whatsappLink(),
    footerServices,
    todayHours: clinic.today.now.label,
    shortAddress: [settings.area, settings.city].filter(Boolean).join(', ')
      || [settings.address_line1, settings.city].filter(Boolean).join(', ')
      || clinic.address,
    /*
     * A deliberately short version for the header, where the brand, a phone
     * number and two controls already compete for a phone's width. The full
     * shortAddress ("Bikrampur, FCI Township, Talcher") is nearly twice as long
     * as the doctor's name it replaced and, being nowrap, pushed the header
     * 53px wider than the viewport on a 414px phone.
     */
    brandLocation: [String(settings.area || '').split(',')[0].trim(), settings.city]
      .filter(Boolean).join(' · ') || settings.city || '',
    initials: (settings.doctor_name || settings.name || '')
      .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'SD',
    jsonForScript,
  };
}

/* ── Home ────────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  const base = await baseLocals({ navBase: '' });
  const { settings, clinic } = base;

  const services = await servicesRepo.list({ activeOnly: true });
  const doctor = await doctorsRepo.primary();
  const gallery = await galleryRepo.listPublic();
  const faqs = (await contentRepo.listFaqs({ publishedOnly: true }))
    .map(f => ({ question: resolveFaq(f.question, clinic), answer: resolveFaq(f.answer, clinic) }));
  const reviews = await reviewsService.publicReviews();

  // Ensure a CSRF token exists before the booking form needs one.
  issuePublicToken(req, res);

  const categoryKeys = [...new Set(gallery.map(g => g.category))];

  // Weekly hours starting Monday, which is how a clinic reads them.
  const orderedHours = [1, 2, 3, 4, 5, 6, 0]
    .map(w => clinic.hours.find(h => h.weekday === w))
    .filter(Boolean);

  const heroMedia = settings.hero_media_id ? await mediaRepo.findById(settings.hero_media_id) : null;
  const doctorMedia = doctor?.photo_media_id ? await mediaRepo.findById(doctor.photo_media_id) : null;

  /* A genuine photograph of the clinic beats licensed stock. The admin's own
     hero choice is used unless it is flagged as stock, in which case the
     clinic's treatment-room photograph (supplied by the clinic, bundled with
     the site) takes its place. */
  const heroImage = heroMedia && !heroMedia.is_stock ? heroMedia : CLINIC_PHOTO;

  const metaTags = seo.meta(settings);
  if (!metaTags.ogImage) metaTags.ogImage = new URL(heroImage.url, metaTags.canonical).toString();

  const todayRow = clinic.hours.find(h => h.weekday === clinic.today.weekdayIndex);
  const galleryMode = gallery.length === 0 ? 'empty'
    : gallery.length === 1 ? 'single'
    : gallery.length <= 4 ? 'grid' : 'carousel';

  res.render('public/index', {
    ...base,
    ds: true,
    /* booking.css blocks render on purpose: arriving at /#appointment from a
       treatment page shows the wizard first, and it must not flash unstyled. */
    pageCss: ['/css/home.css', '/css/booking.css'],
    weekHours: orderedHours.map(h => ({ ...h, display: dayHours(h) })),
    todayHoursDisplay: clinic.today.is_open ? dayHours(todayRow) : null,
    hoursSummary: hoursSentence(clinic),
    galleryMode,
    preloadImage: heroImage.url,
    preloadSrcset: heroImage.srcset || null,
    preloadSizes: '100vw',      // must match the hero <img sizes>, or the image downloads twice
    preloadItalic: true,        // the hero headline's last line is set in Lora italic
    emergency: services.find(s => s.slug === 'dental-emergency') || null,
    ...(() => {
      /* The homepage leads with six treatments and lists the rest. Emergency
         care is excluded from both: it has its own band at the top, and
         repeating it as a card would dilute that. */
      const grid = services.filter(s => s.slug !== 'dental-emergency');
      const lead = grid.filter(s => s.is_featured).slice(0, 6);
      const leadIds = new Set(lead.map(s => s.id));
      return { featuredServices: lead, otherServices: grid.filter(s => !leadIds.has(s.id)) };
    })(),
    services, doctor, gallery, faqs, reviews, orderedHours,
    galleryCategories: categoryKeys.map(k => ({ key: k, label: CATEGORY_LABELS[k] || k })),
    meta: metaTags,
    schemas: [await seo.structuredData(), seo.faqStructuredData(faqs)],
    heroImage,
    doctorPhoto: doctorMedia,
    showDoctorBio: saysSomethingNew(doctor?.bio, settings.about_body),
    addressHtml: [settings.name, settings.address_line1, settings.address_line2,
      settings.area, [settings.city, settings.state].filter(Boolean).join(', '), settings.postal_code]
      .filter(Boolean).map(esc).join('<br>'),
    heroTitleHtml: esc(settings.hero_title || settings.name).replace(/\s*\n\s*/g, ' <br>'),
    /* The hero headline as separate lines, for the line-by-line reveal. The
       admin's own line break decides where lines fall. */
    heroLines: String(settings.hero_title || settings.name).split(/\s*\n\s*/).filter(Boolean),
    servicesJson: JSON.stringify(services.map(s => ({
      id: s.id, name: s.name, slug: s.slug, duration: s.duration_min,
      desc: s.short_desc, category: s.category_name, bookable: s.bookable === 1,
    }))).replace(/'/g, '&#39;'),
    starsHtml, formatReviewDate,
  });
});

/* ── Treatments ──────────────────────────────────────────────────────────── */
router.get('/services', async (_req, res) => {
  const base = await baseLocals();
  const cards = await servicesRepo.list({ activeOnly: true, featuredFirst: true });
  const canonical = seo.canonicalUrl(base.settings);
  const town = base.settings.city || base.settings.area || '';

  res.render('public/services', {
    ...base,
    cards,
    meta: {
      title: `Dental Treatments${town ? ` in ${town}` : ''} | ${base.settings.name}`,
      description: base.settings.services_lede || base.settings.seo_description || '',
      canonical: `${canonical}/services`,
      ogTitle: `Dental Treatments${town ? ` in ${town}` : ''} | ${base.settings.name}`,
      ogDescription: base.settings.services_lede || '',
      ogUrl: `${canonical}/services`,
      ogImage: base.settings.og_image_url || null,
    },
    ogType: 'website',
    schemas: [
      seo.breadcrumbs(canonical, [{ name: 'Home', path: '/' }, { name: 'Treatments', path: '/services' }]),
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: cards.map((s, i) => ({
          '@type': 'ListItem', position: i + 1, name: s.name,
          url: s.has_detail_page ? `${canonical}/services/${s.slug}` : undefined,
        })),
      },
    ],
  });
});

router.get('/services/:slug', async (req, res, next) => {
  const service = await servicesRepo.findPublicBySlug(req.params.slug);
  if (!service) return next();               // falls through to the 404 handler

  const base = await baseLocals();
  const { settings, clinic } = base;
  const canonical = seo.canonicalUrl(settings);

  const doctor = await doctorsRepo.primary();
  const doctorPhoto = doctor?.photo_media_id ? await mediaRepo.findById(doctor.photo_media_id) : null;

  const related = await servicesRepo.relatedFor(service, 3);

  /*
   * The treatment's own questions. Every page used to carry the same five
   * site-wide ones, which answered nothing about the treatment and duplicated
   * the identical block — and its FAQPage markup — across fourteen URLs. The
   * site-wide set is the fallback only where a treatment has none of its own.
   */
  const ownFaqs = await servicesRepo.faqsFor(service.id);
  const faqs = (ownFaqs.length
    ? ownFaqs
    : (await contentRepo.listFaqs({ publishedOnly: true })).slice(0, 5)
  ).map(f => ({ question: resolveFaq(f.question, clinic), answer: resolveFaq(f.answer, clinic) }));

  issuePublicToken(req, res);

  res.render('public/service', {
    ...base,
    service,
    preloadImage: service.image_url || null,
    benefits: String(service.benefits || '').split('\n').map(s => s.trim()).filter(Boolean),
    related, faqs, doctorPhoto,
    meta: seo.serviceMeta(service, settings),
    ogType: 'article',
    schemas: [
      seo.serviceStructuredData(service, settings),
      seo.breadcrumbs(canonical, [
        { name: 'Home', path: '/' },
        { name: 'Treatments', path: '/services' },
        { name: service.name, path: `/services/${service.slug}` },
      ]),
      seo.faqStructuredData(faqs),
    ],
    treatmentWhatsapp: await whatsappLink(
      `Hello ${settings.name}, I would like to ask about ${service.name}.`),
  });
});

/* ── Privacy / appointment policy ────────────────────────────────────────── */
router.get('/privacy', async (_req, res) => {
  const base = await baseLocals();
  const canonical = seo.canonicalUrl(base.settings);
  res.render('public/privacy', {
    ...base,
    meta: {
      title: `Privacy & Appointment Policy | ${base.settings.name}`,
      description: `How ${base.settings.name} handles the information you give through this website, and how to change or cancel an appointment.`,
      canonical: `${canonical}/privacy`,
      ogTitle: `Privacy & Appointment Policy | ${base.settings.name}`,
      ogDescription: 'What this website collects, why, and what it is never used for.',
      ogUrl: `${canonical}/privacy`,
      ogImage: null,
    },
    ogType: 'website',
    schemas: [seo.breadcrumbs(canonical, [{ name: 'Home', path: '/' }, { name: 'Privacy', path: '/privacy' }])],
    /* The policy's real revision date, not the current month — a privacy
       page claiming it changed every month would be untrue. */
    updatedAt: new Date(`${seo.PRIVACY_UPDATED}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  });
});

/* ── Design-system preview ───────────────────────────────────────────────────
   Internal review page for the redesign's tokens and primitives. Unlinked,
   noindex by meta and header, and absent from the sitemap (which lists routes
   explicitly). It renders no clinic facts beyond the name. */
router.get('/_styleguide', async (_req, res) => {
  const tokens = colorTokens();
  const swatch = (token, name, against) => ({
    token, name, value: tokens.get(token),
    note: against ? `${contrast(tokens.get(token), tokens.get(against))}:1 on ${against.replace('--color-', '')}` : '',
  });
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.render('public/styleguide', {
    clinicName: (await settingsRepo.get()).name,
    swatches: [
      { title: 'Surfaces', items: [
        swatch('--color-bg', 'Background'), swatch('--color-surface', 'Surface'),
        swatch('--color-accent-sage', 'Sage (decorative)', '--color-bg'),
        swatch('--color-accent-sand', 'Sand (decorative)', '--color-bg') ] },
      { title: 'Brand & text', items: [
        swatch('--color-primary', 'Primary', '--color-bg'),
        swatch('--color-primary-hover', 'Primary hover', '--color-bg'),
        swatch('--color-text', 'Text', '--color-bg'),
        swatch('--color-text-muted', 'Text muted', '--color-accent-sand') ] },
      { title: 'Lines & focus', items: [
        swatch('--color-border-subtle', 'Border subtle (decorative)', '--color-surface'),
        swatch('--color-border-strong', 'Border strong', '--color-accent-sand'),
        swatch('--color-focus', 'Focus ring', '--color-accent-sand'),
        swatch('--color-disabled-bg', 'Disabled bg'),
        swatch('--color-disabled-text', 'Disabled text', '--color-disabled-bg') ] },
      { title: 'Feedback', items: ['success', 'error', 'warning', 'info'].flatMap(k => [
        swatch(`--color-${k}-text`, `${k[0].toUpperCase()}${k.slice(1)} text`, `--color-${k}-bg`),
        swatch(`--color-${k}-bg`, `${k[0].toUpperCase()}${k.slice(1)} tint`) ]) },
    ],
  });
});

/* ── Testimonials layout preview (client demo) ────────────────────────────
   Shows the homepage testimonials section as it will look once genuine
   reviews arrive, filled with SAMPLE content and labelled as such on the
   page and on every card. noindex by meta and header, unlinked, not in the
   sitemap, and it emits no structured data — so nothing here can be read as
   a real review by a patient or a search engine. The live homepage keeps
   its genuine-only behaviour. */
const SAMPLE_REVIEWS = [
  ['Biswa P Tripathy', 5, 'The doctor explained every step before starting and never rushed me. The clinic is clean and calm.', '2026-10-18'],
  ['Subrat Das', 5, 'Booked online in a couple of minutes and was seen on time. Friendly people at the front desk.', '2026-10-15'],
  ['Bunny', 5, 'My first visit to a dentist in years. I was nervous, but everything was explained gently and patiently.', '2026-10-12'],
  ['Sushil K', 4, 'Easy to find in the Annapurna Market Complex. Clear advice and no pressure to take extra treatment.', '2026-10-09'],
  ['Mamuni Pradhan', 5, 'Brought my mother for a check-up. The doctor was patient with all of our questions.', '2026-10-05'],
  ['Baibhav Kumar Samal', 5, 'Good to have a proper dental clinic so close to home in Talcher.', '2026-09-30'],
  ['Sradha Suman Samal', 5, 'A warm welcome and a very clean treatment room. Everything felt well organised.', '2026-09-24'],
  ['Nihal Garanayak', 4, 'Called in the evening and got a convenient time for the next day. Would recommend.', '2026-09-20'],
];

router.get('/_preview/testimonials', async (req, res) => {
  const base = await baseLocals();
  const list = SAMPLE_REVIEWS.map(([author_name, rating, text, reviewed_at]) =>
    ({ author_name, rating, text, reviewed_at, source: 'manual' }));
  const average = (list.reduce((n, r) => n + r.rating, 0) / list.length).toFixed(1);
  issuePublicToken(req, res);
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.render('public/preview-testimonials', {
    ...base,
    pageCss: ['/css/home.css'],
    noindex: true,
    meta: {
      title: `Testimonials layout preview (sample content) | ${base.settings.name}`,
      description: '', canonical: '', ogTitle: '', ogDescription: '', ogUrl: '', ogImage: null,
    },
    schemas: [],
    reviews: { reviews: list, average, count: list.length, google_count: 0, has_manual: true },
    starsHtml, formatReviewDate,
    sample: true,
  });
});

/* SEO endpoints, generated from live settings. */
router.get('/robots.txt', async (_req, res) => {
  res.type('text/plain').send(seo.robotsTxt(seo.canonicalUrl(await settingsRepo.get())));
});
router.get('/sitemap.xml', async (_req, res) => {
  res.type('application/xml').send(await seo.sitemapXml(seo.canonicalUrl(await settingsRepo.get())));
});

router.get('/healthz', async (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

export default router;
