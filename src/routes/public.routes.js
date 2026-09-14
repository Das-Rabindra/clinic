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

/** Resolve FAQ placeholders so answers track the clinic's real details. */
function resolveFaq(text, clinic) {
  return String(text || '')
    .replaceAll('{{phone}}', clinic.phone || '')
    .replaceAll('{{whatsapp}}', clinic.whatsapp || '')
    .replaceAll('{{address}}', clinic.address || '')
    .replaceAll('{{clinic}}', clinic.name || '');
}

router.get('/', async (req, res) => {
  const settings = await settingsRepo.get();
  const clinic = await publicClinic();
  const services = await servicesRepo.list({ activeOnly: true });
  const doctor = await doctorsRepo.primary();
  const gallery = await galleryRepo.listPublic();
  const faqs = (await contentRepo.listFaqs({ publishedOnly: true }))
    .map(f => ({ question: resolveFaq(f.question, clinic), answer: resolveFaq(f.answer, clinic) }));
  const reviews = await reviewsService.publicReviews();

  // Ensure a CSRF token exists before the booking form needs one.
  issuePublicToken(req, res);

  const categoryKeys = [...new Set(gallery.map(g => g.category))];
  const todayIdx = weekdayOf(todayIn(clinic.timezone));

  // Weekly hours starting Monday, which is how a clinic reads them.
  const orderedHours = [1, 2, 3, 4, 5, 6, 0]
    .map(w => clinic.hours.find(h => h.weekday === w))
    .filter(Boolean);

  const heroMedia = settings.hero_media_id ? await mediaRepo.findById(settings.hero_media_id) : null;
  const doctorMedia = doctor?.photo_media_id ? await mediaRepo.findById(doctor.photo_media_id) : null;
  const logo = settings.logo_media_id ? await mediaRepo.findById(settings.logo_media_id) : null;
  const favicon = settings.favicon_media_id ? await mediaRepo.findById(settings.favicon_media_id) : null;

  const metaTags = seo.meta(settings);
  if (heroMedia && !metaTags.ogImage) metaTags.ogImage = new URL(heroMedia.url, metaTags.canonical).toString();

  res.render('public/index', {
    settings,
    clinic: { ...clinic, today: { ...clinic.today, weekdayIndex: todayIdx } },
    services, doctor, gallery, faqs, reviews,
    orderedHours,
    galleryCategories: categoryKeys.map(k => ({ key: k, label: CATEGORY_LABELS[k] || k })),
    meta: metaTags,
    structuredData: await seo.structuredData(),
    faqSchema: seo.faqStructuredData(faqs),
    whatsappUrl: await whatsappLink(),
    logoUrl: logo?.url || '/img/logo-96.png',
    faviconUrl: favicon?.url || '/img/logo-64.png',
    heroImage: heroMedia,
    doctorPhoto: doctorMedia,
    initials: (settings.doctor_name || settings.name || '')
      .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'SD',
    shortAddress: [settings.address_line1, settings.area].filter(Boolean).join(', ') || clinic.address,
    addressHtml: [settings.name, settings.address_line1, settings.address_line2,
      [settings.area, settings.city].filter(Boolean).join(', '), settings.postal_code]
      .filter(Boolean).map(esc).join('<br>'),
    heroTitleHtml: esc(settings.hero_title || settings.name).replace(/\n/g, '<br>'),
    servicesJson: JSON.stringify(services.map(s => ({
      id: s.id, name: s.name, duration: s.duration_min,
      desc: s.short_desc, category: s.category_name, bookable: s.bookable === 1,
    }))).replace(/'/g, '&#39;'),
    starsHtml, formatReviewDate, jsonForScript,
  });
});

/* SEO endpoints, generated from live settings. */
router.get('/robots.txt', async (_req, res) => {
  res.type('text/plain').send(seo.robotsTxt(seo.canonicalUrl(await settingsRepo.get())));
});
router.get('/sitemap.xml', async (_req, res) => {
  res.type('application/xml').send(seo.sitemapXml(seo.canonicalUrl(await settingsRepo.get())));
});

router.get('/healthz', async (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

export default router;
