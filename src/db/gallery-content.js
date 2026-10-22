/**
 * Clinic-supplied gallery photographs, added on boot.
 *
 * For photos the owner sent outside the admin. Each one goes through the same
 * pipeline as an admin upload (mediaService.ingestImage: magic-byte check,
 * re-encode, EXIF/GPS stripped, display + thumbnail stored), then becomes a
 * gallery item. "Before & after" (category 'treatment') photos carry the
 * consent record the database requires before they can be published.
 *
 * Idempotent and respectful of the admin: an entry whose title already
 * exists — even on an item the clinic has since deleted — is never added
 * again, so removing a photo in the admin removes it for good.
 *
 * The source files in content/gallery/ were re-encoded before being
 * committed, so the repository holds no camera metadata either.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, all, run, tx } from './index.js';
import * as galleryRepo from '../repositories/gallery.repo.js';
import * as mediaService from '../services/media.service.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content/gallery');

export const GALLERY_PHOTOS = [
  {
    file: 'before-after-front-teeth.jpg',
    title: 'Before & after — front teeth restoration',
    alt: 'Before and after: a patient\'s upper front teeth, with gaps before treatment and replacement teeth in place after',
    category: 'treatment',
    consent: 'Patient consent to website publication confirmed by the clinic owner on 22 Oct 2026 (relayed via the website team).',
  },
  {
    file: 'tooth-extraction-fragments.jpg',
    title: 'Tooth extraction — the removed fragments',
    alt: 'Fragments of an extracted tooth held on a gloved hand after an extraction',
    category: 'treatment',
    consent: 'Patient consent to website publication confirmed by the clinic owner on 22 Oct 2026 (relayed via the website team).',
  },
];

/* Two serverless instances can boot at once, and the seed runs outside the
   migration lock: both used to see "not added yet" and both added the photo.
   Each photo is now handled inside a transaction holding this advisory lock,
   so a second instance waits, then finds the first one's row. */
const LOCK_KEY = 7042226;

export async function applyGalleryContent({ log = console.log, list = GALLERY_PHOTOS, dir = DIR } = {}) {
  let added = 0;
  for (const p of list) {
    if (p.category === 'treatment' && !p.consent) {
      log(`[gallery] skipped "${p.title}": a before & after photo needs a consent record`);
      continue;
    }
    try {
      const didAdd = await tx(async () => {
        await run('SELECT pg_advisory_xact_lock(?)', LOCK_KEY);
        await removeDuplicates(p.title, log);
        // Any row with this title, deleted or not, means it was added before.
        if (await one('SELECT id FROM gallery_items WHERE title = ?', p.title)) return false;
        const buffer = fs.readFileSync(path.join(dir, p.file));
        const media = await mediaService.ingestImage(
          { buffer, originalname: p.file, mimetype: 'image/jpeg', size: buffer.length },
          { folder: p.category === 'treatment' ? 'treatment-results' : 'clinic', alt: p.alt });
        await galleryRepo.create({
          media_id: media.id, title: p.title, category: p.category,
          is_published: true,
          consent_confirmed: Boolean(p.consent), consent_note: p.consent || null,
        });
        return true;
      });
      if (didAdd) added++;
    } catch (err) {
      /* Storage can be unconfigured (local dev without uploads) — never let
         a photo stop the site booting. */
      log(`[gallery] could not add "${p.title}": ${err.message}`);
    }
  }
  if (added) log(`[gallery] ${added} clinic photo(s) added`);
  return { added };
}

/**
 * Tidy up copies left by the race above: keep the oldest live item for a
 * title, hide the rest. Their media rows are marked deleted in the database
 * only — the stored files are content-addressed and shared with the kept
 * copy, so removing them from storage would break the photo that stays.
 */
async function removeDuplicates(title, log) {
  const rows = await all(
    'SELECT id, media_id FROM gallery_items WHERE title = ? AND deleted_at IS NULL ORDER BY id', title);
  for (const extra of rows.slice(1)) {
    await run('UPDATE gallery_items SET deleted_at = NOW(), is_published = 0, updated_at = NOW() WHERE id = ?', extra.id);
    const stillUsed = await one(
      'SELECT 1 AS used FROM gallery_items WHERE media_id = ? AND deleted_at IS NULL', extra.media_id);
    if (!stillUsed) {
      await run('UPDATE media SET deleted_at = NOW() WHERE (id = ? OR variant_of = ?) AND deleted_at IS NULL', extra.media_id, extra.media_id);
    }
    log(`[gallery] removed duplicate of "${title}" (item ${extra.id})`);
  }
}
