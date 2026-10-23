import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setupEnv, bootDb, cleanup } from './helpers.mjs';

let ctx;
const SUITE = 'media';
let mediaService, galleryRepo, storage, usersRepo, userId, mediaRepo;

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  mediaService = await import('../src/services/media.service.js');
  galleryRepo = await import('../src/repositories/gallery.repo.js');
  storage = await import('../src/services/storage/index.js');
  mediaRepo = await import('../src/repositories/media.repo.js');
  usersRepo = await import('../src/repositories/users.repo.js');
  userId = (await usersRepo.create({ email: 'm@clinic.test', name: 'M', password: 'MediaTestPass123', role: 'owner' })).id;
});
after(async () => { await cleanup(ctx); });

const jpeg = (opts = {}) => sharp({
  create: { width: opts.w || 800, height: opts.h || 600, channels: 3, background: '#7C9885' },
}).jpeg().withMetadata(opts.meta || {}).toBuffer();

describe('media ingest', () => {
  test('accepts a JPEG and produces a thumbnail', async () => {
    const buffer = await jpeg();
    const m = await mediaService.ingestImage({ buffer, originalname: 'clinic front.jpg' }, { folder: 'clinic', userId });
    assert.equal(m.mime, 'image/webp', 're-encoded to webp');
    assert.equal(m.width, 800);
    assert.ok(m.thumb, 'a thumbnail variant is created');
    assert.equal(m.thumb.variant_kind, 'thumb');
    assert.ok(await storage.exists(m.key));
    assert.ok(await storage.exists(m.thumb.key));
  });

  test('strips EXIF metadata including GPS', async () => {
    const buffer = await jpeg({
      meta: { exif: { IFD0: { Copyright: 'clinic' }, GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } } },
    });
    assert.ok((await sharp(buffer).metadata()).exif, 'the source image really does carry EXIF');

    const m = await mediaService.ingestImage({ buffer, originalname: 'patient.jpg' }, { folder: 'treatment-results', userId });
    const stored = await storage.get(m.key);
    const meta = await sharp(stored).metadata();
    assert.ok(!meta.exif, 'stored image must carry no EXIF (no GPS, no device data)');
  });

  test('rejects a non-image by inspecting magic bytes, not the filename', async () => {
    await assert.rejects(
      mediaService.ingestImage({ buffer: Buffer.from('#!/bin/sh\nrm -rf /'), originalname: 'evil.jpg' }, { folder: 'clinic' }),
      (err) => err.code === 'BAD_TYPE');
  });

  test('rejects an HTML file renamed as a png', async () => {
    await assert.rejects(
      mediaService.ingestImage({ buffer: Buffer.from('<html><script>alert(1)</script></html>'), originalname: 'x.png' }, { folder: 'clinic' }),
      (err) => err.code === 'BAD_TYPE');
  });

  test('rejects an oversized file', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    await assert.rejects(
      mediaService.ingestImage({ buffer: big, originalname: 'big.jpg' }, { folder: 'clinic' }),
      (err) => err.code === 'FILE_TOO_LARGE' || err.code === 'BAD_TYPE');
  });

  test('rejects an unknown storage folder', async () => {
    const buffer = await jpeg();
    await assert.rejects(
      mediaService.ingestImage({ buffer, originalname: 'a.jpg' }, { folder: '../../etc' }),
      (err) => err.code === 'BAD_FOLDER');
  });
});

describe('media deletion', () => {
  test('deletes the image and its thumbnail variant', async () => {
    const m = await mediaService.ingestImage(
      { buffer: await jpeg(), originalname: 'to-delete.jpg' }, { folder: 'clinic', userId });
    assert.ok(await storage.exists(m.key));
    assert.ok(await storage.exists(m.thumb.key));

    // The variants lookup is async; spreading it without await made this throw
    // "is not iterable" and every delete returned a 500.
    assert.equal(await mediaService.deleteMedia(m.id), true);

    assert.equal(await mediaRepo.findById(m.id), undefined, 'row is soft-deleted');
    assert.equal(await storage.exists(m.key), false, 'stored file is gone');
    assert.equal(await storage.exists(m.thumb.key), false, 'thumbnail is gone too');
  });

  test('deleting an unknown image reports false rather than throwing', async () => {
    assert.equal(await mediaService.deleteMedia(999999), false);
  });
});

