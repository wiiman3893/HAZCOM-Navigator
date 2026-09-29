# Bulk SDS Import Phase 2 - work in progress

Starting origin/main: `8eea1b50cb32b281251636a7a13cd030013b1ad0`.
Task branch: `work/bulk-sds-phase2-2026-09-28`.

Checkpoint 1 (`b8956cf`) implements schema 5 extraction/review evidence, deterministic normalization, Sections 1-16 parsing, Product field proposals with evidence/confidence, persisted field corrections, Company isolation, and schema compatibility in native workspaces and Diagnostics.

Checkpoint 2 (`c617076`) implements explicit reviewed-candidate approval, a schema 6 immutable materialization audit link, and native lossless page-copy materialization through `lopdf`. The native service verifies source ownership, page range, output validity/count, 5 MiB limit, hash, size, and deterministic repeat output. Only after that succeeds does one SQLite transaction create the Product, ownership, current SDS attachment, integrity row, provenance, history, and approval state. The existing batch UI now exposes field corrections, evidence/confidence, save-review, and explicit approve/create controls. Extraction alone still creates no Product. A focused test proves that the resulting child is discovered by the unchanged publication projection with matching Product identity, hash, and size. No deployment or real Firebase mutation.

Checkpoint 3 (`e8eec05`) implements the native offline OCR boundary with `Windows.Data.Pdf` rendering and `Windows.Media.Ocr`, selected-workspace/session path containment, installed recognizer-language detection, bounded page rendering/text, safe categorized failure codes, persisted per-page completion/failure/version state, retry/resume without reprocessing completed pages, and batch progress counts. Missing OCR language/platform support and unusable recognized text remain manual-review states; Windows language packs are never changed automatically. Mixed pages retain their embedded text plus OCR text. Re-extraction preserves reviewed values and now records each field's actual evidence-page source (`embedded`, `ocr`, or truly `mixed`) instead of applying candidate-wide OCR provenance. Diagnostics records only OCR operation outcomes and duration, never SDS/OCR contents.

The native acceptance fixture is a generated image-only PDF containing raster pixels and no PDF text objects. On the checkpoint host, Windows OCR was available with `en-US`; it recognized the synthetic Product name and CAS number. Service tests also prove two-page image-only processing, extraction persistence across service restart, completed-page reuse, mixed-page preservation, missing-language fallback, and unusable-text fallback. The current batch runner is sequential, saves after every page, and can be safely resumed; an explicit mid-run cancellation control is not yet implemented.

Checkpoint 4 (`a95c103`) adds the explicit existing-Product approval choice. Update requires an active Company-owned Product, preserves its stable ID, unextracted chemical names, Work Area Product relationships, and SDS Verification Events, moves the former current SDS to `sds_history`, and writes the reviewed Product fields, verified child attachment/integrity, immutable materialization link, history, and approval state in one authoring commit. Child hash/page verification and managed-file staging happen before that commit. Focused adversarial tests prove both child hash rejection and forced managed-file write failure leave the prior Product, current SDS, integrity state, and unapproved candidate intact. Diagnostics distinguishes metadata-only `sds_batch.product_created` and `sds_batch.product_updated` operations.

The Windows batch UI now requires a visible create/update choice and, for update, an explicit existing Product selection. Its acceptance test covers OCR, persisted field refresh, and update approval. That test found and fixed stale form state after OCR: the visible fields now refresh when the persisted extraction values change.

Checkpoint 5 (`073c10a`) extends the existing native workspace and Firebase emulator harnesses with an approved Bulk child. Backup v2 restores the authoritative Product and SDS into an isolated native workspace with matching bytes, size, and SHA-256. Unfinished/import-review tables remain intentionally outside the backup contract. The restored authoring workspace then publishes through the ordinary schema-2 staged Functions/Firestore/Storage path; no Bulk-specific cloud data is introduced. A fresh independent SQLite replica downloads and activates the published Product/SDS. A deliberately corrupted SDS download is rejected while the prior replica state remains active, followed by successful revision-2 synchronization and atomic activation.

Checkpoint 6 (`af7fe15`) adds a moderate 50-page OCR resilience case. One injected page failure does not invalidate the other 49 completed pages; the next run retries only the failed page, a third run performs no OCR calls, SQLite state remains consistent, and no Product is created without approval.

Validation at checkpoint 2:

- `npm run test:authoring`: 17 passed
- `node scripts/validate-sqlite.mjs`: passed
- `npm run test:diagnostics`: 16 passed
- `npm run build`: passed
- native library tests: 19 passed

Validation at checkpoint 3:

- native OCR focused tests: 2 passed (`en-US` available; image-only raster PDF recognized)
- `npm run test:authoring`: 21 passed
- `npm run test:diagnostics`: 16 passed
- `npm run test:authoring:ui`: 12 passed
- `npm run build`: passed (Windows and mobile production builds; existing Windows chunk-size warning only)
- `git diff --check`: passed before checkpoint commit

Validation at checkpoint 4:

- `npm run test:authoring`: 23 passed
- `npm run test:diagnostics`: 16 passed
- `npm run test:authoring:ui`: 12 passed before expanding the Bulk scenario
- focused expanded Bulk UI acceptance: 1 passed (OCR through existing-Product update)
- post-checkpoint moderate suite: `npm run test:authoring` 24 passed

Validation at checkpoint 5:

- focused native authoring/backup/restore acceptance: passed
- `npm run test:windows:publication:emulator`: passed
- emulator proof included begin/stage/upload/seal/validate/finalize, interrupted upload retry, lost-finalization recovery, approved Bulk Product/SDS reads, clean independent replica import, corrupted-download fallback, and revision-2 activation
- Firebase project guard used only `demo-hazcom-navigator`; no deployment and no real Firebase mutation

DO NOT CLAIM YET: explicit mid-run OCR cancellation, duplicate suggestions, broad final regression, or integration to main.

Exact next action: run the complete regression bar, fix any concrete regression, then integrate to main only if every required suite is clean.
