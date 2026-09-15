import { one, all, run } from './base.js';

export const findById = async (id) => await one('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL', id);

export async function create(m) {
  // A Promise here would be stored as "{}" and silently break every image that
  // references this row, so fail loudly at the boundary instead.
  if (typeof m.url !== 'string' || typeof m.key !== 'string') {
    throw new Error(`media.create expected string key/url, got ${typeof m.key}/${typeof m.url}`);
  }
  const info = await run(
    `INSERT INTO media (storage, key, url, folder, mime, ext, bytes, width, height,
       checksum, original_name, alt, variant_of, variant_kind, uploaded_by)
     VALUES (@storage, @key, @url, @folder, @mime, @ext, @bytes, @width, @height,
       @checksum, @original_name, @alt, @variant_of, @variant_kind, @uploaded_by)`,
    {
      storage: m.storage || 'local', key: m.key, url: m.url, folder: m.folder || 'clinic',
      mime: m.mime, ext: m.ext, bytes: m.bytes, width: m.width ?? null, height: m.height ?? null,
      checksum: m.checksum ?? null, original_name: m.original_name ?? null, alt: m.alt ?? null,
      variant_of: m.variant_of ?? null, variant_kind: m.variant_kind ?? null,
      uploaded_by: m.uploaded_by ?? null,
    }
  );
  return await findById(info.lastInsertRowid);
}

export const list = async ({ folder, limit = 100, offset = 0 } = {}) =>
  await all(`SELECT * FROM media WHERE deleted_at IS NULL AND variant_of IS NULL
       AND (?::text IS NULL OR folder = ?) ORDER BY id DESC LIMIT ? OFFSET ?`,
    folder ?? null, folder ?? null, limit, offset);

export const variants = async (id) => await all('SELECT * FROM media WHERE variant_of = ?', id);
export const thumbFor = async (id) =>
  await one(`SELECT * FROM media WHERE variant_of = ? AND variant_kind = 'thumb'`, id);

export const setAlt = async (id, alt) =>
  (await run(`UPDATE media SET alt = ?, updated_at = NOW() WHERE id = ?`, alt, id)).changes;

/** Soft-delete the original and its derived variants together. */
export const softDelete = async (id) =>
  (await run(`UPDATE media SET deleted_at = NOW() WHERE id = ? OR variant_of = ?`, id, id)).changes;

export const recentCount = async (days = 7) =>
  (await one(`SELECT COUNT(*) AS c FROM media WHERE deleted_at IS NULL AND variant_of IS NULL
       AND created_at >= NOW() + (?)::interval`, `-${days} days`)).c;
