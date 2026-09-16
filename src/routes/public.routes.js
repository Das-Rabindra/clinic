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

const router = Router();

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

/** Resolve FAQ placeholders so answers track the clinic's real details. */
function resolveFaq(text, clinic) {
  return String(text || '')
    .replaceAll('{{phone}}', clinic.phone || '')
    .replaceAll('{{whatsapp}}', clinic.whatsapp || '')
    .replaceAll('{{address}}', clinic.address || '')
    .replaceAll('{{clinic}}', clinic.name || '');
}

/**
 * Locals every public page needs: branding, contact actions and the footer.
 *
 * Collected in one place so a new page cannot quietly ship with a broken logo
 * or a missing WhatsApp link, and so the header/footer partials can assume
 * these are always present.
 */
async function baseLocals({ navBase = '/' } = {}) {
  const settings = await settingsRepo.get();
  const clinic = await publicClinic();
  const todayIdx = weekdayOf(todayIn(clinic.timezone));

  const logo = settings.logo_media_id ? await mediaRepo.findById(settings.logo_media_id) : null;
  const favicon = settings.favicon_media_id ? await mediaRepo.findById(settings.favicon_media_id) : null;

  /* A short list for the footer: the treatments patients most often look for,
     taken from the clinic's own ordering rather than hardcoded. */
  const footerServices = (await servicesRepo.list({ activeOnly: true, featuredFirst: true }))
    .filter(s => s.has_detail_page).slice(0, 6);

  return {
    settings,
    clinic: { ...clinic, youtube_url: settings.youtube_url, today: { ...clinic.today, weekdayIndex: todayIdx } },
    navBase,
    logoUrl: logo?.url || '/img/logo-96.png',
    faviconUrl: favicon?.url || '/img/logo-64.png',
    whatsappUrl: await whatsappLink(),
    footerServices,
    todayHours: clinic.today.is_open
      ? `Open today · ${clinic.today.open} – ${clinic.today.close}`
      : `Closed today${clinic.today.closure_reason ? ` · ${clinic.today.closure_reason}` : ''}`,
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

  const metaTags = seo.meta(settings);
  if (heroMedia && !metaTags.ogImage) metaTags.ogImage = new URL(heroMedia.url, metaTags.canonical).toString();

  res.render('public/index', {
    ...base,
    services, doctor, gallery, faqs, reviews, orderedHours,
    galleryCategories: categoryKeys.map(k => ({ key: k, label: CATEGORY_LABELS[k] || k })),
    meta: metaTags,
    schemas: [await seo.structuredData(), seo.faqStructuredData(faqs)],
    heroImage: heroMedia,
    doctorPhoto: doctorMedia,
    showDoctorBio: saysSomethingNew(doctor?.bio, settings.about_body),
    addressHtml: [settings.name, settings.address_line1, settings.address_line2,
      settings.area, [settings.city, settings.state].filter(Boolean).join(', '), settings.postal_code]
      .filter(Boolean).map(esc).join('<br>'),
    heroTitleHtml: esc(settings.hero_title || settings.name).replace(/\n/g, '<br>'),
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

  const related = (await servicesRepo.list({ activeOnly: true, featuredFirst: true }))
    .filter(s => s.id !== service.id && s.has_detail_page).slice(0, 3);

  const faqs = (await contentRepo.listFaqs({ publishedOnly: true }))
    .map(f => ({ question: resolveFaq(f.question, clinic), answer: resolveFaq(f.answer, clinic) }))
    .slice(0, 5);

  issuePublicToken(req, res);

  res.render('public/service', {
    ...base,
    service,
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
    updatedAt: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
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
