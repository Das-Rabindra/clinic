-- ═══════════════════════════════════════════════════════════════════════════
-- Local positioning (Bikrampur / FCI Township / Talcher, Odisha), social
-- profiles, and the extra fields a treatment detail page needs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Social profiles ───────────────────────────────────────────────────────
-- Instagram and Facebook already existed; YouTube did not, so the footer had
-- no way to link a channel the clinic may open later.
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS youtube_url TEXT;

-- ─── Editable copy for the location section ────────────────────────────────
-- The "how to find us" wording was hardcoded in the template, so the clinic
-- could not correct a landmark without a code change.
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS location_title TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS location_body  TEXT;
ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS treatments_eyebrow TEXT;

-- ─── Address ───────────────────────────────────────────────────────────────
-- The clinic sits in Bikrampur, inside the FCI township at Talcher. The
-- previous rows recorded only "Vikrampur" with no town or state, which left
-- addressLocality empty in the structured data and gave Google nothing to
-- match against a search for a dentist in Talcher.
--
-- The split is chosen so each field lands in the right schema.org slot:
--   address_line1 + area  -> streetAddress
--   city                  -> addressLocality   (the town people search for)
--   state                 -> addressRegion
UPDATE clinic_settings SET
  address_line1 = COALESCE(NULLIF(address_line1, ''), 'Annapurna Market Complex'),
  address_line2 = NULL,
  area          = 'Bikrampur, FCI Township',
  city          = 'Talcher',
  state         = 'Odisha',
  postal_code   = COALESCE(NULLIF(postal_code, ''), '759106'),
  country       = COALESCE(NULLIF(country, ''), 'India'),
  updated_at    = NOW()
WHERE id = 1;

-- ─── Treatment detail content ──────────────────────────────────────────────
-- services already carried name/slug/short_desc/long_desc/image_media_id, so a
-- detail page needs only the sections that page actually renders. All are
-- nullable: a treatment with none of them still renders a valid, if shorter,
-- page rather than an empty one.
ALTER TABLE services ADD COLUMN IF NOT EXISTS who_needs       TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS what_to_expect  TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS benefits        TEXT;  -- one per line
ALTER TABLE services ADD COLUMN IF NOT EXISTS seo_title       TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_featured     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS has_detail_page INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_services_featured ON services(is_featured, display_order);
