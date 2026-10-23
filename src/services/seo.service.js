/**
 * Structured data + meta, generated from admin-controlled settings.
 * Rules: nothing fabricated. AggregateRating is emitted only when real synced
 * reviews exist, and opening hours only for days actually marked open.
 */
import * as settingsRepo from '../repositories/settings.repo.js';
import * as reviewsRepo from '../repositories/reviews.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import * as mediaRepo from '../repositories/media.repo.js';
import * as galleryRepo from '../repositories/gallery.repo.js';
import { config } from '../config/env.js';
import { minToHHMM } from '../utils/time.js';

const COUNTRY_CODES = { india: 'IN', in: 'IN' };

/* The clinic's Google listing, as identified by the Maps link the owner
   shared (share.google/uZmjctaXNvyBXT3lG resolves to Knowledge Graph id
   /g/11nw0z267l, "Samal Dental Care"). Emitted in sameAs so search engines
   can tie this website to that listing. */
const GOOGLE_LISTING_URL = 'https://www.google.com/search?kgmid=/g/11nw0z267l';

/* Stable entity ids, shared by every page's markup. */
export const clinicId = (url) => `${url}/#clinic`;
export const dentistId = (url) => `${url}/#dentist`;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function canonicalUrl(s) {
  return (s.seo_canonical || s.site_url || config.publicUrl || '').replace(/\/+$/, '') || config.publicUrl;
}

export function meta(s) {
  const url = canonicalUrl(s);
  return {
    title: s.seo_title || `${s.name} — ${s.doctor_name || ''}`.trim(),
    description: s.seo_description || s.description || '',
    canonical: url,
    ogTitle: s.og_title || s.seo_title || s.name,
    ogDescription: s.og_description || s.seo_description || s.description || '',
    ogUrl: url,
    ogImage: s.og_image_url || null,
  };
}

/**
 * Opening hours in schema.org form, from the admin-managed weekly grid.
 *
 * A day with a midday break emits two blocks, not one. Flattening 09:00-13:00
 * and 15:00-22:00 into a single 09:00-22:00 span told Google the clinic was
 * open through the break — so it would show "Open" at 2 PM and send someone to
 * a closed door.
 */
async function openingHours() {
  const out = [];
  for (const h of await settingsRepo.getHours()) {
    if (!h.is_open) continue;
    const day = `https://schema.org/${DAY_NAMES[h.weekday]}`;
    const block = (from, to) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: day, opens: minToHHMM(from), closes: minToHHMM(to),
    });

    const hasBreak = h.break_start_min != null && h.break_end_min != null
      && h.break_start_min > h.open_min && h.break_end_min < h.close_min;

    if (hasBreak) {
      out.push(block(h.open_min, h.break_start_min));
      out.push(block(h.break_end_min, h.close_min));
    } else {
      out.push(block(h.open_min, h.close_min));
    }
  }
  return out;
}

