-- ═══════════════════════════════════════════════════════════════════════════
-- Manually added patient testimonials.
--
-- These are reviews the clinic collects directly — a written card, a WhatsApp
-- message, a verbal comment the patient agreed could be published — as opposed
-- to reviews synced from Google. They are stored in the same table so the
-- public section can show both, but their provenance is recorded so the two
-- can always be told apart.
--
-- consent_confirmed exists for the same reason it does on gallery items: a real
-- person's words and name are being published, and there should be a record of
-- who attested that the person agreed.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE reviews
  ADD COLUMN consent_confirmed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN consent_note TEXT,
  ADD COLUMN added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Where the testimonial came from, in the clinic's own words:
  -- "WhatsApp message, 2 Sep", "feedback card", "said in person".
  ADD COLUMN collected_via TEXT;

-- A manually added testimonial must carry a consent record before it can be
-- shown. Google-synced reviews are already public on Google, so they do not.
ALTER TABLE reviews
  ADD CONSTRAINT reviews_manual_consent
  CHECK (source <> 'manual' OR is_visible = 0 OR consent_confirmed = 1);

CREATE INDEX idx_reviews_source ON reviews(source, is_visible);
