-- ═══════════════════════════════════════════════════════════════════════════
-- Remove rows created by repeated seeding.
--
-- The seed's idempotency guards read `.length` off an un-awaited Promise, so
-- they were always truthy and the seed re-ran on every serverless cold start.
-- A deployment that had cold-started five times held five copies of every
-- service, doctor and FAQ (slug collisions made them "general-dentistry-2",
-- "-3" and so on rather than failing).
--
-- Only duplicates are removed, and only when nothing references them, so this
-- is safe to run against a clinic that has since added its own records.
-- ═══════════════════════════════════════════════════════════════════════════

-- Services: keep the earliest row for each name.
DELETE FROM services s
WHERE s.id > (SELECT MIN(s2.id) FROM services s2 WHERE s2.name = s.name)
  AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.service_id = s.id);

-- FAQs: keep the earliest row for each question.
DELETE FROM faqs f
WHERE f.id > (SELECT MIN(f2.id) FROM faqs f2 WHERE f2.question = f.question);

-- Doctors: keep the earliest row for each name, provided the later copies hold
-- no appointments, schedules, holidays or blocked slots of their own.
DELETE FROM doctors d
WHERE d.id > (SELECT MIN(d2.id) FROM doctors d2 WHERE d2.name = d.name)
  AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM doctor_schedules x WHERE x.doctor_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.doctor_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM blocked_slots b WHERE b.doctor_id = d.id);

-- Gallery rows whose media row was written with a Promise instead of a URL
-- ("{}") can never render; drop them so the gallery is not full of blanks.
DELETE FROM gallery_items g WHERE g.media_id IN (SELECT id FROM media WHERE url = '{}');
DELETE FROM media WHERE url = '{}';
