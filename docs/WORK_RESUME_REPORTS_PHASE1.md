# Reports & Export Phase 1

## Current checkpoint

Reports & Export Phase 1 is complete and integrated into remote `main` at:

`f1a7d5d72b1f2d1bd5040b0e477dcc83bf7d7771`

The completed task branch remains available at:

`work/reports-export-phase1-2026-09-28`

The Reports & Export screen keeps the existing publication panel and adds:

- a Company HazCom Summary derived from the canonical authoring summary;
- Chemical Inventory by Work Area;
- Compliance Status across Chemical Products and Work Areas;
- Training Status for active assignments, with an optional ended-assignment view;
- active Work Area and Product/manufacturer/CAS filtering where appropriate;
- deterministic UTF-8 CSV download for all three operational reports.

The report layer is a pure, read-only projection of the selected workspace's already Company-scoped authoring snapshot. It performs no report-specific SQL, network calls, or domain writes. Active placements, active Products, and active Work Areas are included. Empty active Work Areas remain visible. Removed placements and trashed records are excluded. The same Product can appear in each Work Area where it is actively placed.

Chemical Inventory CSV columns are fixed as: Work Area, Work Area Location, Product Name, Manufacturer, CAS Numbers, Quantity, Storage Location, SDS Date, SDS Present, and SDS Verification Status. Compliance CSV uses Category, Item, Context, SDS Present, Most Recent Event, Next Due, and Tracked Status. Training CSV uses Worker, Work Area, Assignment Date, Assignment Ended Date, Training Required Since, Most Recent Training, and Training Status. Values use CSV quoting for commas, quotes, and line breaks. Internal IDs, diagnostics, and SDS contents are excluded.

Compliance Status uses the canonical Product SDS and Work Area review values from the snapshot: current, required, approaching, overdue, plus missing SDS. It explicitly describes tracked application state and does not claim that a Company is compliant, noncompliant, or certified. Training Status uses canonical assignment activity and training status without changing Training Event semantics.

Diagnostics records only `report.open` and `report.export` outcomes with the report category, row count, byte count, and result metadata. It does not record report content or customer field values.

## Final validation and integration

Completed validation for the integrated milestone includes:

- `npm run test:authoring`: 30 passed;
- `npm run test:diagnostics`: 16 passed;
- `npm run test:authoring:ui`: 13 passed;
- native workspace/report isolation scenario: passed;
- full `npm test`: passed;
- full `npm run build`: passed;
- `git diff --check`: passed.

The UI acceptance downloads and checks report CSV output, filters Chemical Inventory by CAS, exercises Compliance and Training views, and switches to a separate Company workspace to prove that report rows do not leak across the selected Company.

The native workspace scenario compares the primary workspace with an edited restored workspace and proves the generated Chemical Inventory reflects the selected workspace while stale-session protections remain intact.

Remote `main` and `work/reports-export-phase1-2026-09-28` were both verified at `f1a7d5d72b1f2d1bd5040b0e477dcc83bf7d7771` after integration.

## Known limitations

- Reports render the bounded in-memory authoring snapshot; there is no report pagination.
- CSV export uses the browser/Tauri webview's safe download mechanism and does not provide a custom save-location dialog.
- PDF reports and a generic report designer are not implemented.
- Additional formats, filters, or pagination should be driven by measured product need rather than added speculatively.

## Next action

Reports & Export Phase 1 requires no additional implementation work. Collect product feedback before extending report formats, filters, or pagination. Future project work should proceed from the current implementation roadmap in `IMPLEMENTATION_STATUS.md`.
