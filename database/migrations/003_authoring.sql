-- Authoring concurrency guard and SDS integrity; canonical entities remain unchanged.
CREATE TABLE IF NOT EXISTS authoring_versions (company_id TEXT PRIMARY KEY REFERENCES company(id), version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS authoring_guard (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS authoring_sds_integrity (attachment_id TEXT PRIMARY KEY REFERENCES dm_attachments(id), sha256 TEXT NOT NULL CHECK(length(sha256)=64));
