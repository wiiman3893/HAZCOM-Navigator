-- Immutable audit link from an approved candidate to its authoritative Product SDS.
CREATE TABLE IF NOT EXISTS sds_import_materialization (
  draft_id TEXT PRIMARY KEY REFERENCES sds_import_draft(id),
  session_id TEXT NOT NULL REFERENCES sds_import_session(id),
  product_id TEXT NOT NULL REFERENCES chemical_product(id),
  attachment_id TEXT NOT NULL UNIQUE REFERENCES dm_attachments(id),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
  source_start_page INTEGER NOT NULL CHECK(source_start_page>0),
  source_end_page INTEGER NOT NULL CHECK(source_end_page>=source_start_page),
  child_relative_path TEXT NOT NULL,
  child_sha256 TEXT NOT NULL CHECK(length(child_sha256)=64),
  child_size_bytes INTEGER NOT NULL CHECK(child_size_bytes>0 AND child_size_bytes<=5242880),
  child_page_count INTEGER NOT NULL CHECK(child_page_count=source_end_page-source_start_page+1),
  materialization_version INTEGER NOT NULL CHECK(materialization_version>0),
  materialized_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sds_import_materialization_product ON sds_import_materialization(product_id);
