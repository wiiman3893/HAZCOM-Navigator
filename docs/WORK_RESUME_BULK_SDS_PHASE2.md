# Bulk SDS Import Phase 2 - work in progress

Starting origin/main: `8eea1b50cb32b281251636a7a13cd030013b1ad0`.
Task branch: `work/bulk-sds-phase2-2026-09-28`.

Checkpoint 1 (`b8956cf`) implements schema 5 extraction/review evidence, deterministic normalization, Sections 1-16 parsing, Product field proposals with evidence/confidence, persisted field corrections, Company isolation, and schema compatibility in native workspaces and Diagnostics.

Checkpoint 2 implements explicit reviewed-candidate approval, a schema 6 immutable materialization audit link, and native lossless page-copy materialization through `lopdf`. The native service verifies source ownership, page range, output validity/count, 5 MiB limit, hash, size, and deterministic repeat output. Only after that succeeds does one SQLite transaction create the Product, ownership, current SDS attachment, integrity row, provenance, history, and approval state. The existing batch UI now exposes field corrections, evidence/confidence, save-review, and explicit approve/create controls. Extraction alone still creates no Product. No deployment or real Firebase mutation.

OCR direction: use a replaceable native service boundary. The leading packaged-Windows option is Windows.Data.Pdf rendering plus Windows.Media.Ocr, which is offline and avoids distributing an OCR engine/model, but availability depends on installed Windows OCR language support. OCR failure will remain manual-review state. This is not yet implemented or validated.

Validation at checkpoint 2:

- `npm run test:authoring`: 17 passed
- `node scripts/validate-sqlite.mjs`: passed
- `npm run test:diagnostics`: 16 passed
- `npm run build`: passed
- native library tests: 19 passed

DO NOT CLAIM YET: offline OCR, update-existing-Product assistance, duplicate suggestions, large-batch cancellation/progress, or publication/replica acceptance for a materialized child.

Exact next action: implement the replaceable offline OCR boundary for pages still marked `pending`, starting with Windows PDF rendering/OCR availability detection and safe per-page failure persistence; then add a publication/replica acceptance test for the approved child SDS.
