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

  const address = {
    '@type': 'PostalAddress',
    streetAddress: [s.address_line1, s.address_line2].filter(Boolean).join(', ') || undefined,
    addressLocality: s.area || s.city || undefined,
    addressRegion: s.state || undefined,
    postalCode: s.postal_code || undefined,
    addressCountry: s.country || 'IN',
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
        itemOffered: { '@type': 'MedicalProcedure', name: sv.name, description: sv.short_desc || undefined },
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

export function sitemapXml(canonical) {
  const url = canonical;
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${url}/book</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>
</urlset>`;
}
