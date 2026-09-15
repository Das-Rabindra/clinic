/**
 * Partial-update semantics.
 *
 * A PUT that names one field must change only that field. Zod's `.partial()`
 * keeps `.default()` values, which would silently rewrite untouched columns —
 * e.g. editing a gallery item's title would reset its category and unpublish
 * it. These tests pin the corrected behaviour.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { setupEnv, bootDb, startServer, cleanup } from './helpers.mjs';

let ctx;
const SUITE = 'updates';
let srv, usersRepo, galleryRepo, mediaService, csrf;
const PASSWORD = 'UpdateTestPass123';

before(async () => {
  ctx = await setupEnv(SUITE);
  await bootDb();
  usersRepo = await import('../src/repositories/users.repo.js');
  galleryRepo = await import('../src/repositories/gallery.repo.js');
  mediaService = await import('../src/services/media.service.js');
  await usersRepo.create({ email: 'up@clinic.test', name: 'Up', password: PASSWORD, role: 'owner' });
  srv = await startServer();
  await srv.call('/api/auth/login', { json: { email: 'up@clinic.test', password: PASSWORD } });
  csrf = srv.csrf();
});
after(async () => { await srv.close(); await cleanup(ctx); });

const put = (path, json) => srv.call(path, { method: 'PUT', headers: { 'X-CSRF-Token': csrf }, json });
const post = (path, json) => srv.call(path, { method: 'POST', headers: { 'X-CSRF-Token': csrf }, json });

const image = async (name) => {
  const buffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#7C9885' } })
    .jpeg().toBuffer();
  return await mediaService.ingestImage({ buffer, originalname: name }, { folder: 'clinic', userId: 1 });
};

describe('doctor partial update', () => {
  test('setting only the photo leaves every other field intact', async () => {
    const media = await image('doc.jpg');
    const before = (await srv.call('/api/admin/doctors/1')).body;

    const r = await put('/api/admin/doctors/1', { photo_media_id: media.id });
    assert.equal(r.status, 200, 'a boolean must not break the SQL binding');
    assert.equal(r.body.doctor.photo_media_id, media.id);

    const after = r.body.doctor;
    assert.equal(after.name, before.name);
    assert.equal(after.qualification, before.qualification);
    assert.equal(after.specialization, before.specialization);
    assert.equal(after.is_active, before.is_active);
    assert.equal(after.display_order, before.display_order);
  });

  test('deactivating a doctor persists the boolean correctly', async () => {
    const r = await put('/api/admin/doctors/1', { is_active: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.doctor.is_active, 0, 'stored as 0, not a raw boolean');
    await put('/api/admin/doctors/1', { is_active: true });
  });
});

describe('clinic settings partial update', () => {
  test('changing one setting does not null every other field', async () => {
    const before = (await srv.call('/api/admin/clinic')).body.settings;
    assert.ok(before.doctor_name, 'fixture has a doctor name');
    assert.ok(before.phone, 'fixture has a phone number');

    const r = await put('/api/admin/clinic', { tagline: 'A new tagline' });
    assert.equal(r.status, 200);

    const after = r.body.settings;
    assert.equal(after.tagline, 'A new tagline');
    for (const key of ['name', 'doctor_name', 'qualification', 'registration',
      'institution', 'phone', 'phone_intl', 'whatsapp', 'address_line1', 'area',
      'postal_code', 'hero_title', 'seo_title']) {
      assert.equal(after[key], before[key], `${key} must be untouched by an unrelated update`);
    }
    assert.deepEqual(r.body.changed, ['tagline'], 'only the field actually sent is reported as changed');
  });

  test('an explicit empty string still clears a field', async () => {
    await put('/api/admin/clinic', { tagline: 'temporary' });
    const r = await put('/api/admin/clinic', { tagline: '' });
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.tagline, null, 'sending "" means clear');
    assert.ok(r.body.settings.doctor_name, 'and still leaves other fields alone');
  });

  test('setting the hero image leaves clinic details intact', async () => {
    const media = await image('hero.jpg');
    const before = (await srv.call('/api/admin/clinic')).body.settings;
    const r = await put('/api/admin/clinic', { hero_media_id: media.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.hero_media_id, media.id);
    assert.equal(r.body.settings.doctor_name, before.doctor_name);
    assert.equal(r.body.settings.phone, before.phone);
    assert.equal(r.body.settings.address_line1, before.address_line1);
  });
});

describe('service partial update', () => {
  test('renaming a service does not reset its other settings', async () => {
    const created = (await post('/api/admin/services', {
      name: 'Partial Test Service', duration_min: 45, bookable: false,
      is_active: false, show_price: true, price_from: 500,
    })).body.service;
    assert.equal(created.bookable, 0);
    assert.equal(created.duration_min, 45);

    const r = await put(`/api/admin/services/${created.id}`, { name: 'Renamed Service' });
    assert.equal(r.status, 200);
    const after = r.body.service;
    assert.equal(after.name, 'Renamed Service');
    assert.equal(after.duration_min, 45, 'duration must not revert to the 30-minute default');
    assert.equal(after.bookable, 0, 'bookable must not flip to the default true');
    assert.equal(after.is_active, 0, 'is_active must not flip to the default true');
    assert.equal(after.price_from, 500);
  });
});

describe('FAQ partial update', () => {
  test('editing a question does not re-publish a hidden FAQ', async () => {
    const created = (await post('/api/admin/faqs', {
      question: 'Draft question?', answer: 'Draft answer.', is_published: false,
    })).body.faq;
    assert.equal(created.is_published, 0);

    const r = await put(`/api/admin/faqs/${created.id}`, { question: 'Edited question?' });
    assert.equal(r.status, 200);
    assert.equal(r.body.faq.question, 'Edited question?');
    assert.equal(r.body.faq.is_published, 0, 'must not flip to the default true');
  });
});

describe('gallery partial update', () => {
  test('editing the title does not reset category or unpublish the item', async () => {
    const media = await image('gal.jpg');
    const created = (await post('/api/admin/gallery', {
      media_id: media.id, title: 'Reception Area', category: 'reception', is_published: true,
    })).body.item;
    assert.equal(created.category, 'reception');
    assert.equal(created.is_published, 1);

    const r = await put(`/api/admin/gallery/${created.id}`, { title: 'Reception Area (updated)' });
    assert.equal(r.status, 200);
    const after = r.body.item;
    assert.equal(after.title, 'Reception Area (updated)');
    assert.equal(after.category, 'reception', 'category must not revert to the "clinic" default');
    assert.equal(after.is_published, 1, 'the item must stay published');
  });

  test('a consented treatment photo is not silently unconsented by an unrelated edit', async () => {
    const media = await image('treat.jpg');
    const created = (await post('/api/admin/gallery', {
      media_id: media.id, title: 'Before & After — Whitening', category: 'treatment',
      consent_confirmed: true, is_published: true,
    })).body.item;
    assert.equal(created.consent_confirmed, 1);
    assert.equal(created.is_published, 1);

    const r = await put(`/api/admin/gallery/${created.id}`, { description: 'Updated caption' });
    assert.equal(r.status, 200);
    assert.equal(r.body.item.consent_confirmed, 1, 'consent must survive an unrelated edit');
    assert.equal(r.body.item.category, 'treatment');
    assert.equal(r.body.item.is_published, 1);
  });
});

describe('seed idempotency', () => {
  test('re-running the seed does not duplicate clinic data', async () => {
    // On a serverless platform the seed runs on every cold start, so its
    // guards must actually hold. They previously read `.length` off an
    // un-awaited Promise, which is undefined, so every boot re-seeded:
    // a deployment with five cold starts held five copies of every service.
    const servicesRepo = await import('../src/repositories/services.repo.js');
    const doctorsRepo = await import('../src/repositories/doctors.repo.js');
    const contentRepo = await import('../src/repositories/content.repo.js');
    const settingsRepo = await import('../src/repositories/settings.repo.js');
    const { seed } = await import('../src/db/seed.js');

    const before = {
      services: (await servicesRepo.list()).length,
      doctors: (await doctorsRepo.list()).length,
      faqs: (await contentRepo.listFaqs()).length,
      hours: (await settingsRepo.getHours()).length,
    };
    assert.ok(before.services > 0, 'fixture is seeded');

    await seed({ log: () => {} });
    await seed({ log: () => {} });

    assert.deepEqual({
      services: (await servicesRepo.list()).length,
      doctors: (await doctorsRepo.list()).length,
      faqs: (await contentRepo.listFaqs()).length,
      hours: (await settingsRepo.getHours()).length,
    }, before, 'a second and third seed must add nothing');
  });
});
