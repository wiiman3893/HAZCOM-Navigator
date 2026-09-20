-- Constellation Data Management schema plan for Hazcom Navigator
-- Recommended storage: SQLite
-- Planning artifact: canonical relationships and utility persistence below are implementation requirements, not optional commentary.
-- Primary data root mode: application-managed
-- Managed attachment directory: attachments
-- Relative managed paths: true

-- DATA TYPE 9d7173b8-0cff-48f8-b4be-ca493781b830: Company; classification=container; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_company_deleted_at ON company (deleted_at);

-- DATA TYPE 3e5e5e37-3d40-44c9-998b-1bd3e2784750: Work Area; classification=record; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE work_area (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  poc_name TEXT NOT NULL,
  poc_email TEXT NOT NULL,
  poc_phone_number TEXT NOT NULL,
  description TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_work_area_deleted_at ON work_area (deleted_at);

-- DATA TYPE c7d474d1-bb1e-4659-9e72-4ffa0303aafb: Chemical Product; classification=record; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE chemical_product (
  id TEXT PRIMARY KEY,
  chemical_names TEXT,
  product_name TEXT NOT NULL,
  cas_numbers TEXT,
  manufacturer TEXT NOT NULL,
  sds_date TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_chemical_product_deleted_at ON chemical_product (deleted_at);

-- DATA TYPE fe3ed71c-cf4c-449e-a496-8be4212da506: Worker; classification=record; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE worker (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_worker_deleted_at ON worker (deleted_at);

-- DATA TYPE 7a3b2f8e-6f25-4fc3-9827-0ec49c84da67: SDS Verification; classification=event; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE sds_verification (
  id TEXT PRIMARY KEY,
  verified_at TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_sds_verification_deleted_at ON sds_verification (deleted_at);

-- DATA TYPE f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea: Training Event; classification=event; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE training_event (
  id TEXT PRIMARY KEY,
  training_date TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_training_event_deleted_at ON training_event (deleted_at);

-- DATA TYPE 840ded8c-44f7-474a-ba10-94b32e61ad21: Work Area Product; classification=record; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE work_area_product (
  id TEXT PRIMARY KEY,
  quantity TEXT NOT NULL,
  storage_location TEXT NOT NULL,
  added_date TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_work_area_product_deleted_at ON work_area_product (deleted_at);

-- DATA TYPE 548ff00c-0368-404d-a63e-691c193da483: Work Area Assignment; classification=record; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE work_area_assignment (
  id TEXT PRIMARY KEY,
  assigned_date TEXT NOT NULL,
  ended_date TEXT,
  training_required_since TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_work_area_assignment_deleted_at ON work_area_assignment (deleted_at);

-- DATA TYPE 3e80785a-d472-4931-a4bd-9c1d5505d31d: HAZCOM Review; classification=event; display-identity=Fallback: first non-empty user-facing text/identifier/select field; otherwise the type label plus a short form of the stable internal ID.
CREATE TABLE hazcom_review (
  id TEXT PRIMARY KEY,
  review_date TEXT NOT NULL,
  deleted_at DATETIME NULL
);
CREATE INDEX idx_hazcom_review_deleted_at ON hazcom_review (deleted_at);

-- RECORD OWNERSHIP FOR work_area: allowed owner types=company; actual owner cardinality=exactly-one
-- RELATIONSHIP 10f4ef7a-86c3-4f4d-9d33-cff2c0eee738: company -> work_area; cardinality=one-to-many; record-ownership=true
CREATE TABLE work_area__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  company_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES work_area(id),
  FOREIGN KEY (company_id) REFERENCES company(id),
  CHECK ((relationship_id = '10f4ef7a-86c3-4f4d-9d33-cff2c0eee738' AND company_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_work_area__ownership_child ON work_area__ownership (child_id);
CREATE INDEX idx_work_area__ownership_company ON work_area__ownership (company_id);
-- INVARIANT: each persisted work_area that participates in structural ownership must have exactly one work_area__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR chemical_product: allowed owner types=company; actual owner cardinality=exactly-one
-- RELATIONSHIP 940a4d09-5250-4b89-9911-1ac6f4ba64cf: company -> chemical_product; cardinality=one-to-many; record-ownership=true
CREATE TABLE chemical_product__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  company_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES chemical_product(id),
  FOREIGN KEY (company_id) REFERENCES company(id),
  CHECK ((relationship_id = '940a4d09-5250-4b89-9911-1ac6f4ba64cf' AND company_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_chemical_product__ownership_child ON chemical_product__ownership (child_id);
CREATE INDEX idx_chemical_product__ownership_company ON chemical_product__ownership (company_id);
-- INVARIANT: each persisted chemical_product that participates in structural ownership must have exactly one chemical_product__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR worker: allowed owner types=company; actual owner cardinality=exactly-one
-- RELATIONSHIP 1e679f94-12b0-4d70-839e-d54c064f5ab1: company -> worker; cardinality=one-to-many; record-ownership=true
CREATE TABLE worker__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  company_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES worker(id),
  FOREIGN KEY (company_id) REFERENCES company(id),
  CHECK ((relationship_id = '1e679f94-12b0-4d70-839e-d54c064f5ab1' AND company_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_worker__ownership_child ON worker__ownership (child_id);
CREATE INDEX idx_worker__ownership_company ON worker__ownership (company_id);
-- INVARIANT: each persisted worker that participates in structural ownership must have exactly one worker__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR sds_verification: allowed owner types=chemical_product; actual owner cardinality=exactly-one
-- RELATIONSHIP 7b8f5523-3a5c-4bfa-bf83-e5310911ea7b: chemical_product -> sds_verification; cardinality=one-to-many; record-ownership=true
CREATE TABLE sds_verification__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  chemical_product_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES sds_verification(id),
  FOREIGN KEY (chemical_product_id) REFERENCES chemical_product(id),
  CHECK ((relationship_id = '7b8f5523-3a5c-4bfa-bf83-e5310911ea7b' AND chemical_product_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_sds_verification__ownership_child ON sds_verification__ownership (child_id);
CREATE INDEX idx_sds_verification__ownership_chemical_product ON sds_verification__ownership (chemical_product_id);
-- INVARIANT: each persisted sds_verification that participates in structural ownership must have exactly one sds_verification__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR work_area_product: allowed owner types=work_area; actual owner cardinality=exactly-one
-- RELATIONSHIP 96db12e7-1201-4f03-8a31-3a8fa6c2ab95: work_area -> work_area_product; cardinality=one-to-many; record-ownership=true
CREATE TABLE work_area_product__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  work_area_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES work_area_product(id),
  FOREIGN KEY (work_area_id) REFERENCES work_area(id),
  CHECK ((relationship_id = '96db12e7-1201-4f03-8a31-3a8fa6c2ab95' AND work_area_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_work_area_product__ownership_child ON work_area_product__ownership (child_id);
CREATE INDEX idx_work_area_product__ownership_work_area ON work_area_product__ownership (work_area_id);
-- INVARIANT: each persisted work_area_product that participates in structural ownership must have exactly one work_area_product__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR work_area_assignment: allowed owner types=work_area; actual owner cardinality=exactly-one
-- RELATIONSHIP 2915981b-e56b-4e0b-a619-a1fbcf9a6566: work_area -> work_area_assignment; cardinality=one-to-many; record-ownership=true
CREATE TABLE work_area_assignment__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  work_area_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES work_area_assignment(id),
  FOREIGN KEY (work_area_id) REFERENCES work_area(id),
  CHECK ((relationship_id = '2915981b-e56b-4e0b-a619-a1fbcf9a6566' AND work_area_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_work_area_assignment__ownership_child ON work_area_assignment__ownership (child_id);
CREATE INDEX idx_work_area_assignment__ownership_work_area ON work_area_assignment__ownership (work_area_id);
-- INVARIANT: each persisted work_area_assignment that participates in structural ownership must have exactly one work_area_assignment__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR training_event: allowed owner types=work_area_assignment; actual owner cardinality=exactly-one
-- RELATIONSHIP 609b3aa7-28ab-498b-8b28-287c5232be85: work_area_assignment -> training_event; cardinality=one-to-many; record-ownership=true
CREATE TABLE training_event__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  work_area_assignment_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES training_event(id),
  FOREIGN KEY (work_area_assignment_id) REFERENCES work_area_assignment(id),
  CHECK ((relationship_id = '609b3aa7-28ab-498b-8b28-287c5232be85' AND work_area_assignment_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_training_event__ownership_child ON training_event__ownership (child_id);
CREATE INDEX idx_training_event__ownership_work_area_assignment ON training_event__ownership (work_area_assignment_id);
-- INVARIANT: each persisted training_event that participates in structural ownership must have exactly one training_event__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RECORD OWNERSHIP FOR hazcom_review: allowed owner types=work_area; actual owner cardinality=exactly-one
-- RELATIONSHIP 024e4f65-976b-4a77-8323-d4b317e693a1: work_area -> hazcom_review; cardinality=one-to-many; record-ownership=true
CREATE TABLE hazcom_review__ownership (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  work_area_id TEXT NULL,
  FOREIGN KEY (child_id) REFERENCES hazcom_review(id),
  FOREIGN KEY (work_area_id) REFERENCES work_area(id),
  CHECK ((relationship_id = '024e4f65-976b-4a77-8323-d4b317e693a1' AND work_area_id IS NOT NULL)),
  UNIQUE (child_id)
);
CREATE INDEX idx_hazcom_review__ownership_child ON hazcom_review__ownership (child_id);
CREATE INDEX idx_hazcom_review__ownership_work_area ON hazcom_review__ownership (work_area_id);
-- INVARIANT: each persisted hazcom_review that participates in structural ownership must have exactly one hazcom_review__ownership row. The UNIQUE constraint enforces the maximum; enforce the minimum transactionally or with an engine-appropriate deferred trigger.

-- RELATIONSHIP 9d42d6cd-a311-4a1e-9358-2d1cc921b641: chemical_product -> work_area_product; kind=references; cardinality=one-to-many; record-ownership=false
CREATE TABLE rel_chemical_product_work_area_product_9d42d6cd (
  id TEXT PRIMARY KEY,
  chemical_product_id TEXT NOT NULL,
  work_area_product_id TEXT NOT NULL,
  FOREIGN KEY (chemical_product_id) REFERENCES chemical_product(id),
  FOREIGN KEY (work_area_product_id) REFERENCES work_area_product(id),
  UNIQUE (work_area_product_id)
);
CREATE INDEX idx_rel_chemical_product_work_area_product_9d42d6cd_chemical_product_id ON rel_chemical_product_work_area_product_9d42d6cd (chemical_product_id);
CREATE INDEX idx_rel_chemical_product_work_area_product_9d42d6cd_work_area_product_id ON rel_chemical_product_work_area_product_9d42d6cd (work_area_product_id);

-- RELATIONSHIP d30ac2b9-7aff-4838-9e9e-27deedfe9c38: worker -> work_area_assignment; kind=references; cardinality=one-to-many; record-ownership=false
CREATE TABLE rel_worker_work_area_assignment_d30ac2b9 (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  work_area_assignment_id TEXT NOT NULL,
  FOREIGN KEY (worker_id) REFERENCES worker(id),
  FOREIGN KEY (work_area_assignment_id) REFERENCES work_area_assignment(id),
  UNIQUE (work_area_assignment_id)
);
CREATE INDEX idx_rel_worker_work_area_assignment_d30ac2b9_worker_id ON rel_worker_work_area_assignment_d30ac2b9 (worker_id);
CREATE INDEX idx_rel_worker_work_area_assignment_d30ac2b9_work_area_assignment_id ON rel_worker_work_area_assignment_d30ac2b9 (work_area_assignment_id);

-- PERSISTENCE CONSEQUENCES OF SELECTED DATA MANAGEMENT CAPABILITIES
-- PERSISTENCE: attachments
CREATE TABLE dm_attachments (
  id TEXT PRIMARY KEY,
  owner_type VARCHAR(255) NOT NULL,
  owner_id TEXT NOT NULL,
  slot_key VARCHAR(255) NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  relative_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type VARCHAR(255) NULL,
  size_bytes BIGINT NULL,
  created_at DATETIME NOT NULL
);
CREATE INDEX idx_dm_attachments_owner ON dm_attachments (owner_type, owner_id);
CREATE INDEX idx_dm_attachments_slot ON dm_attachments (owner_type, owner_id, slot_key, ordinal);
-- Binary attachment content lives beneath the managed "attachments" directory by default, not in the database.

-- PERSISTENCE: change-history
CREATE TABLE dm_change_history (
  id TEXT PRIMARY KEY,
  record_type VARCHAR(255) NOT NULL,
  record_id TEXT NOT NULL,
  changed_at DATETIME NOT NULL,
  action VARCHAR(64) NOT NULL,
  changes_json TEXT NOT NULL
);
CREATE INDEX idx_dm_change_history_record ON dm_change_history (record_type, record_id, changed_at);
-- Treat dm_change_history as append-only application infrastructure.

-- PERSISTENCE: backup-restore
-- Backup packages must include the structured database/data, managed attachment directory, and a versioned restore manifest. Backup destination remains separate from the primary data root.

-- STORAGE TOPOLOGY
-- - Data behavior: hybrid.
-- - Local/client persistence foundation: SQLite.
-- - Android: local role=published-replica; persistence=SQLite + application-managed SDS files; offline=yes.
-- - iOS: local role=published-replica; persistence=SQLite + application-managed SDS files; offline=yes.
-- - Windows: local role=draft-authority; persistence=SQLite + Application-managed SDS files; offline=yes.
-- - Shared backend: Firebase.
-- - Shared structured data: Cloud Firestore.
-- - Shared managed files: Cloud Storage for Firebase.
-- - Draft/working authority: client-local; published/shared authority: shared-backend; movement=publish-revision.
-- - Explicit client/shared-backend choices are authoritative. Do not substitute MySQL/PostgreSQL merely because the project is Hybrid.
-- - Local persistence, shared structured data, managed files, and backup/export are separate architecture layers.
-- - Alert-capable data may require background/server evaluation when its authoritative source is remote; do not assume an open client is always responsible.

-- APPLICATION ACCESS MODEL
CREATE TABLE access_accounts (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(320) NULL,
  username VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
-- Credential secrets belong in the selected authentication provider / safe credential system; never store plaintext passwords here.

CREATE TABLE access_roles (
  id VARCHAR(64) PRIMARY KEY,
  role_key VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  role_context VARCHAR(32) NOT NULL CHECK (role_context IN ('membership','system'))
);
INSERT INTO access_roles (id, role_key, display_name, role_context) VALUES ('bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','administrator','Administrator','membership');
INSERT INTO access_roles (id, role_key, display_name, role_context) VALUES ('087671c1-1398-4297-b5ae-b37c410ae878','manager','HAZCOM Manager','membership');
INSERT INTO access_roles (id, role_key, display_name, role_context) VALUES ('9052eefa-07d1-4c5a-8bff-4fae86ba757e','member','Member','membership');

CREATE TABLE access_memberships (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  FOREIGN KEY (account_id) REFERENCES access_accounts(id),
  FOREIGN KEY (organization_id) REFERENCES company(id)
);
CREATE INDEX idx_access_memberships_account ON access_memberships (account_id);
CREATE INDEX idx_access_memberships_org ON access_memberships (organization_id);

CREATE TABLE access_membership_roles (
  membership_id VARCHAR(64) NOT NULL,
  role_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (membership_id, role_id),
  FOREIGN KEY (membership_id) REFERENCES access_memberships(id),
  FOREIGN KEY (role_id) REFERENCES access_roles(id)
);

CREATE TABLE access_permission_rules (
  id VARCHAR(64) PRIMARY KEY,
  role_id VARCHAR(64) NOT NULL,
  resource_type VARCHAR(32) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  action VARCHAR(32) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  relationship_path TEXT NULL,
  FOREIGN KEY (role_id) REFERENCES access_roles(id)
);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('97c466e3-b9a7-4ca6-aad9-fb0fc88003dd','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('9973ae34-bedc-4aaa-a85c-7cb79c143a54','087671c1-1398-4297-b5ae-b37c410ae878','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('a80bffb1-2be0-4780-a655-e34d5b68b24a','087671c1-1398-4297-b5ae-b37c410ae878','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('80412cf3-ea79-4e46-9734-701b7fb7b0a1','087671c1-1398-4297-b5ae-b37c410ae878','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('7a009069-7bb3-40ff-ae46-6db61c5e53ae','087671c1-1398-4297-b5ae-b37c410ae878','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('df42c07d-317d-46f7-9bf2-7585d142f476','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('4fc734ed-832f-4ad6-b3c8-c4b81cec1e0e','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('fdb7662e-5e96-4939-a35a-7e5cbeb14aff','087671c1-1398-4297-b5ae-b37c410ae878','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('f51d9093-0e3b-44c0-a432-5a694a3bc2a7','087671c1-1398-4297-b5ae-b37c410ae878','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('665d53e0-4a1a-468c-9aea-d103456d12ec','087671c1-1398-4297-b5ae-b37c410ae878','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('ef241aa8-190f-4519-9045-ec1bdc820ae9','087671c1-1398-4297-b5ae-b37c410ae878','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('92dadbbf-cb88-49ad-9303-2e892621eaa7','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('dcb49531-b854-4acb-930a-b84c0e7c24ba','087671c1-1398-4297-b5ae-b37c410ae878','entity','9d7173b8-0cff-48f8-b4be-ca493781b830','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('2b949f99-9aad-40cd-8556-1ea4b58583a2','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','read','linked-record',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('170bb4eb-c80e-4b8d-8dc0-c9397a8686f8','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('03c5b0e3-e836-4520-a3b3-4191c50f2972','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('4f8a4676-c27b-48a0-9098-99a2e59859c2','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','9d7173b8-0cff-48f8-b4be-ca493781b830','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('a428459d-b669-4b48-aa03-d7e821ccfa80','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','9d7173b8-0cff-48f8-b4be-ca493781b830','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('3c23f882-482c-4410-b581-8089417283a6','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('d726fcf5-c1c2-4999-9791-72a6097d5033','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('58af638b-14ce-4b6e-aac4-46d786ef1afd','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('bd857735-1ca4-4ed8-99aa-994f2095313a','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e5e5e37-3d40-44c9-998b-1bd3e2784750','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('0a5b2523-8ffb-4274-81a7-a5929f36c5f4','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('498199ec-4faa-4294-bfdd-4490a5cd0dce','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('d61aed0f-4d49-4e5e-a14e-30e652870b27','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('3b02f322-7e0d-478b-b4e3-a2961b2b2806','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','c7d474d1-bb1e-4659-9e72-4ffa0303aafb','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('3b421d3a-ee64-438c-878d-85b3dcbd14cb','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('cddeddfe-5839-46c6-a361-784adad3e228','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('710f9f57-1584-4e5a-b188-26ec89f53c87','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('879fc93e-583e-40f2-b510-dff105891dc9','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','fe3ed71c-cf4c-449e-a496-8be4212da506','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('525ddbba-dca8-459d-8789-a3940d0e0ff7','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','7a3b2f8e-6f25-4fc3-9827-0ec49c84da67','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('4a5c233d-0116-4969-ab07-376bac03fca7','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','7a3b2f8e-6f25-4fc3-9827-0ec49c84da67','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('f656e3f7-3f50-4681-aa77-d1ec3108c650','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('98eb8a01-1097-4678-aaad-79df39f9698f','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('1abceb9d-11d1-40a4-801e-a96f72ace2ba','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('efd62c0a-5014-4945-840f-a44a0cce2e48','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('078ae966-585f-4457-bb6e-dbaef95ea89e','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('0df21f3c-20e2-4ae9-b940-271c1ff8e55e','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('13603c91-879b-4acb-9188-50a62d243da2','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','548ff00c-0368-404d-a63e-691c193da483','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('f7d16e72-6741-4cc1-8283-463d556e655a','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','548ff00c-0368-404d-a63e-691c193da483','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('3a90b658-e9b8-4fe5-9003-b494816e613b','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','548ff00c-0368-404d-a63e-691c193da483','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('1d60bca6-b142-4b28-b0f5-127e7180752c','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','548ff00c-0368-404d-a63e-691c193da483','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('1c357ec2-8dce-4447-8595-011d12131089','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e80785a-d472-4931-a4bd-9c1d5505d31d','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('330701d8-0dca-4288-8878-141948a71ce1','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','entity','3e80785a-d472-4931-a4bd-9c1d5505d31d','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('6f4a5578-8985-4334-833f-53634895b774','087671c1-1398-4297-b5ae-b37c410ae878','entity','7a3b2f8e-6f25-4fc3-9827-0ec49c84da67','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5bd57ff8-a34c-4ba7-9cdc-67dc3427aab0','087671c1-1398-4297-b5ae-b37c410ae878','entity','7a3b2f8e-6f25-4fc3-9827-0ec49c84da67','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('206a37f5-afc2-4fdf-86d8-e0cfe7b7c399','087671c1-1398-4297-b5ae-b37c410ae878','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('9ae80fbf-f318-456c-87b9-1d05ed7fba76','087671c1-1398-4297-b5ae-b37c410ae878','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5c4ca91c-0ce9-4427-9225-13a647be4109','087671c1-1398-4297-b5ae-b37c410ae878','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('3049f543-61fe-461d-a4aa-538144be94a3','087671c1-1398-4297-b5ae-b37c410ae878','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5844e753-a2fd-42c3-bec2-7bc4dfd76d77','087671c1-1398-4297-b5ae-b37c410ae878','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('bbda5325-0ed6-4aad-a62b-2ad7dff16147','087671c1-1398-4297-b5ae-b37c410ae878','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5c89c641-f0d7-4425-9a21-0666d20d3e17','087671c1-1398-4297-b5ae-b37c410ae878','entity','548ff00c-0368-404d-a63e-691c193da483','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('53b0fc49-2f58-4959-9acb-d5f836c64398','087671c1-1398-4297-b5ae-b37c410ae878','entity','548ff00c-0368-404d-a63e-691c193da483','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('62691dcf-3b0d-4246-b77c-aed901d3ae85','087671c1-1398-4297-b5ae-b37c410ae878','entity','548ff00c-0368-404d-a63e-691c193da483','update','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('fa9dfe04-ce32-455f-bdb8-87f3ebcb0575','087671c1-1398-4297-b5ae-b37c410ae878','entity','548ff00c-0368-404d-a63e-691c193da483','delete','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('1479fba7-0024-4b10-8556-9a478c40b7d0','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e80785a-d472-4931-a4bd-9c1d5505d31d','create','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5cc6d7c0-5b26-44fb-9b0c-82f04e57c781','087671c1-1398-4297-b5ae-b37c410ae878','entity','3e80785a-d472-4931-a4bd-9c1d5505d31d','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('88cf8b2e-1375-40e3-bd90-634dd5eebe28','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','840ded8c-44f7-474a-ba10-94b32e61ad21','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('48903b55-f021-48d7-a32f-6537d4d7d463','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','548ff00c-0368-404d-a63e-691c193da483','read','related-to-linked-record','d30ac2b9-7aff-4838-9e9e-27deedfe9c38');
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('5dfccadd-0bed-4f55-8ef4-e7ee92ee0bc4','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','9d7173b8-0cff-48f8-b4be-ca493781b830','read','own-organization',NULL);
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('57564768-99ed-4ea7-a991-15f144cc36d2','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','read','related-to-linked-record','d30ac2b9-7aff-4838-9e9e-27deedfe9c38,609b3aa7-28ab-498b-8b28-287c5232be85');
INSERT INTO access_permission_rules (id, role_id, resource_type, resource_id, action, scope, relationship_path) VALUES ('e4050311-2246-45a3-b64e-78f24c369a9f','9052eefa-07d1-4c5a-8bff-4fae86ba757e','entity','f47500e4-d9bb-4a62-80a4-c8ba6cdce8ea','create','related-to-linked-record','d30ac2b9-7aff-4838-9e9e-27deedfe9c38,609b3aa7-28ab-498b-8b28-287c5232be85');

CREATE TABLE access_administrative_rules (
  id VARCHAR(64) PRIMARY KEY,
  role_id VARCHAR(64) NOT NULL,
  capability VARCHAR(64) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  FOREIGN KEY (role_id) REFERENCES access_roles(id)
);
INSERT INTO access_administrative_rules (id, role_id, capability, scope) VALUES ('b13efa02-e237-525f-975c-4ed92b78a736','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','manage-accounts','own-organization');
INSERT INTO access_administrative_rules (id, role_id, capability, scope) VALUES ('e20c8b25-e75f-5371-bab6-d9dc9df8379b','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','manage-memberships','own-organization');
INSERT INTO access_administrative_rules (id, role_id, capability, scope) VALUES ('57b41dad-b078-53f6-a277-af855e6ea1d6','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','manage-membership-roles','own-organization');
INSERT INTO access_administrative_rules (id, role_id, capability, scope) VALUES ('71f55bd2-3994-5615-8f1f-9312641e2397','bcabcfe9-b4bb-4fd0-a22c-08a18d34ced0','manage-organization-settings','own-organization');

-- Account ↔ Worker binding (required; role=Member)
CREATE TABLE access_account_worker_member_links (
  account_id VARCHAR(64) PRIMARY KEY,
  worker_id VARCHAR(64) NOT NULL UNIQUE,
  FOREIGN KEY (account_id) REFERENCES access_accounts(id),
  FOREIGN KEY (worker_id) REFERENCES worker(id)
);

-- Authorization must be enforced in the authoritative service/data-access layer. UI visibility is not a security boundary.

-- DATA MANAGEMENT INTEGRITY EXTENSIONS
-- If SQLite is selected, every database connection MUST enable foreign-key enforcement (PRAGMA foreign_keys = ON or framework-equivalent connection initialization).
-- Computed fields are logical/application derivations by default and therefore do not create duplicate authoritative columns in this schema plan.
-- Relationship aggregate computed expressions operate across canonical relationships and remain logical projections unless an explicit materialization/cache strategy is requested.
-- ATTACHMENT LIFECYCLE REQUIREMENTS
-- Before inserting dm_attachments metadata, verify owner_type/owner_id resolves to an existing canonical record.
-- Soft deletion preserves managed files and metadata so restore can reattach them. Permanent purge must remove managed file content and metadata atomically/best-effort transactionally without leaving orphans.
-- Named managed-file fields use dm_attachments.slot_key (or implementation-equivalent metadata) and MUST NOT create duplicate binary/file persistence for the same content.
-- company: generic attachment requirement = none
-- work_area: generic attachment requirement = none
-- chemical_product: generic attachment requirement = none
-- worker: generic attachment requirement = none
-- sds_verification: generic attachment requirement = none
-- training_event: generic attachment requirement = none
-- work_area_product: generic attachment requirement = none
-- work_area_assignment: generic attachment requirement = none
-- hazcom_review: generic attachment requirement = none
-- NAMED FILE SLOT: Chemical Product.sds: cardinality=one; sources=file-upload|url-import|camera-photo
-- ALERT-CAPABLE SOURCE: Work Area.next_review_due: before-date|on-date|after-date|elapsed-since; end-user/product configuration decides if/how alerts are delivered.
-- ALERT-CAPABLE SOURCE: Chemical Product.verification_due: before-date|on-date|after-date|elapsed-since; end-user/product configuration decides if/how alerts are delivered.
-- ALERT-CAPABLE SOURCE: Work Area Assignment.training_required_since: value-change; end-user/product configuration decides if/how alerts are delivered.
-- COMPUTED work_area.next_review_due [date]: {latest_hazcom_review_date} + 12 months
-- COMPUTED work_area.latest_hazcom_review_date [date]: latest_related(024e4f65-976b-4a77-8323-d4b317e693a1, review_date)
-- RECURRING TASK: Work Area: triggerMode=time-interval; 12 months; dueField=next_review_due; derivedNextDue=next_review_due
-- COMPUTED chemical_product.verification_due [date]: {latest_sds_verification_date} + 6 months
-- COMPUTED chemical_product.latest_sds_verification_date [date]: latest_related(7b8f5523-3a5c-4bfa-bf83-e5310911ea7b, verified_at)
-- RECURRING TASK: Chemical Product: triggerMode=time-interval; 6 months; dueField=verification_due; derivedNextDue=verification_due
-- RECURRING TASK: Work Area Assignment: triggerMode=change-event; triggerRule="When a Work Area Assignment is created, set Training Required Since to its Assigned Date. When a Work Area Product is added to the same Work Area, set Training Required Since to that product's Added Date for every active Work Area Assignment in that Work Area. A Training Event dated on or after Training Required Since makes that assignment current until another trigger occurs."; dueField=training_required_since; completionRelationship=609b3aa7-28ab-498b-8b28-287c5232be85; completionDateField=training_date; currentStateRule=completed when latest related completion date is on/after training_required_since; otherwise required
-- REPORTING/PUBLISHING: generate outputs from canonical records and managed attachments; no report-specific persistence table is implied.

-- EXPERIENCE MODEL / AUDIENCE ROUTING
-- Audience is presentation routing over Access roles; it is not a separate Account or authorization model.
-- Audience Workers: roles=Member; startScreenId=f9efce31-c5c2-5e90-8803-3141afd97a74
-- Audience HAZCOM Manager: roles=HAZCOM Manager; startScreenId=59a5ee3e-82de-41e5-99ec-800e09e85c65
-- Audience Administrator: roles=Administrator; startScreenId=59a5ee3e-82de-41e5-99ec-800e09e85c65
-- Screen Company & Access Administration: UI action "Edit Company" requires canonical permission update on Company; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Work Areas: UI action "Add Work Area" requires canonical permission create on Work Area; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Work Area Details: UI action "Edit Work Area" requires canonical permission update on Work Area; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Work Area Details: UI action "Delete Work Area" requires canonical permission delete on Work Area; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Work Area Details: UI action "Add Chemical to Work Area" requires canonical permission create on Work Area Product; deniedBehavior=hide; audiences=all reachable audiences; contextRelationshipId=96db12e7-1201-4f03-8a31-3a8fa6c2ab95.
-- Screen Work Area Details: UI action "Assign Worker" requires canonical permission create on Work Area Assignment; deniedBehavior=hide; audiences=all reachable audiences; contextRelationshipId=2915981b-e56b-4e0b-a619-a1fbcf9a6566.
-- Screen Work Area Details: UI action "Record HAZCOM Review" requires canonical permission create on HAZCOM Review; deniedBehavior=hide; audiences=all reachable audiences; contextRelationshipId=024e4f65-976b-4a77-8323-d4b317e693a1.
-- Screen Work Area Chemical Details: UI action "Edit Work Area Chemical" requires canonical permission update on Work Area Product; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Work Area Chemical Details: UI action "Remove Chemical from Work Area" requires canonical permission delete on Work Area Product; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Chemical Library: UI action "Add Chemical Product" requires canonical permission create on Chemical Product; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Chemical Details: UI action "Edit Chemical Product" requires canonical permission update on Chemical Product; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Chemical Details: UI action "Delete Chemical Product" requires canonical permission delete on Chemical Product; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Chemical Details: UI action "Verify SDS Current" requires canonical permission create on SDS Verification; deniedBehavior=hide; audiences=all reachable audiences; contextRelationshipId=7b8f5523-3a5c-4bfa-bf83-e5310911ea7b.
-- Screen Workers: UI action "Add Worker" requires canonical permission create on Worker; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Worker Details: UI action "Edit Worker" requires canonical permission update on Worker; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Worker Details: UI action "Delete Worker" requires canonical permission delete on Worker; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Assignment Details: UI action "Edit Assignment" requires canonical permission update on Work Area Assignment; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Assignment Details: UI action "End/Delete Assignment" requires canonical permission delete on Work Area Assignment; deniedBehavior=hide; audiences=all reachable audiences.
-- Screen Assignment Details: UI action "Record Training Completion" requires canonical permission create on Training Event; deniedBehavior=hide; audiences=all reachable audiences; contextRelationshipId=609b3aa7-28ab-498b-8b28-287c5232be85.
-- Implement permission-bound controls as UI reflections of server/service authorization. Never use control visibility as the security boundary.
-- Experience Designer screens, Audiences, permission-bound controls, independent screen blocks, canonical navigation actions, context passing, derived queries, and aggregates are application/presentation metadata.
-- Canvas edges and block controls referencing the same navigationId are one canonical action, not independent persistence structures.
-- Derived queries and report projections are logical views over the canonical persistence model by default; do not create duplicate persistence tables merely to render them.
-- Screen visibility and CRUD controls must respect the same canonical role/entity permissions described in the Access Model; UI hiding is never the security boundary.

-- COMMERCIAL RUNTIME PERSISTENCE
-- Reusable Plan definitions are configuration. Runtime purchases/entitlements and Organization coverage are persisted separately from authorization Memberships.
CREATE TABLE commercial_entitlement_instances (
  id VARCHAR(64) PRIMARY KEY,
  plan_id VARCHAR(64) NOT NULL,
  purchaser_type VARCHAR(32) NOT NULL CHECK (purchaser_type IN ('account','organization')),
  purchaser_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL,
  current_period_start DATETIME NULL,
  current_period_end DATETIME NULL,
  grace_ends_at DATETIME NULL,
  access_expires_at DATETIME NULL,
  ended_at DATETIME NULL,
  external_billing_reference VARCHAR(255) NULL
);
CREATE INDEX idx_commercial_entitlement_purchaser ON commercial_entitlement_instances (purchaser_type, purchaser_id);
CREATE INDEX idx_commercial_entitlement_plan ON commercial_entitlement_instances (plan_id);

CREATE TABLE commercial_entitlement_charge_selections (
  entitlement_instance_id VARCHAR(64) NOT NULL,
  charge_component_id VARCHAR(64) NOT NULL,
  pricing_option_id VARCHAR(64) NULL,
  unit_price DECIMAL(18,6) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  billing_cadence VARCHAR(64) NULL,
  PRIMARY KEY (entitlement_instance_id, charge_component_id),
  FOREIGN KEY (entitlement_instance_id) REFERENCES commercial_entitlement_instances(id)
);
-- Store the chosen mutually-exclusive pricing option here (for example Monthly OR Annual). Separate charge-component rows remain additive.

CREATE TABLE commercial_organization_coverage (
  id VARCHAR(64) PRIMARY KEY,
  entitlement_instance_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL,
  covered_from DATETIME NOT NULL,
  covered_until DATETIME NULL,
  transferred_from_coverage_id VARCHAR(64) NULL,
  FOREIGN KEY (entitlement_instance_id) REFERENCES commercial_entitlement_instances(id)
);
CREATE INDEX idx_commercial_coverage_org ON commercial_organization_coverage (organization_id);
CREATE INDEX idx_commercial_coverage_entitlement ON commercial_organization_coverage (entitlement_instance_id);
-- Coverage transfer changes the entitlement/coverage rows only. Do not move Organization data or silently alter Memberships.

CREATE TABLE commercial_retention_state (
  entitlement_instance_id VARCHAR(64) PRIMARY KEY,
  structured_data_delete_after DATETIME NULL,
  managed_files_delete_after DATETIME NULL,
  backups_delete_after DATETIME NULL,
  final_behavior VARCHAR(32) NOT NULL,
  FOREIGN KEY (entitlement_instance_id) REFERENCES commercial_entitlement_instances(id)
);
