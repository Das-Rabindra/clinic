-- ═══════════════════════════════════════════════════════════════════════════
-- A second contact number, the Google review QR code, and the treatment a
-- call-back request was made about.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Second contact number ─────────────────────────────────────────────────
-- The clinic now runs two lines. `phone` stays the primary — every tel: link,
-- the header, the sticky bar and the structured data read from it — and the
-- older number becomes a published alternative.
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS phone_secondary      TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS phone_secondary_intl TEXT;

-- ─── Google review QR ──────────────────────────────────────────────────────
-- A scan code the clinic can print and display. Stored as media like every
-- other image so it is replaceable from the admin panel.
ALTER TABLE clinic_settings
  ADD COLUMN IF NOT EXISTS review_qr_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS review_qr_title TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS review_qr_body  TEXT;

-- ─── Treatment on an enquiry ───────────────────────────────────────────────
-- A call-back requested from a treatment page should reach the clinic knowing
-- which treatment it was about. ON DELETE SET NULL rather than CASCADE: losing
-- a treatment must never delete a patient's request to be called back.
ALTER TABLE enquiries
  ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_enquiries_service ON enquiries(service_id);
