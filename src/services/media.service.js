/**
 * Media ingest.
 *
 * Every upload is validated by magic bytes (not the client's Content-Type),
 * re-encoded through sharp, and written under a content-hashed key. Re-encoding
 * is what strips EXIF — including GPS coordinates and device identifiers, which
 * matters for patient treatment photos (spec §14).
 */
import crypto from 'node:crypto';
import sharp from 'sharp';
import * as storage from './storage/index.js';
import * as mediaRepo from '../repositories/media.repo.js';
import { config } from '../config/env.js';
import { slugify } from '../utils/format.js';

export class MediaError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const ALLOWED_FOLDERS = ['clinic', 'doctor', 'services', 'treatment-results', 'branding'];

/** Magic-byte signatures. The client's declared MIME type is never trusted. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * Store an uploaded image plus a thumbnail variant.
 * @returns the original media row (with `thumb` attached).
 */
export async function ingestImage(file, { folder = 'clinic', alt = null, userId = null } = {}) {
  if (!file?.buffer?.length) throw new MediaError('NO_FILE', 'No file was uploaded.');
  if (file.buffer.length > config.storage.maxUploadBytes) {
    throw new MediaError('FILE_TOO_LARGE',
      `Images must be ${Math.round(config.storage.maxUploadBytes / 1048576)} MB or smaller.`, 413);
  }
  if (!ALLOWED_FOLDERS.includes(folder)) throw new MediaError('BAD_FOLDER', 'Unknown media folder.');

  const kind = sniff(file.buffer);
  if (!kind) throw new MediaError('BAD_TYPE', 'Only JPEG, PNG and WebP images are accepted.');

  let pipeline, meta;
  try {
    pipeline = sharp(file.buffer, { failOn: 'error' });
    meta = await pipeline.metadata();
  } catch {
    throw new MediaError('CORRUPT_IMAGE', 'That image could not be read. Please try another file.');
  }
  if (!meta.width || !meta.height) throw new MediaError('CORRUPT_IMAGE', 'That image could not be read.');
  if (meta.width * meta.height > 50_000_000) {
    throw new MediaError('IMAGE_TOO_LARGE', 'That image has too many pixels. Please resize it first.');
  }

  /* Re-encode: caps dimensions, normalises orientation, and drops all metadata
     (EXIF/GPS/IPTC) because sharp only keeps it when withMetadata() is called. */
  const display = await sharp(file.buffer)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const displayMeta = await sharp(display).metadata();

  const thumb = await sharp(file.buffer)
    .rotate()
    .resize({ width: 480, height: 480, fit: 'cover', position: 'attention' })
    .webp({ quality: 74 })
    .toBuffer();

  const checksum = crypto.createHash('sha256').update(display).digest('hex');
  const base = `${folder}/${checksum.slice(0, 20)}`;
  const originalName = slugify(String(file.originalname || 'image').replace(/\.[^.]+$/, '')).slice(0, 60);

  let stored, storedThumb;
  try {
    stored = await storage.put(`${base}.webp`, display, 'image/webp');
    storedThumb = await storage.put(`${base}-thumb.webp`, thumb, 'image/webp');
  } catch (err) {
    if (err.code === 'STORAGE_NOT_CONFIGURED' || err.code === 'STORAGE_PRIVATE') {
      throw new MediaError(err.code, err.message, 503);
    }
    throw err;
  }

  const row = await mediaRepo.create({
    storage: storage.driverName(),
    key: stored.key, url: stored.url, folder,
    mime: 'image/webp', ext: 'webp', bytes: display.length,
    width: displayMeta.width, height: displayMeta.height,
    checksum, original_name: originalName, alt, uploaded_by: userId,
  });

  const thumbRow = await mediaRepo.create({
    storage: storage.driverName(),
    key: storedThumb.key, url: storedThumb.url, folder,
    mime: 'image/webp', ext: 'webp', bytes: thumb.length,
    width: 480, height: 480, checksum, original_name: originalName,
    variant_of: row.id, variant_kind: 'thumb', uploaded_by: userId,
  });

  return { ...row, thumb: thumbRow };
}

/** Remove the stored bytes of a media row and its variants, then soft-delete. */
export async function deleteMedia(id) {
  const row = await mediaRepo.findById(id);
  if (!row) return false;
  for (const m of [row, ...mediaRepo.variants(id)]) {
    try { await storage.remove(m.key); }
    catch (err) { console.error('[media] failed to remove stored file', m.key, err.message); }
  }
  await mediaRepo.softDelete(id);
  return true;
}

export const maxUploadMb = async () => Math.round(config.storage.maxUploadBytes / 1048576);
