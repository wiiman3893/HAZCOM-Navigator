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
