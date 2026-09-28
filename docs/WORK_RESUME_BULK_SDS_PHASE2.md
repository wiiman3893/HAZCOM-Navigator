# Bulk SDS Import Phase 2 - work in progress

Starting origin/main: `8eea1b50cb32b281251636a7a13cd030013b1ad0`.
Task branch: `work/bulk-sds-phase2-2026-09-28`.

Checkpoint 1 is implemented: schema 5 extraction/review evidence, deterministic normalization, Sections 1-16 parsing, Product field proposals with evidence/confidence, persisted field corrections, Company isolation, and schema compatibility in native workspaces and Diagnostics. Existing phase-one source/boundary behavior is preserved. No Product creation or SDS replacement occurs from extraction. No deployment or real Firebase mutation.

OCR direction: use a replaceable native service boundary. The leading packaged-Windows option is Windows.Data.Pdf rendering plus Windows.Media.Ocr, which is offline and avoids distributing an OCR engine/model, but availability depends on installed Windows OCR language support. OCR failure will remain manual-review state. This is not yet implemented or validated.

DO NOT CLAIM YET: OCR, child PDF materialization, approval, Product create/update, duplicate assistance, publication/replica proof, or complete Phase 2 integration.

Validation at checkpoint 1:

- `npm run test:authoring`: 16 passed
- `node scripts/validate-sqlite.mjs`: passed
- `npm run test:diagnostics`: 16 passed
- native `migration_acceptance`: 2 passed

Exact next action: implement explicit approval plus atomically verified child-PDF materialization through a replaceable native PDF service, then connect the approved create path to the existing Chemical Product and managed SDS services.
