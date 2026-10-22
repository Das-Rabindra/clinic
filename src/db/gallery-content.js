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
import { one } from './index.js';
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

export async function applyGalleryContent({ log = console.log, list = GALLERY_PHOTOS, dir = DIR } = {}) {
  let added = 0;
  for (const p of list) {
    // Any row with this title, deleted or not, means it was added before.
    if (await one('SELECT id FROM gallery_items WHERE title = ?', p.title)) continue;
    if (p.category === 'treatment' && !p.consent) {
      log(`[gallery] skipped "${p.title}": a before & after photo needs a consent record`);
      continue;
    }
    try {
      const buffer = fs.readFileSync(path.join(dir, p.file));
      const media = await mediaService.ingestImage(
        { buffer, originalname: p.file, mimetype: 'image/jpeg', size: buffer.length },
        { folder: p.category === 'treatment' ? 'treatment-results' : 'clinic', alt: p.alt });
      await galleryRepo.create({
        media_id: media.id, title: p.title, category: p.category,
        is_published: true,
        consent_confirmed: Boolean(p.consent), consent_note: p.consent || null,
      });
      added++;
    } catch (err) {
      /* Storage can be unconfigured (local dev without uploads) — never let
         a photo stop the site booting. */
      log(`[gallery] could not add "${p.title}": ${err.message}`);
    }
  }
  if (added) log(`[gallery] ${added} clinic photo(s) added`);
  return { added };
}
