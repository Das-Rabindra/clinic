import { one, all, run, buildUpdate } from './base.js';
import { slugify } from '../utils/format.js';

const FIELDS = ['name','category_id','short_desc','long_desc','icon','image_media_id',
  'duration_min','price_from','currency','show_price','bookable','is_active','display_order',
  'who_needs','what_to_expect','benefits','seo_title','seo_description','is_featured','has_detail_page'];

/* thumb_url is the square 480px variant the media pipeline actually produces.
   It suits the admin list; the public card uses image_url, because a square
   crop would cut the sides off a 16:9 card. */
const BASE = `SELECT s.*, c.name AS category_name,
    m.url AS image_url, m.alt AS image_alt, m.width AS image_width, m.height AS image_height,
    t.url AS thumb_url
  FROM services s
  LEFT JOIN service_categories c ON c.id = s.category_id
  LEFT JOIN media m ON m.id = s.image_media_id
  LEFT JOIN media t ON t.variant_of = m.id AND t.variant_kind = 'thumb' AND t.deleted_at IS NULL`;

export const list = async ({ activeOnly = false, bookableOnly = false, featuredFirst = false } = {}) =>
  await all(`${BASE} WHERE s.deleted_at IS NULL
       ${activeOnly ? 'AND s.is_active = 1' : ''}
       ${bookableOnly ? 'AND s.bookable = 1' : ''}
       ORDER BY ${featuredFirst ? 's.is_featured DESC, ' : ''}s.display_order, s.id`);

/** A published treatment page. Inactive services 404 rather than render. */
export const findPublicBySlug = async (slug) =>
  await one(`${BASE} WHERE s.slug = ? AND s.deleted_at IS NULL
       AND s.is_active = 1 AND s.has_detail_page = 1`, slug);

/** Slugs for the sitemap. */
export const publicSlugs = async () =>
  await all(`SELECT slug, updated_at FROM services
       WHERE deleted_at IS NULL AND is_active = 1 AND has_detail_page = 1
       ORDER BY display_order, id`);

export const findById = async (id) => await one(`${BASE} WHERE s.id = ? AND s.deleted_at IS NULL`, id);
export const findBookable = async (id) =>
  await one(`${BASE} WHERE s.id = ? AND s.deleted_at IS NULL AND s.is_active = 1 AND s.bookable = 1`, id);

export async function create(s) {
  let slug = slugify(s.name), n = 1;
  while (await one('SELECT id FROM services WHERE slug = ?', slug)) slug = `${slugify(s.name)}-${++n}`;
  const order = s.display_order ?? ((await one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM services')).n);
  const info = await run(
    `INSERT INTO services (name, slug, category_id, short_desc, long_desc, icon, image_media_id,
       duration_min, price_from, currency, show_price, bookable, is_active, display_order,
       who_needs, what_to_expect, benefits, seo_title, seo_description, is_featured, has_detail_page)
     VALUES (@name, @slug, @category_id, @short_desc, @long_desc, @icon, @image_media_id,
       @duration_min, @price_from, @currency, @show_price, @bookable, @is_active, @display_order,
       @who_needs, @what_to_expect, @benefits, @seo_title, @seo_description, @is_featured,
       @has_detail_page)`,
    {
      name: s.name, slug, category_id: s.category_id ?? null,
      short_desc: s.short_desc ?? null, long_desc: s.long_desc ?? null,
      icon: s.icon ?? null, image_media_id: s.image_media_id ?? null,
      duration_min: s.duration_min ?? 30, price_from: s.price_from ?? null,
      currency: s.currency ?? 'INR', show_price: s.show_price ? 1 : 0,
      bookable: s.bookable === false ? 0 : 1, is_active: s.is_active === false ? 0 : 1,
      display_order: order,
      who_needs: s.who_needs ?? null, what_to_expect: s.what_to_expect ?? null,
      benefits: s.benefits ?? null,
      seo_title: s.seo_title ?? null, seo_description: s.seo_description ?? null,
      is_featured: s.is_featured ? 1 : 0,
      has_detail_page: s.has_detail_page === false ? 0 : 1,
    }
  );
  return await findById(info.lastInsertRowid);
}

export const update = async (id, fields) => await buildUpdate('services', id, fields, FIELDS);
export const softDelete = async (id) =>
  (await run(`UPDATE services SET deleted_at = NOW(), is_active = 0 WHERE id = ?`, id)).changes;

/** Persist an explicit ordering from the admin drag-and-drop list. */
export async function reorder(ids) {
  const stmt = `UPDATE services SET display_order = ?, updated_at = NOW() WHERE id = ?`;
  for (const [i, id] of ids.entries()) await run(stmt, i, id);
}

export const categories = async () => await all('SELECT * FROM service_categories ORDER BY display_order, name');
export async function ensureCategory(name) {
  const slug = slugify(name);
  const found = await one('SELECT * FROM service_categories WHERE slug = ?', slug);
  if (found) return found;
  const info = await run('INSERT INTO service_categories (name, slug) VALUES (?, ?)', name, slug);
  return await one('SELECT * FROM service_categories WHERE id = ?', info.lastInsertRowid);
}