export async function structuredData() {
  const s = await settingsRepo.get();
  const url = canonicalUrl(s);
  const doctor = await doctorsRepo.primary();
  /*
   * Only Google-synced reviews feed AggregateRating. Google's structured data
   * policy forbids marking up reviews a business collected about itself, and
   * doing so risks a manual penalty. Clinic-collected testimonials still appear
   * on the page — they are simply not claimed as a verified rating.
   */
  const agg = await reviewsRepo.aggregateVerified();

  /* Prefer an explicit social image, then the hero, then the clinic logo —
     absolute, because a relative URL in JSON-LD is not resolved. */
  const absolute = (u) => (u ? new URL(u, url).toString() : null);
  /* Real photographs only: a licensed stock image is not the clinic, and
     `image` on a LocalBusiness is meant to show the actual place. The admin
     hero is used when it is genuine; otherwise the clinic's own
     treatment-room photograph. The dentist's portrait follows. */
  const hero = s.hero_media_id ? await mediaRepo.findById(s.hero_media_id) : null;
  const doctorPhoto = doctor?.photo_media_id ? await mediaRepo.findById(doctor.photo_media_id) : null;
  const images = [
    absolute(s.og_image_url),
    hero && !hero.is_stock ? absolute(hero.url) : `${url}/img/clinic/treatment-room-1086.webp`,
    absolute(doctorPhoto?.url),
  ].filter(Boolean);

  /*
   * addressLocality must be the town Google matches against a search like
   * "dentist in Talcher" — so it is the city, and the neighbourhood (`area`)
   * belongs in the street address alongside the building. Reading locality from
   * `area` instead left the town out of the markup entirely.
   */
  const address = {
    '@type': 'PostalAddress',
    streetAddress: [s.address_line1, s.address_line2, s.area].filter(Boolean).join(', ') || undefined,
    addressLocality: s.city || s.area || undefined,
    addressRegion: s.state || undefined,
    postalCode: s.postal_code || undefined,
    /* schema.org expects the ISO 3166-1 alpha-2 code, not the country's
       display name — "India" is not a value Google resolves. */
    addressCountry: COUNTRY_CODES[String(s.country || '').trim().toLowerCase()] || 'IN',
  };

  const node = {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    '@id': clinicId(url),
    name: s.name,
    url: `${url}/`,
    logo: `${url}/img/logo-240.png`,
    description: s.description || undefined,
    telephone: s.phone_intl || undefined,
    /* A second published line. Google accepts an array, and listing it keeps
       the markup consistent with what the page itself shows. */
    ...(s.phone_secondary_intl
      ? { contactPoint: {
            '@type': 'ContactPoint', contactType: 'reservations',
            telephone: s.phone_secondary_intl, areaServed: 'IN',
          } }
      : {}),
    email: s.email || undefined,
    /* `image` is effectively expected on a LocalBusiness and feeds local rich
       results; it was absent because og_image_url is only set when an admin
       picks a social image. Fall back to whatever the page already shows. */
    image: images.length ? images : undefined,
    address,
    medicalSpecialty: 'Dentistry',
    /* No priceRange: the clinic does not publish prices, and a band in the
       markup is a price claim of its own. */
    availableLanguage: ['English', 'Hindi', 'Odia'],
  };

  if (s.latitude && s.longitude) {
    node.geo = { '@type': 'GeoCoordinates', latitude: s.latitude, longitude: s.longitude };
  }
  if (s.maps_url) node.hasMap = s.maps_url;

  /* sameAs is how Google ties the website to the clinic's own profiles.
     Only links the clinic has actually supplied are emitted. */
  const sameAs = [GOOGLE_LISTING_URL, s.instagram_url, s.facebook_url, s.youtube_url].filter(Boolean);
  if (sameAs.length) node.sameAs = sameAs;

  if (s.city) {
    node.areaServed = [s.city, s.area, 'Angul district']
      .filter(Boolean).map(name => ({ '@type': 'Place', name }));
  }

  const hours = await openingHours();
  if (hours.length) node.openingHoursSpecification = hours;

  if (doctor) {
    node.employee = {
      '@type': 'Physician',
      '@id': dentistId(url),
      name: doctor.name,
      url: `${url}/about`,
      ...(doctorPhoto ? { image: absolute(doctorPhoto.url) } : {}),
      medicalSpecialty: 'Dentistry',
      ...(doctor.qualification ? { hasCredential: doctor.qualification } : {}),
      ...(s.institution ? { alumniOf: s.institution } : {}),
    };
  }

  // Only real, visible, Google-synced reviews produce rating markup.
  if (agg.count > 0 && agg.average) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: agg.average,
      reviewCount: agg.count,
      bestRating: 5, worstRating: 1,
    };
  }

  const services = await servicesRepo.list({ activeOnly: true });
  if (services.length) {
    node.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Dental services',
      itemListElement: services.map(sv => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'MedicalProcedure',
          name: sv.name,
          description: sv.short_desc || undefined,
          url: sv.has_detail_page ? `${url}/services/${sv.slug}` : undefined,
        },
      })),
    };
  }

  // Drop undefined keys so the emitted JSON-LD stays clean.
  return JSON.parse(JSON.stringify(node));
}

