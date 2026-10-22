/** Clinic-supplied gallery photos added on boot (src/db/gallery-content.js). */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx, srv, db, apply, PHOTOS;

before(async () => {
  ctx = await setupEnv('gallerycontent');
  await bootDb();
  db = await import('../src/db/index.js');
  ({ applyGalleryContent: apply, GALLERY_PHOTOS: PHOTOS } = await import('../src/db/gallery-content.js'));
  srv = await startServer();
});
after(async () => { await srv.close(); await cleanup(ctx); });

describe('clinic gallery photos', () => {
  test('both photos go through the upload pipeline and publish with consent recorded', async () => {
    const r = await apply({ log: () => {} });
    assert.equal(r.added, PHOTOS.length);
    const rows = await db.all(`SELECT g.title, g.category, g.is_published, g.consent_confirmed, g.consent_note, m.mime, m.folder, m.alt
                               FROM gallery_items g JOIN media m ON m.id = g.media_id ORDER BY g.id`);
    assert.equal(rows.length, PHOTOS.length);
    for (const row of rows) {
      assert.equal(row.category, 'treatment');
      assert.equal(row.is_published, 1);
      assert.equal(row.consent_confirmed, 1);
      assert.match(row.consent_note, /consent/i);
      assert.equal(row.mime, 'image/webp', 're-encoded like an admin upload');
      assert.equal(row.folder, 'treatment-results');
      assert.ok(row.alt.length > 20);
    }
  });

  test('running again adds nothing; a photo deleted in the admin never comes back', async () => {
    assert.equal((await apply({ log: () => {} })).added, 0);
    await db.run(`UPDATE gallery_items SET deleted_at = NOW(), is_published = 0 WHERE title = ?`, PHOTOS[0].title);
    assert.equal((await apply({ log: () => {} })).added, 0);
  });

  test('the homepage shows them as a grid with their titles', async () => {
    const body = (await srv.call('/')).body;
    assert.match(body, /class="gallery-grid-ds"|class="gallery-feature"/);
    assert.ok(body.includes(PHOTOS[1].title));
  });

  test('a before & after photo without a consent record is refused', async () => {
    const r = await apply({ log: () => {}, list: [{ ...PHOTOS[1], title: 'No consent test', consent: '' }] });
    assert.equal(r.added, 0);
    assert.equal(await db.one(`SELECT id FROM gallery_items WHERE title = 'No consent test'`), undefined);
  });

  test('the committed source files carry no camera metadata', async () => {
    const sharp = (await import('sharp')).default;
    for (const p of PHOTOS) {
      const m = await sharp(`content/gallery/${p.file}`).metadata();
      assert.ok(!m.exif && !m.xmp && !m.iptc, `${p.file} has metadata`);
    }
  });
});

describe('concurrent boots', () => {
  test('two instances starting at once add each photo only once, and existing duplicates are cleaned up', async () => {
    await db.run(`DELETE FROM gallery_items`);
    // Simulate the production race's leftovers: two live copies of one title.
    const m = await db.one(`INSERT INTO media (storage,key,url,folder,mime,ext,bytes) VALUES ('local','d/1','/media/d1.webp','treatment-results','image/webp','webp',1) RETURNING id`);
    for (let i = 0; i < 2; i++) {
      await db.run(`INSERT INTO gallery_items (media_id,title,category,is_published,consent_confirmed) VALUES (?,?, 'treatment', 1, 1)`, m.id, PHOTOS[0].title);
    }
    await Promise.all([apply({ log: () => {} }), apply({ log: () => {} }), apply({ log: () => {} })]);
    for (const p of PHOTOS) {
      const live = await db.all(`SELECT id FROM gallery_items WHERE title = ? AND deleted_at IS NULL`, p.title);
      assert.equal(live.length, 1, `${p.title}: ${live.length} live copies`);
    }
    const kept = await db.one(`SELECT m.deleted_at FROM gallery_items g JOIN media m ON m.id = g.media_id WHERE g.title = ? AND g.deleted_at IS NULL`, PHOTOS[0].title);
    assert.equal(kept.deleted_at, null, 'the kept copy still has its image');
  });
});
