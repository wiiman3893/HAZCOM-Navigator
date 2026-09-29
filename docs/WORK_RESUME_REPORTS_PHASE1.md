# Reports & Export Phase 1

## Current checkpoint

The first customer-facing report is complete on `work/reports-export-phase1-2026-09-28`.

The Reports & Export screen now keeps the existing publication panel and adds:

- a Company HazCom Summary derived from the canonical authoring summary;
- Chemical Inventory by Work Area;
- active Work Area and Product/CAS filters;
- deterministic UTF-8 CSV download.

The report layer is a pure, read-only projection of the selected workspace's already Company-scoped authoring snapshot. It performs no SQL, network calls, or domain writes. Active placements, active Products, and active Work Areas are included. Empty active Work Areas remain visible. Removed placements and trashed records are excluded. The same Product can appear in each Work Area where it is actively placed.

Chemical Inventory CSV columns are fixed as: Work Area, Work Area Location, Product Name, Manufacturer, CAS Numbers, Quantity, Storage Location, SDS Date, SDS Present, and SDS Verification Status. Values use RFC-style quoting for commas, quotes, and line breaks. Internal IDs, diagnostics, and SDS contents are excluded.

Diagnostics records only `report.open` and `report.export` outcomes with the report category, row count, and byte count. It does not record report content or customer field values.

## Validation at checkpoint 1

- `npm run build`: passed.
- `npm run test:authoring`: 28 passed.
- `npm run test:diagnostics`: 16 passed.
- `npm run test:authoring:ui`: 13 passed.

The UI test downloads and checks the inventory CSV, filters by CAS, and switches to a separate empty Company workspace to prove that report rows do not leak across the selected Company.

## Known limitations

- Compliance Status and Training Status reports are not yet implemented at this checkpoint.
- CSV is available for Chemical Inventory only.
- Reports render the bounded in-memory authoring snapshot; there is no report pagination.
- The web download uses the browser's safe download path and does not choose an arbitrary filesystem destination.

## Exact next action

Add a deterministic Compliance Status projection using existing Product SDS and Work Area review status fields, with focused required/current/approaching/overdue/missing-SDS tests, then expose it beside Chemical Inventory and add its CSV export.
