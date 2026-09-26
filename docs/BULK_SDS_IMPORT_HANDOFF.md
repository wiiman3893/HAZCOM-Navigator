# Bulk SDS Import handoff

## Milestone

Windows Bulk SDS Import milestone 1 adds a local review-draft workflow for one multi-page PDF containing one or many SDS documents.

User flow:

Chemical Library -> Import SDS Batch -> choose one PDF -> analyze pages -> review proposed candidates -> Split Here / Merge With Previous / Merge With Next -> Save review drafts.

No Chemical Products are created by this milestone.

## Local data model

Migration `004_bulk_sds_import.sql` adds three local-only tables:

- `sds_import_session`: Company-scoped source batch metadata, managed source path, SHA-256, byte size, page count, imported timestamp, and review status.
- `sds_import_page`: one row per source page with bounded extracted-text snippet, OCR-required marker, and deterministic detection signals.
- `sds_import_draft`: persisted candidate SDS page ranges with confidence, reason, optional detected title, and review state.

These records are not part of the authoritative Chemical Product model and are not included in publication.

## Managed-file behavior

The user's selected source file is never modified in place.

Windows copies the source PDF into application-managed local storage through the Tauri file boundary. Existing individual product SDS attachments retain their 5 MiB limit. Bulk source PDFs have a separate 250 MiB limit.

The session records:

- source filename
- managed relative source path
- SHA-256
- source byte size
- page count
- imported timestamp
- status

The source hash and byte size are computed before persistence.

## Page-level text extraction

`packages/authoring/src/pdf-import.js` contains a deterministic, dependency-free first-pass PDF analyzer.

It walks the PDF page tree where available, resolves page content streams, handles uncompressed and Flate-compressed streams, and extracts literal/TJ/hex text operators inside text objects.

A page with insufficient useful alphanumeric text is marked `OCR REQUIRED`.

Image-only/scanned PDFs remain valid imports. OCR is not required for manual segmentation.

Known parser limitation: this milestone intentionally does not implement the full PDF specification. PDFs that rely on object streams, complex font encodings/CMaps, or unusual content structures may be classified as having no useful embedded text. Those pages fall back to OCR-required/manual review rather than being treated as confidently parsed.

## Boundary heuristics

Candidate starts are conservative and use combinations of:

- source page 1
- Safety Data Sheet heading
- SECTION 1
- Page 1 of X / page-number reset
- SECTION 16 shortly before a subsequent SECTION 1

Strong combinations are labeled `likely`. Weaker SECTION 1-only transitions are labeled `uncertain`.

Each candidate preserves:

- start page
- end page
- confidence
- human-readable reason
- lightweight detected title when available
- source session relationship

The detector always emits contiguous ranges covering every source page exactly once.

## Review workflow

The Windows review screen lists the source batch and candidate ranges. Each candidate shows the page range, detected title or Unknown product, confidence/reason, OCR-required count, and a starting-page snippet when available.

Edits are persisted immediately:

- Split Here: split before a selected page inside the candidate
- Merge With Previous
- Merge With Next

Manual edits are marked as manual adjustments.

Save review drafts marks the session as `review_drafts_saved`. It still does not create Chemical Products.

## Manual fallback

Manual segmentation is always available, including when every page is OCR-required or automatic detection produces only one full-document candidate.

Range rewrite validation requires exact source-page coverage with no gaps, overlaps, or dropped pages.

## Tests

Focused authoring tests cover:

- one SDS
- several text SDSs
- repeated SECTION 1
- page-number reset signal
- uncertain boundary
- image-only/no-text PDF
- Split Here
- Merge With Previous
- Merge With Next
- restart persistence
- source SHA-256 and size integrity
- no disappearing pages
- Company scope isolation

The Windows Playwright harness covers importing an image-only three-page batch, splitting it, merging it, and saving review drafts.

## Schema-4 Windows acceptance (September 26, 2026)

