# Bulk SDS Import Phase 2 - work in progress

Starting origin/main: `8eea1b50cb32b281251636a7a13cd030013b1ad0`.
Task branch: `work/bulk-sds-phase2-2026-09-28`.

Checkpoint 1 (`b8956cf`) implements schema 5 extraction/review evidence, deterministic normalization, Sections 1-16 parsing, Product field proposals with evidence/confidence, persisted field corrections, Company isolation, and schema compatibility in native workspaces and Diagnostics.

Checkpoint 2 (`c617076`) implements explicit reviewed-candidate approval, a schema 6 immutable materialization audit link, and native lossless page-copy materialization through `lopdf`. The native service verifies source ownership, page range, output validity/count, 5 MiB limit, hash, size, and deterministic repeat output. Only after that succeeds does one SQLite transaction create the Product, ownership, current SDS attachment, integrity row, provenance, history, and approval state. The existing batch UI now exposes field corrections, evidence/confidence, save-review, and explicit approve/create controls. Extraction alone still creates no Product. A focused test proves that the resulting child is discovered by the unchanged publication projection with matching Product identity, hash, and size. No deployment or real Firebase mutation.

Checkpoint 3 (`e8eec05`) implements the native offline OCR boundary with `Windows.Data.Pdf` rendering and `Windows.Media.Ocr`, selected-workspace/session path containment, installed recognizer-language detection, bounded page rendering/text, safe categorized failure codes, persisted per-page completion/failure/version state, retry/resume without reprocessing completed pages, and batch progress counts. Missing OCR language/platform support and unusable recognized text remain manual-review states; Windows language packs are never changed automatically. Mixed pages retain their embedded text plus OCR text. Re-extraction preserves reviewed values and now records each field's actual evidence-page source (`embedded`, `ocr`, or truly `mixed`) instead of applying candidate-wide OCR provenance. Diagnostics records only OCR operation outcomes and duration, never SDS/OCR contents.

The native acceptance fixture is a generated image-only PDF containing raster pixels and no PDF text objects. On the checkpoint host, Windows OCR was available with `en-US`; it recognized the synthetic Product name and CAS number. Service tests also prove two-page image-only processing, extraction persistence across service restart, completed-page reuse, mixed-page preservation, missing-language fallback, and unusable-text fallback. The current batch runner is sequential, saves after every page, and can be safely resumed; an explicit mid-run cancellation control is not yet implemented.

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

DO NOT CLAIM YET: explicit mid-run OCR cancellation, existing-Product update, duplicate suggestions, approved-child backup/restore acceptance, emulator publication, independent replica import, larger-batch resilience, broad final regression, or integration to main.

Exact next action: implement the explicit existing-Product update path with stable Product identity, prior current SDS history preservation, staged-child verification before one logical commit, and adversarial failure tests proving the prior Product/SDS remains intact.
