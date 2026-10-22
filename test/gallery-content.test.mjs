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
