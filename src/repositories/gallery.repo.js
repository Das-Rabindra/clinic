import { one, all, run, buildUpdate } from './base.js';
import { CONSENT_REQUIRED_CATEGORIES } from '../config/constants.js';

const FIELDS = ['title', 'description', 'category', 'taken_on', 'display_order',
  'is_published', 'after_media_id', 'consent_note'];

const BASE = `SELECT g.*, m.url AS image_url, m.alt AS image_alt, m.width, m.height,
    t.url AS thumb_url, am.url AS after_url, at.url AS after_thumb_url
  FROM gallery_items g
  JOIN media m ON m.id = g.media_id
  LEFT JOIN media t ON t.variant_of = m.id AND t.variant_kind = 'thumb'
  LEFT JOIN media am ON am.id = g.after_media_id
  LEFT JOIN media at ON at.variant_of = am.id AND at.variant_kind = 'thumb'`;

export const findById = async (id) => await one(`${BASE} WHERE g.id = ? AND g.deleted_at IS NULL`, id);

/** Public listing: published only, never exposes consent metadata. */
export const listPublic = async (category) =>
  await all(`${BASE} WHERE g.deleted_at IS NULL AND g.is_published = 1
       AND (?::text IS NULL OR g.category = ?)
       ORDER BY g.display_order, g.id DESC`, category ?? null, category ?? null);

export const listAdmin = async ({ category, published } = {}) =>
  await all(`${BASE} WHERE g.deleted_at IS NULL
       AND (?::text IS NULL OR g.category = ?)
       AND (?::int IS NULL OR g.is_published = ?)
       ORDER BY g.display_order, g.id DESC`,
    category ?? null, category ?? null,
    published ?? null, published ?? null);

export async function create(g) {
  const order = g.display_order ??
    (await one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM gallery_items')).n;
  const info = await run(
    `INSERT INTO gallery_items (media_id, after_media_id, title, description, category,
       taken_on, display_order, is_published, consent_confirmed, consent_note, consent_by, consent_at)
     VALUES (@media_id, @after_media_id, @title, @description, @category,
       @taken_on, @display_order, @is_published, @consent_confirmed, @consent_note, @consent_by, @consent_at)`,
    {
      media_id: g.media_id, after_media_id: g.after_media_id ?? null,
      title: g.title, description: g.description ?? null,
      category: g.category || 'clinic', taken_on: g.taken_on ?? null,
      display_order: order,
      is_published: g.is_published ? 1 : 0,
      consent_confirmed: g.consent_confirmed ? 1 : 0,
      consent_note: g.consent_note ?? null,
      consent_by: g.consent_confirmed ? (g.consent_by ?? null) : null,
      consent_at: g.consent_confirmed ? new Date().toISOString() : null,
    }
  );
  return await findById(info.lastInsertRowid);
}

export const update = async (id, fields) => await buildUpdate('gallery_items', id, fields, FIELDS);

/** Records who confirmed consent and when - the audit trail for patient photos. */
export const setConsent = async (id, confirmed, userId, note) =>
  (await run(`UPDATE gallery_items SET consent_confirmed = ?, consent_by = ?, consent_at = ?,
       consent_note = COALESCE(?, consent_note), updated_at = NOW() WHERE id = ?`,
    confirmed ? 1 : 0, confirmed ? userId : null,
    confirmed ? new Date().toISOString() : null, note ?? null, id)).changes;

/**
 * Publish gate. Mirrors the CHECK constraint in the schema so callers get a
 * clear error rather than a raw SQLite constraint failure.
 */
export async function setPublished(id, published) {
  const item = await findById(id);
  if (!item) return { ok: false, error: 'NOT_FOUND' };
  if (published && CONSENT_REQUIRED_CATEGORIES.includes(item.category) && !item.consent_confirmed) {
    return { ok: false, error: 'CONSENT_REQUIRED' };
  }
  await run(`UPDATE gallery_items SET is_published = ?, updated_at = NOW() WHERE id = ?`,
    published ? 1 : 0, id);
  return { ok: true };
}

export const softDelete = async (id) =>
  (await run(`UPDATE gallery_items SET deleted_at = NOW(), is_published = 0 WHERE id = ?`, id)).changes;

export async function reorder(ids) {
  for (const [i, id] of ids.entries()) {
    await run(`UPDATE gallery_items SET display_order = ?, updated_at = NOW() WHERE id = ?`, i, id);
  }
}

export const categoriesInUse = async () =>
  await all(`SELECT category, COUNT(*) AS c FROM gallery_items
       WHERE deleted_at IS NULL AND is_published = 1 GROUP BY category`);
