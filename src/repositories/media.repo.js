import { one, all, run } from './base.js';

export const findById = (id) => one('SELECT * FROM media WHERE id = ? AND deleted_at IS NULL', id);

export function create(m) {
  const info = run(
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
  return findById(info.lastInsertRowid);
}

export const list = ({ folder, limit = 100, offset = 0 } = {}) =>
  all(`SELECT * FROM media WHERE deleted_at IS NULL AND variant_of IS NULL
       AND (? IS NULL OR folder = ?) ORDER BY id DESC LIMIT ? OFFSET ?`,
    folder ?? null, folder ?? null, limit, offset);

export const variants = (id) => all('SELECT * FROM media WHERE variant_of = ?', id);
export const thumbFor = (id) =>
  one(`SELECT * FROM media WHERE variant_of = ? AND variant_kind = 'thumb'`, id);

export const setAlt = (id, alt) =>
  run(`UPDATE media SET alt = ?, updated_at = datetime('now') WHERE id = ?`, alt, id).changes;

/** Soft-delete the original and its derived variants together. */
export const softDelete = (id) =>
  run(`UPDATE media SET deleted_at = datetime('now') WHERE id = ? OR variant_of = ?`, id, id).changes;

export const recentCount = (days = 7) =>
  one(`SELECT COUNT(*) AS c FROM media WHERE deleted_at IS NULL AND variant_of IS NULL
       AND created_at >= datetime('now', ?)`, `-${days} days`).c;