The Tauri startup registers migrations 1–4 with `tauri-plugin-sql` 2.4.1. Its load command builds a SQLx `Migrator` from those specs and calls the SQLite pool's migration runner. SQLx runs each migration and its migration-ledger insert in one transaction (`no_tx=false`). `apps/windows/src-tauri/src/lib.rs` now shares its production migration list with an acceptance test that runs the same SQLx migration engine.

The native acceptance test passed against both a synthetic schema-3 fixture and a temporary copy of the current Windows workspace. Read-only diagnostics first established that the original workspace was schema 3, `integrity_check=ok`, with 2 Work Areas, 3 Chemical Products, 1 Worker, 2 Work Area Products, 2 Assignments, 3 SDS Verifications, 2 HAZCOM Reviews, 2 Training Events, and 3 verified SDS attachments. Only the copy received migration 4. Its Tauri/SQLx ledger advanced from 3 to 4. The test compared every column of every pre-existing SQLite table row before and after migration, excluding only SQLx's migration ledger and the three new import tables; it also explicitly compared SDS attachment identity/path/size/hash tuples. New-table indexes and foreign keys were present, `foreign_key_check` remained empty, `integrity_check` returned `ok`, and reopening with the same migrator was a no-op. A separate forced SQL error confirmed transactional rollback leaves no new tables and keeps the ledger at 3. The original app database remains unchanged at schema 3 pending its next normal native app open.

The `scripts/validate-schema4-copy.mjs` harness then ran the existing authoring service against that migrated copy with a synthetic three-page PDF. It verified Company ownership, source size and SHA-256, three persisted page rows, manual Split Here and Merge With Previous, saved draft state after closing/reopening SQLite, contiguous page coverage `[1,2,3]`, unchanged Chemical Product count, and clean SQLite integrity/foreign keys. The source PDF and all writes were confined to the temporary copy and its temporary attachment directory. The six-test Windows Playwright suite also passed, including the Bulk SDS UI split/merge/save flow. These UI tests use the existing browser harness; no separate visual check of a packaged native app was performed.

Diagnostics read the migrated copy without writing to it and reported source schema 4, applied ledger schema 4, `migrationPending=false`, authoring/publication projection PASS, one imported session in `review_drafts_saved`, and verified original SDS files. In quick mode, the overall result remained WARN because quick mode skips live cloud checks and the task branch had local changes; there was no schema-4 warning.

Reproduce the migrated-copy import check by first making a disposable copy of a schema-3 database and running the native SQLx migration acceptance test against the copy with `HAZCOM_SCHEMA3_FIXTURE_DB=<copy path>`. Then set `HAZCOM_SCHEMA4_COPY_DB=<migrated copy path>` and `HAZCOM_SCHEMA4_COMPANY_ID=<Company ID>` and run `node scripts/validate-schema4-copy.mjs`. That script refuses to write outside the operating-system temporary directory. Never point it at the installed database.

The Windows frontend and optimized native Tauri executable build successfully with `npm run tauri -w @hazcom/windows -- build --no-bundle`. Vite emits its existing advisory that the minified main JavaScript chunk exceeds 500 kB; this does not fail the build. A Windows installer was not produced because neither WiX nor NSIS is installed in the environment. The documented native launch command remains `npm run tauri -w @hazcom/windows -- dev` from the repository root.

## Known limitations

- No OCR engine yet.
- No AI/LLM extraction.
- No authoritative manufacturer/date/CAS/hazard extraction.
- No PDF thumbnail rendering.
- No child SDS PDF materialization yet; candidates currently retain auditable source page ranges.
- Embedded-text extraction is intentionally conservative and not a full PDF implementation.
- No Chemical Product creation/update from drafts yet.

## Exact next milestone

Add the review-to-extraction pipeline:

OCR/text normalization -> SDS section parsing -> product/manufacturer/revision-date/CAS extraction -> field-level confidence -> human review -> deterministic child-PDF generation from approved ranges -> create/update Chemical Products and attach the resulting managed SDS PDF.

Approved child PDFs must retain source import session ID, source page range, source SHA-256, child SHA-256, and byte size for traceability.
