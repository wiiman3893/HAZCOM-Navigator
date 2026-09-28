-- Phase 2 evidence/review state. OCR/extraction are never authoritative Product data.
CREATE TABLE IF NOT EXISTS sds_import_page_text (
  session_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK(page_number>0),
  raw_text TEXT NOT NULL DEFAULT '' CHECK(length(raw_text)<=262144),
  normalized_text TEXT NOT NULL DEFAULT '' CHECK(length(normalized_text)<=262144),
  text_source TEXT NOT NULL CHECK(text_source IN ('embedded','ocr','mixed','unavailable')),
  ocr_status TEXT NOT NULL CHECK(ocr_status IN ('not_required','pending','completed','failed','manual_required')),
  ocr_version INTEGER,
  failure_code TEXT,
  PRIMARY KEY(session_id,page_number),
  FOREIGN KEY(session_id,page_number) REFERENCES sds_import_page(session_id,page_number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sds_import_candidate_review (
  draft_id TEXT PRIMARY KEY REFERENCES sds_import_draft(id) ON DELETE CASCADE,
  extraction_version INTEGER NOT NULL CHECK(extraction_version>0),
  extraction_status TEXT NOT NULL CHECK(extraction_status IN ('pending','needs_review','ready','failed')),
  approval_status TEXT NOT NULL DEFAULT 'unapproved' CHECK(approval_status IN ('unapproved','approved','materialized','failed')),
  product_action TEXT CHECK(product_action IN ('create','update')),
  target_product_id TEXT,
  failure_code TEXT,
  reviewed_at TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS sds_import_section (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES sds_import_draft(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>0),
  section_number INTEGER NOT NULL CHECK(section_number BETWEEN 1 AND 16),
  source_pages_json TEXT NOT NULL,
  heading TEXT NOT NULL CHECK(length(heading)<=320),
  evidence_text TEXT NOT NULL CHECK(length(evidence_text)<=131072),
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
  UNIQUE(draft_id,ordinal)
);
CREATE INDEX IF NOT EXISTS idx_sds_import_section_draft ON sds_import_section(draft_id,ordinal);

CREATE TABLE IF NOT EXISTS sds_import_field (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES sds_import_draft(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK(field_name IN ('product_name','manufacturer','sds_date','cas_numbers')),
  proposed_value TEXT CHECK(length(proposed_value)<=1000),
  reviewed_value TEXT CHECK(length(reviewed_value)<=1000),
  review_status TEXT NOT NULL DEFAULT 'proposed' CHECK(review_status IN ('proposed','confirmed','corrected','cleared')),
  source_section INTEGER CHECK(source_section BETWEEN 1 AND 16),
  source_page INTEGER CHECK(source_page>0),
  evidence TEXT NOT NULL DEFAULT '' CHECK(length(evidence)<=320),
  extraction_method TEXT NOT NULL CHECK(extraction_method IN ('embedded','ocr','mixed','unavailable')),
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low','unresolved')),
  UNIQUE(draft_id,field_name)
);
CREATE INDEX IF NOT EXISTS idx_sds_import_field_draft ON sds_import_field(draft_id,field_name);