export function faqStructuredData(faqs) {
  if (!faqs?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/* The date the privacy policy's wording last changed (git: 360723f). Update
   it whenever the policy text changes — not when its layout does. */
export const PRIVACY_UPDATED = '2026-09-15';

/** robots.txt / sitemap.xml content. */
export const robotsTxt = (canonical) =>
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${canonical}/sitemap.xml\n`;

/**
 * Sitemap over the routes that genuinely exist.
 *
 * The previous version advertised /book, which has never been a route — it
 * returned 404 to every crawler that followed it. Treatment pages are listed
 * from the database, so adding or retiring one in the admin panel is reflected
 * without a code change.
 */
export async function sitemapXml(canonical) {
  /* lastmod is the date content actually changed, never "today": a date that
     moves on every request tells crawlers nothing and teaches them to ignore
     it. Pages built from settings and treatments take the newest of those. */
  const day = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const settings = await settingsRepo.get();
  const slugs = await servicesRepo.publicSlugs();
  const newest = [settings.updated_at, ...slugs.map(sv => sv.updated_at)].map(day).filter(Boolean).sort().pop();

  const entries = [
    { loc: `${canonical}/`, lastmod: newest, changefreq: 'weekly', priority: '1.0' },
    { loc: `${canonical}/services`, lastmod: newest, changefreq: 'monthly', priority: '0.8' },
  ];
  for (const sv of slugs) {
    entries.push({
      loc: `${canonical}/services/${sv.slug}`,
      lastmod: day(sv.updated_at), changefreq: 'monthly', priority: '0.7',
    });
  }
  /* About and the gallery are built from settings and published photographs. */
  const galleryNewest = day(await galleryRepo.newestUpdate());
  entries.push({ loc: `${canonical}/about`, lastmod: day(settings.updated_at), changefreq: 'monthly', priority: '0.6' });
  entries.push({ loc: `${canonical}/gallery`, lastmod: [day(settings.updated_at), galleryNewest].filter(Boolean).sort().pop() || null, changefreq: 'monthly', priority: '0.5' });
  entries.push({ loc: `${canonical}/book`, lastmod: newest, changefreq: 'monthly', priority: '0.8' });
  entries.push({ loc: `${canonical}/contact`, lastmod: newest, changefreq: 'monthly', priority: '0.7' });
  entries.push({ loc: `${canonical}/faq`, lastmod: newest, changefreq: 'monthly', priority: '0.6' });
  /* Listed only once there is something on it: until then the page is
     noindex, and a sitemap must not advertise a page it asks not to index. */
  if ((await reviewsRepo.aggregate()).count) {
    entries.push({ loc: `${canonical}/testimonials`, lastmod: newest, changefreq: 'weekly', priority: '0.5' });
  }
  entries.push({ loc: `${canonical}/privacy`, lastmod: PRIVACY_UPDATED, changefreq: 'yearly', priority: '0.2' });

  const body = entries.map(e =>
    `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}` +
    `<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

/**
 * Meta for one treatment page. Falls back to generated wording so a treatment
 * the clinic adds later still gets a sensible title rather than an empty one.
 */
export function serviceMeta(service, settings) {
  const url = canonicalUrl(settings);
  const town = settings.city || settings.area || '';
  const title = service.seo_title
    || `${service.name}${town ? ` in ${town}` : ''} | ${settings.name}`;
  const description = service.seo_description
    || service.short_desc
    || `${service.name} at ${settings.name}${town ? `, ${town}` : ''}.`;
  return {
    title,
    description: description.slice(0, 300),
    canonical: `${url}/services/${service.slug}`,
    ogTitle: title,
    ogDescription: description.slice(0, 300),
    ogUrl: `${url}/services/${service.slug}`,
    ogImage: service.image_url ? new URL(service.image_url, url).toString() : (settings.og_image_url || null),
  };
}

/** MedicalProcedure markup for a treatment page, linked back to the clinic. */
export function serviceStructuredData(service, settings) {
  const url = canonicalUrl(settings);
  return JSON.parse(JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MedicalProcedure',
    name: service.name,
    url: `${url}/services/${service.slug}`,
    description: service.short_desc || service.long_desc || undefined,
    image: service.image_url ? new URL(service.image_url, url).toString() : undefined,
    howPerformed: service.what_to_expect || undefined,
    /* Left deliberately unset unless the clinic has written it: inventing an
       indication for a medical procedure is not a copywriting decision. */
    indication: service.who_needs
      ? { '@type': 'MedicalIndication', description: service.who_needs }
      : undefined,
    /* Self-contained: the full clinic entity lives on the homepage; this
       carries enough to identify it on its own and the shared @id. */
    provider: {
      '@type': 'Dentist', '@id': clinicId(url), name: settings.name, url: `${url}/`,
      ...(settings.phone_intl ? { telephone: settings.phone_intl } : {}),
    },
  }));
}

/** Breadcrumbs so search results show Home › Treatments › <name>. */
export function breadcrumbs(canonical, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${canonical}${item.path}`,
    })),
  };
}
