-- Local-only Bulk SDS Import review drafts. These records are intentionally not part of the published HazCom schema.
CREATE TABLE IF NOT EXISTS sds_import_session (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  source_filename TEXT NOT NULL,
  source_relative_path TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_size_bytes INTEGER NOT NULL CHECK(source_size_bytes>0),
  page_count INTEGER NOT NULL CHECK(page_count>0),
  imported_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('review','reviewed'))
);
CREATE INDEX IF NOT EXISTS idx_sds_import_session_company ON sds_import_session(company_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS sds_import_page (
  session_id TEXT NOT NULL REFERENCES sds_import_session(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK(page_number>0),
  extracted_text TEXT NOT NULL DEFAULT '',
  text_status TEXT NOT NULL CHECK(text_status IN ('embedded','ocr_required')),
  signals_json TEXT NOT NULL,
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
  child_relative_path TEXT,
  child_sha256 TEXT CHECK(child_sha256 IS NULL OR length(child_sha256)=64),
  child_size_bytes INTEGER CHECK(child_size_bytes IS NULL OR child_size_bytes>0),
  UNIQUE(session_id,ordinal)
);
CREATE INDEX IF NOT EXISTS idx_sds_import_draft_session ON sds_import_draft(session_id,ordinal);
