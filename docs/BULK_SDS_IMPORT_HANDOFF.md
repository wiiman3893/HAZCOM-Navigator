# Bulk SDS Import Phase 2 handoff

## Implemented workflow

The Windows Chemical Library can import one multi-page PDF, preserve the original in Company-scoped managed storage, detect and manually edit candidate boundaries, extract SDS fields, run offline Windows OCR only on pages that need it, require human review, and materialize an approved page range as a deterministic child PDF.

Approval always requires an explicit choice to create a new Chemical Product or update a specifically selected existing Chemical Product. Extraction alone never creates or changes authoritative Product data.

## Local data and file contracts

Migrations 4–6 add local-only import sessions, pages, drafts, raw/normalized page text, OCR state, parsed sections, reviewed fields, candidate approval state, and immutable materialization provenance. Provenance links the source session/SHA/page range to the child Product, attachment, path, SHA-256, size, page count, materialization version, and timestamp.

The source PDF is capped at 250 MiB and is never changed in place. An approved child uses the existing Product SDS contract and 5 MiB limit. Import-review tables are excluded from publication and backup. Once approved, Product, attachment, integrity metadata, and SDS bytes are ordinary authoritative Company data and use those existing systems.

## Embedded text and boundaries

The deterministic first-pass parser handles common page trees, uncompressed and Flate streams, and literal/TJ/hex text operators. It is intentionally conservative. Unsupported object streams, font encodings/CMaps, or unusual content may cause a page to require OCR.

Boundary proposals use Safety Data Sheet/SECTION 1 signals, page-number resets, and SECTION 16 followed by a new SECTION 1. Every source page remains in exactly one contiguous candidate. Split and merge controls remain available even when all pages need OCR.

## Native Windows OCR

`apps/windows/src-tauri/src/sds_ocr.rs` uses narrow Windows Rust bindings for `Windows.Data.Pdf`, `Windows.Media.Ocr`, and the required bitmap/storage/stream APIs. Processing is local and offline.

The renderer caps the longest image dimension at the smaller of the Windows OCR maximum and 2400 pixels. OCR text is capped at 256 KiB per page. The selected workspace token, Company-owned session, canonical managed root, relative path, and page range are checked before rendering. Blocking WinRT calls run on Tauri's blocking worker pool.

Availability distinguishes `available`, `language_support_missing`, `platform_unavailable`, and `engine_creation_failed`. The recognizer comes from installed Windows OCR languages; HazCom Navigator never installs or changes language packs. Persisted safe failures distinguish source/PDF render/bitmap/page/task/range/text-size and unusable-text failures.

Completed version-1 pages are not processed again. Failed pages remain retryable. Missing platform/language support and unusable results become `manual_required`; the batch, boundaries, reviewed fields, and manual-entry path remain usable. Mixed pages retain sparse embedded text plus OCR text and are labeled `mixed`.

The UI shows required, completed, failed, and manual-action counts. Processing is sequential and commits after each page, so close/retry safely resumes. There is no explicit mid-run Cancel button yet.

## Extraction and provenance

Normalized text uses Unicode NFKC, line-ending/whitespace normalization, and conservative SECTION-heading repair. Sections 1–16 retain bounded evidence and source pages. Proposed fields cover Product name, manufacturer, SDS/revision date, and checksum-valid CAS numbers.

Each field records its actual evidence section, page, bounded evidence, confidence, and source method. Product name from an embedded page remains `embedded` even if another page used OCR. Manufacturer from an OCR page is `ocr`. CAS is `mixed` only when accepted CAS evidence spans multiple source methods.

Users can confirm, correct, or clear proposed values. Required Product fields must be reviewed before approval.

## Approval and SDS history

Native `lopdf` materialization copies only the approved original pages in order, validates output/page count/size, reloads it, and computes SHA-256. Repeated materialization of the same source/range is deterministic.

Create approval verifies and stages the child before one authoring transaction creates Product, ownership, current SDS, integrity, provenance, history, and approval state.

Update approval requires a selected active Product owned by the current Company. It preserves stable Product ID, unextracted chemical names, Work Area relationships, Training history, and SDS Verification Events. The former current SDS becomes `sds_history`; reviewed fields and the new current SDS are written with provenance and approval in one authoring transaction. It does not create an SDS Verification Event automatically.

Child verification or managed-file staging failure leaves the prior Product/current SDS/integrity state intact and the candidate unapproved. Cross-Company and deleted Product targets are rejected by existing scope checks.

## Backup, publication, and independent replica proof

Native acceptance creates an approved Bulk Product/SDS, backs up the Company, restores it into an isolated workspace, and verifies Product values, SDS bytes, size, and SHA-256. Unfinished Bulk sessions are deliberately excluded; approved authoritative data survives normally.

The restored workspace publishes through the existing schema-2 emulator path: begin, chunk stage, SDS upload, seal, paged validation, and atomic finalize. The published revision contains the Product and child SDS using the ordinary schema and no import-review tables.

A separate empty SQLite replica downloads the revision/SDS, verifies integrity, and atomically activates it. A corrupted SDS download is rejected while revision 1 remains active. A subsequent valid revision-2 sync succeeds and activates atomically.

No deployment or real Firebase mutation was performed. Emulator guards require project `demo-hazcom-navigator`.

## Diagnostics and validation

Diagnostics allowlist metadata-only OCR page/batch and Product creation/update operations. Raw OCR/SDS text, Product/manufacturer/CAS values, and customer paths are never included.

Focused evidence on September 28, 2026:

- native OCR: Windows `en-US` available; a generated raster-only PDF recognized expected Product/CAS text;
- authoring: 24 tests for image-only/mixed provenance, persistence, unavailable/unusable fallback, explicit update, hash/write failure safety, and a 50-page retry/resume batch;
- Windows UI: full OCR-to-existing-Product approval scenario passed;
- native backup/restore: approved child round trip passed;
- schema-2 emulator: approved child publication, interrupted retries, independent replica, corruption rollback, and revision-2 activation passed.

## Remaining limitations

- No explicit mid-run OCR cancellation control; completed-page persistence provides close/reopen resume.
- No fuzzy duplicate/revision suggestions. Users explicitly select update targets; the app never auto-merges or auto-replaces.
- No AI/LLM or remote OCR service.
- Embedded parsing is conservative, and Windows OCR quality depends on installed language support and scan quality.
- No PDF thumbnail UI.
