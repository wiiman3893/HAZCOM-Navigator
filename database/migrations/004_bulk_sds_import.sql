-- Bulk SDS import review drafts. These records are local authoring state only and are not published.
CREATE TABLE IF NOT EXISTS sds_import_session (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  source_filename TEXT NOT NULL,
  managed_source_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_size_bytes INTEGER NOT NULL CHECK(source_size_bytes>0),
  page_count INTEGER NOT NULL CHECK(page_count>0),
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('review','review_drafts_saved'))
);
CREATE INDEX IF NOT EXISTS idx_sds_import_session_company ON sds_import_session(company_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS sds_import_page (
  session_id TEXT NOT NULL REFERENCES sds_import_session(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK(page_number>0),
  text_snippet TEXT NOT NULL DEFAULT '',
  has_text INTEGER NOT NULL CHECK(has_text IN (0,1)),
  ocr_required INTEGER NOT NULL CHECK(ocr_required IN (0,1)),
  signals_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(session_id,page_number)
);

CREATE TABLE IF NOT EXISTS sds_import_draft (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sds_import_session(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>0),
  start_page INTEGER NOT NULL CHECK(start_page>0),
  end_page INTEGER NOT NULL CHECK(end_page>=start_page),
  confidence TEXT NOT NULL CHECK(confidence IN ('likely','uncertain','manual')),
  reason TEXT NOT NULL,
  detected_title TEXT,
  status TEXT NOT NULL DEFAULT 'review' CHECK(status='review'),
  UNIQUE(session_id,ordinal)
);
CREATE INDEX IF NOT EXISTS idx_sds_import_draft_session ON sds_import_draft(session_id, ordinal);