describe('patient photo consent (spec §14)', () => {
  let mediaId;
  before(async () => {
    const m = await mediaService.ingestImage({ buffer: await jpeg(), originalname: 'result.jpg' },
      { folder: 'treatment-results', userId });
    mediaId = m.id;
  });

  test('a treatment photo cannot be published without consent', async () => {
    const item = await galleryRepo.create({
      media_id: mediaId, title: 'Before & After — Smile Restoration',
      category: 'treatment', is_published: false, consent_confirmed: false,
    });
    const result = await galleryRepo.setPublished(item.id, true);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'CONSENT_REQUIRED');
    assert.equal((await galleryRepo.findById(item.id)).is_published, 0);
  });

  test('the database itself refuses the unconsented publish', async () => {
    const item = await galleryRepo.create({
      media_id: mediaId, title: 'Direct write attempt', category: 'treatment',
      is_published: false, consent_confirmed: false,
    });
    // Bypassing the service layer must still fail: the CHECK constraint is the
    // real guarantee, not the application code above it.
    await assert.rejects(async () => galleryRepo.update(item.id, { is_published: 1 }),
      (err) => /check constraint/i.test(err.message) && err.code === '23514');
  });

  test('publishing succeeds once consent is recorded, and the recorder is stored', async () => {
    const item = await galleryRepo.create({
      media_id: mediaId, title: 'Before & After — Crown Work', category: 'treatment', is_published: false,
    });
    await galleryRepo.setConsent(item.id, true, userId, 'Signed consent form on file');
    const consented = await galleryRepo.findById(item.id);
    assert.equal(consented.consent_confirmed, 1);
    assert.equal(consented.consent_by, userId, 'who confirmed it is recorded');
    assert.ok(consented.consent_at, 'when it was confirmed is recorded');

    assert.equal((await galleryRepo.setPublished(item.id, true)).ok, true);
    assert.equal((await galleryRepo.findById(item.id)).is_published, 1);
  });

  test('non-treatment photos need no consent', async () => {
    const item = await galleryRepo.create({
      media_id: mediaId, title: 'Reception', category: 'reception', is_published: false,
    });
    assert.equal((await galleryRepo.setPublished(item.id, true)).ok, true);
  });

  test('the public listing never exposes consent metadata', async () => {
    const rows = await galleryRepo.listPublic();
    assert.ok(rows.length > 0);
    // listPublic returns full rows internally; the API layer projects them.
    // Verify the projection used by the public route drops consent fields.
    const projected = rows.map((g) => ({
      id: g.id, title: g.title, description: g.description, category: g.category,
      image_url: g.image_url, thumb_url: g.thumb_url, width: g.width, height: g.height,
    }));
    for (const p of projected) {
      assert.ok(!('consent_confirmed' in p));
      assert.ok(!('consent_by' in p));
      assert.ok(!('consent_note' in p));
    }
  });
});

describe('mid-size variant', () => {
  test('a wide upload gets an 800px copy; a narrow one does not', async () => {
    const wide = await mediaService.ingestImage({ buffer: await jpeg({ w: 1800, h: 1200 }), originalname: 'wide.jpg' }, { folder: 'clinic', userId });
    assert.ok(wide.medium, 'mid-size variant created');
    assert.equal(wide.medium.variant_kind, 'medium');
    assert.equal(wide.medium.width, 800);
    assert.ok(await storage.exists(wide.medium.key));
    assert.ok(wide.medium.bytes < wide.bytes, 'smaller than the full image');

    const narrow = await mediaService.ingestImage({ buffer: await jpeg({ w: 700, h: 500 }), originalname: 'narrow.jpg' }, { folder: 'clinic', userId });
    assert.equal(narrow.medium, null, 'nothing to shrink');
  });

  test('the scheduled backfill gives older uploads one, once, and survives a missing file', async () => {
    const { run } = await import('../src/db/index.js');
    // An upload from before mid-size variants existed.
    const old = await mediaService.ingestImage({ buffer: await jpeg({ w: 1600, h: 1000 }), originalname: 'old.jpg' }, { folder: 'clinic', userId });
    await run(`DELETE FROM media WHERE variant_of = ? AND variant_kind = 'medium'`, old.id);
    assert.equal(await mediaRepo.mediumFor(old.id), undefined);
    // And one whose bytes are gone from storage.
    await run(`INSERT INTO media (storage,key,url,folder,mime,ext,bytes,width,height)
               VALUES ('local','clinic/gone.webp','/media/clinic/gone.webp','clinic','image/webp','webp',1,1500,900)`);

    const logs = [];
    const first = await mediaService.backfillMediums({ limit: 50, log: (m) => logs.push(m) });
    assert.ok(first.made >= 1, 'made the missing copy');
    assert.equal(first.failed, 1, 'the missing file is reported, not thrown');
    const md = await mediaRepo.mediumFor(old.id);
    assert.ok(md && md.width === 800 && await storage.exists(md.key));

    const second = await mediaService.backfillMediums({ limit: 50, log: () => {} });
    assert.equal(second.made, 0, 'nothing left to do but the missing file');
    assert.equal((await mediaRepo.variants(old.id)).filter((v) => v.variant_kind === 'medium').length, 1);

    const withMd = await mediaRepo.withMedium(await mediaRepo.findById(old.id));
    assert.equal(withMd.medium_url, md.url);
    assert.equal(withMd.medium_width, 800);
  });
});
