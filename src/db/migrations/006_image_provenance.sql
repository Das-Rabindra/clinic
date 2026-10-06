-- ═══════════════════════════════════════════════════════════════════════════
-- Image provenance.
--
-- Treatment photographs supplied as stock were captioned "...at Samal Dental
-- Care, Talcher", and one as a before-and-after of a smile makeover at the
-- clinic. For a registered dental practice that is a claim about clinical
-- results, and it was not true of any of them.
--
-- The flag lives on media rather than on the service that uses it: provenance
-- belongs to the file, and replacing the file with a real clinic photograph
-- should clear the caption without anyone remembering a second switch.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE media ADD COLUMN IF NOT EXISTS is_stock INTEGER NOT NULL DEFAULT 0;

-- ─── Clinically sensible "other treatments" ────────────────────────────────
-- Every treatment page suggested the same three — general dentistry, cleaning
-- and fillings — because the list was simply the first three featured minus
-- the current one. A patient reading about dentures was offered a check-up.
ALTER TABLE services ADD COLUMN IF NOT EXISTS related_slugs TEXT;

-- ─── Treatment-specific questions ──────────────────────────────────────────
-- All fourteen pages carried the same five site-wide FAQs, none of which said
-- anything about the treatment, duplicated across fourteen indexed URLs along
-- with their FAQPage markup.
CREATE TABLE IF NOT EXISTS service_faqs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, question)
);
CREATE INDEX IF NOT EXISTS idx_service_faqs ON service_faqs(service_id, display_order);
