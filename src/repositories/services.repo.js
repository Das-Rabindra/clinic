import { one, all, run, buildUpdate } from './base.js';
import { slugify } from '../utils/format.js';

const FIELDS = ['name','category_id','short_desc','long_desc','icon','image_media_id',
  'duration_min','price_from','currency','show_price','bookable','is_active','display_order'];

const BASE = `SELECT s.*, c.name AS category_name, m.url AS image_url
  FROM services s
  LEFT JOIN service_categories c ON c.id = s.category_id
  LEFT JOIN media m ON m.id = s.image_media_id`;

export const list = ({ activeOnly = false, bookableOnly = false } = {}) =>
  all(`${BASE} WHERE s.deleted_at IS NULL
       ${activeOnly ? 'AND s.is_active = 1' : ''}
       ${bookableOnly ? 'AND s.bookable = 1' : ''}
       ORDER BY s.display_order, s.id`);

export const findById = (id) => one(`${BASE} WHERE s.id = ? AND s.deleted_at IS NULL`, id);
export const findBookable = (id) =>
  one(`${BASE} WHERE s.id = ? AND s.deleted_at IS NULL AND s.is_active = 1 AND s.bookable = 1`, id);

export function create(s) {
  let slug = slugify(s.name), n = 1;
  while (one('SELECT id FROM services WHERE slug = ?', slug)) slug = `${slugify(s.name)}-${++n}`;
  const order = s.display_order ?? (one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM services').n);
  const info = run(
    `INSERT INTO services (name, slug, category_id, short_desc, long_desc, icon, image_media_id,
       duration_min, price_from, currency, show_price, bookable, is_active, display_order)
     VALUES (@name, @slug, @category_id, @short_desc, @long_desc, @icon, @image_media_id,
       @duration_min, @price_from, @currency, @show_price, @bookable, @is_active, @display_order)`,
    {
      name: s.name, slug, category_id: s.category_id ?? null,
      short_desc: s.short_desc ?? null, long_desc: s.long_desc ?? null,
      icon: s.icon ?? null, image_media_id: s.image_media_id ?? null,
      duration_min: s.duration_min ?? 30, price_from: s.price_from ?? null,
      currency: s.currency ?? 'INR', show_price: s.show_price ? 1 : 0,
      bookable: s.bookable === false ? 0 : 1, is_active: s.is_active === false ? 0 : 1,
      display_order: order,
    }
  );
  return findById(info.lastInsertRowid);
}

export const update = (id, fields) => buildUpdate('services', id, fields, FIELDS);
export const softDelete = (id) =>
  run(`UPDATE services SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?`, id).changes;

/** Persist an explicit ordering from the admin drag-and-drop list. */
export function reorder(ids) {
  const stmt = `UPDATE services SET display_order = ?, updated_at = datetime('now') WHERE id = ?`;
  ids.forEach((id, i) => run(stmt, i, id));
}

export const categories = () => all('SELECT * FROM service_categories ORDER BY display_order, name');
export function ensureCategory(name) {
  const slug = slugify(name);
  const found = one('SELECT * FROM service_categories WHERE slug = ?', slug);
  if (found) return found;
  const info = run('INSERT INTO service_categories (name, slug) VALUES (?, ?)', name, slug);
  return one('SELECT * FROM service_categories WHERE id = ?', info.lastInsertRowid);
}
