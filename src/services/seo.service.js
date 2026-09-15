/**
 * Structured data + meta, generated from admin-controlled settings.
 * Rules: nothing fabricated. AggregateRating is emitted only when real synced
 * reviews exist, and opening hours only for days actually marked open.
 */
import * as settingsRepo from '../repositories/settings.repo.js';
import * as reviewsRepo from '../repositories/reviews.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import { config } from '../config/env.js';
import { minToHHMM } from '../utils/time.js';

const COUNTRY_CODES = { india: 'IN', in: 'IN' };

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

/** Opening hours in schema.org form, from the admin-managed weekly grid. */
async function openingHours() {
  return (await settingsRepo.getHours())
    .filter(h => h.is_open)
    .map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${DAY_NAMES[h.weekday]}`,
      opens: minToHHMM(h.open_min),
      closes: minToHHMM(h.close_min),
    }));
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
    '@id': `${url}#clinic`,
    name: s.name,
    url,
    description: s.description || undefined,
    telephone: s.phone_intl || undefined,
    email: s.email || undefined,
    image: s.og_image_url || undefined,
    address,
    medicalSpecialty: 'Dentistry',
    priceRange: undefined,
  };

  if (s.latitude && s.longitude) {
    node.geo = { '@type': 'GeoCoordinates', latitude: s.latitude, longitude: s.longitude };
  }
  if (s.maps_url) node.hasMap = s.maps_url;

  /* sameAs is how Google ties the website to the clinic's own profiles.
     Only links the clinic has actually supplied are emitted. */
  const sameAs = [s.instagram_url, s.facebook_url, s.youtube_url].filter(Boolean);
  if (sameAs.length) node.sameAs = sameAs;

  const hours = await openingHours();
  if (hours.length) node.openingHoursSpecification = hours;

  if (doctor) {
    node.employee = {
      '@type': 'Physician',
      name: doctor.name,
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
  const today = new Date().toISOString().slice(0, 10);
  const lastmod = (v) => (v ? String(v).slice(0, 10) : today);

  const entries = [
    { loc: `${canonical}/`, lastmod: today, changefreq: 'weekly', priority: '1.0' },
    { loc: `${canonical}/services`, lastmod: today, changefreq: 'monthly', priority: '0.8' },
  ];
  for (const sv of await servicesRepo.publicSlugs()) {
    entries.push({
      loc: `${canonical}/services/${sv.slug}`,
      lastmod: lastmod(sv.updated_at), changefreq: 'monthly', priority: '0.7',
    });
  }
  entries.push({ loc: `${canonical}/privacy`, lastmod: today, changefreq: 'yearly', priority: '0.2' });

  const body = entries.map(e =>
    `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod>` +
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
    provider: { '@id': `${url}#clinic` },
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
