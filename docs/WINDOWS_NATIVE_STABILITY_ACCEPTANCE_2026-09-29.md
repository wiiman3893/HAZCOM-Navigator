# Windows native stability acceptance — 2026-09-29

## Decision

HazCom Navigator is ready for hands-on development SDS testing with one evidence limitation: this Work environment could launch and inspect the real Windows window/process, but its Computer Use inventory exposed no native application surfaces, so it could not click through the Tauri window. The release executable built, opened a responsive `HazCom Navigator` window, closed, reopened with a new window handle, and remained running without an immediate panic, configuration failure, migration crash, blank-process exit, or restart failure. Existing native Rust/Tauri tests exercised the Windows implementations behind SDS, OCR, SQLite workspaces, diagnostics, backup/restore, migrations, offline authorization, and publication. The existing Playwright harness supplied interaction coverage and is identified separately below.

This is a development acceptance checkpoint, not a production-readiness or signed-release declaration. No production Firebase resource, OAuth credential, signing secret, billing configuration, certificate, or user workspace was changed.

## Scope and starting point

- Repository: `wiiman3893/HAZCOM-Navigator`
- Starting and fetched `origin/main`: `138d56cfb2adb6269306750b0c9c4231f7a717e4`
- Task branch: `work/windows-native-stability-acceptance-2026-09-29`
- Configuration used for the executable: the checked-in development public Firebase values from `.env.example`, copied to ignored `.env.local`; no private key or production secret was created.
- Test data: synthetic Companies, local/emulated accounts, disposable SQLite workspaces, and generated PDFs only.

## Evidence boundaries

### Real executable/process evidence

- `npm run tauri -w @hazcom/windows -- build` produced `hazcom-navigator.exe` and, after the bundle-icon repair, both MSI and NSIS bundles.
- The release executable opened a responsive window with title `HazCom Navigator` and a nonzero native window handle.
- A clean close followed by a second launch produced another responsive `HazCom Navigator` window with a different process/window handle.
- Tauri development execution also compiled and launched `target\debug\hazcom-navigator.exe` without a Rust panic or fatal console error.
- The Work native-app inventory returned no app/window objects even while Windows reported the real window. No claim below treats browser clicks as native-window clicks.

### Real native Rust/Tauri evidence

The 27-test native suite passed. It exercised:

- native Windows OCR availability and image-only PDF recognition;
- deterministic child-PDF creation and invalid-range rejection;
- managed SDS path, size, hash, retry, and ownership checks;
- native Company workspace routing, stale lease rejection, atomic switching, and isolation;
- the representative authoring graph, events, trash/restore, Bulk review restart, SDS reads, backup v2 round trip, and independent restored workspaces;
- native diagnostics lifecycle, markers, restart recovery, bounded queues, sanitized ZIP export, corruption rejection, and business-file survival under diagnostic failures;
- native backup restore staging, integrity checks, atomic activation, and corrupt-SDS rejection;
- schema 3 through 6 migration, existing-row/SDS metadata preservation, idempotent reopen, and failed-migration rollback;
- signed offline lease verification, Windows user-protected cache behavior, expiry, scope, corruption, and account-scoped removal;
- hardened system-browser login relay guards.

The native publication emulator test also passed the real Rust/SQLite path through emulated Auth, Functions, Firestore, and Storage. It published restored workspace A, imported the immutable revision into an independent replica, preserved the prior replica on corruption, retried interruption safely, kept workspace A/B journals and SDS independent, and left the primary journal untouched.

### Browser interaction evidence

The 20-test Windows interaction harness passed. It covered navigation; form preservation; Work Area create/edit/trash/restore; Chemical Product and SDS replacement; SDS verification; Worker assignment and Training Event; HazCom Review Event; role routing; Reports and CSV; publication UI; Demo/grace/read-only restrictions; Bulk SDS split/merge/OCR/review/update; Diagnostics hotkey/start/marker/stop/export; persisted session gates; offline/read-only/reconnect behavior; and restored-workspace selection/failure handling.

These tests render the real React application with purpose-built local adapters. They are interaction and projection evidence, not proof that the same clicks occurred in the native WebView during this run.

### Firebase emulator evidence

- All 25 Functions/Rules/Storage tests passed against `demo-hazcom-navigator` emulators.
- The persisted Firebase Auth test passed across a browser-process restart and verified sign-out removal.
- No production or development-cloud write was made by this acceptance pass.

## Synthetic SDS acceptance set

The suites generated disposable PDFs rather than adding customer-like documents to the repository:

1. Text PDFs contained synthetic identification, manufacturer, CAS, hazard/section, and revision text and exercised normal SDS import, verification, extraction, Product creation/update, publication, and backup.
2. The native Rust fixture created an image-only SDS page. Windows `Windows.Data.Pdf` plus `Windows.Media.Ocr` actually ran and recognized `SYNTHETIC CLEANER`, manufacturer text, CAS `67-64-1`, and revision date `2026-09-28`.
3. Multi-page synthetic batches exercised repeated Section 1/16 boundaries, uncertain boundaries, manual split/merge, embedded text, an OCR-required three-page stack, saved review drafts, restart, deterministic child PDF materialization, new Product approval, and existing Product update with prior SDS history retained.

The generated PDFs and disposable workspaces were test artifacts; no proprietary SDS content was downloaded or committed.

## Workflow acceptance results

| Area | Result | Strongest evidence |
| --- | --- | --- |
| Startup/restart | Pass with UI automation limitation | Real release window/process launched twice and responded |
| Single SDS | Pass | Native managed-file/hash tests plus interaction harness upload/verify |
| Bulk SDS | Pass | Native workspace scenario, authoring suite, and interaction harness |
| Image-only OCR | Pass | Real Windows OCR recognized generated image-only PDF |
| Boundary review | Pass | Deterministic extraction tests and split/merge interaction |
| Product approval | Pass | Create-new and update-existing materialization tests; update preserved prior SDS |
| Authoring graph | Pass | Native representative graph and browser interaction workflows |
| Persistence/reopen | Pass | Native Bulk restart, restored workspace reopen, and persisted auth tests |
| Reports/CSV | Pass | Report unit tests plus interaction export assertions |
| Backup/restore | Pass | Native independent restore and corruption/atomicity tests |
| Diagnostics Mode | Pass | Native package lifecycle/privacy tests plus hotkey/session interaction tests |
| Offline/session sanity | Pass | Native signed lease/cache tests and session interaction tests |
| Migration safety | Pass | Native schema 3→6, rollback, idempotence, row/SDS preservation tests |
| Publication/replica | Pass | Native publication emulator scenario and 25 backend security tests |

## Diagnostics privacy result

The native diagnostic package tests created and inspected the actual store-only ZIP format containing `manifest.json`, `app-events.jsonl`, and `summary.json`. They verified ordered semantic events, explicit marks, stop/interrupted recovery, hash/CRC integrity, traversal/corruption rejection, bounded queues, and failure isolation. The allowlist/redaction tests reject or remove tokens, credentials, signed URLs, arbitrary sensitive fields, and raw errors. The manifest asserts `screenshots: false` and `screenshotCount: 0`; SDS bytes and document text are not permitted event fields.

Because the native UI could not be controlled in this environment, this run did not manually start a diagnostic session inside the visible Tauri window while clicking every workflow. The native writer/export path and the UI lifecycle were each executed independently.

## Defects found and repaired

### Fresh-checkout root test failure

- Observed: `npm test` failed when `packages/authoring/test/authoring.test.mjs` imported `firebase/functions/lib/staged-contract.js` before Functions had ever been built.
- Classification: test/build harness defect.
- Root cause: `test:authoring` built authoring and core but omitted its compiled Functions dependency.
- Fix: `test:authoring` now builds `@hazcom/firebase-functions` before running authoring tests.
- Exact regression: the generated Functions `lib` directory was removed, then `npm test` passed from that clean state.

### Windows installer bundle failure

- Observed: the real Tauri release executable compiled, but bundling failed with `Couldn't find a .ico icon`.
- Classification: product packaging defect.
- Root cause: a valid tracked `icons/icon.ico` existed, but the Tauri bundle configuration did not declare it.
- Fix: `bundle.icon` now explicitly includes `icons/icon.ico`.
- Exact regression: the all-target Tauri build passed and produced both MSI and NSIS bundles.

### Environment-only baseline failure

The first sandboxed `npm test` attempt could not create compiled output directories because of workspace ACL isolation. The same command ran with the necessary local build permission and then exposed the real fresh-checkout dependency defect above. This was not an application defect.

No additional ordinary-authoring, SDS-integrity, OCR, reporting, backup, diagnostics, session, migration, or publication defect reproduced after the two repairs.

## Validation results

- `npm test`: pass; core runner, 13 commercial tests, SQLite validation, 10 sync tests, and 30 authoring/Bulk/Reports tests.
- `npm run test:authoring:ui`: 20/20 pass.
- `npm run test:diagnostics`: 16/16 pass.
- `npm run test:windows:publication`: 12/12 pass.
- `npm run test:windows:auth`: 4/4 pass.
- `npm run test:windows:auth:persistence`: 1/1 pass.
- `npm run test:firebase`: 25/25 pass.
- `npm run test:windows:publication:emulator`: pass, including native authoring/backup and native publication/replica summaries.
- `cargo test`: 27/27 native tests pass.
- Focused native OCR with output: pass; real Windows OCR recognized the synthetic image-only SDS.
- `cargo check --release`: pass with two existing test-helper dead-code warnings.
- `npm run build`: pass; Vite retained its existing large-chunk advisory.
- `npm run tauri -w @hazcom/windows -- build`: pass; executable, MSI, and NSIS produced.
- Final executable launch/close/restart: pass.
- `git diff --check`: required as the final pre-commit check.

The Firebase emulator emitted its known non-fatal metadata lookup warning in this network-isolated environment. The Functions emulator used host Node 24 while the package requests Node 22. Neither changed the pass result; production deployment was out of scope.

## Hands-on checks for the next session

Start with a disposable Company and confirm these visible native interactions on the actual desktop:

1. Sign in with Google and confirm the expected Company/role.
2. Open Diagnostics with `Ctrl+Shift+Alt+D`, start a session, and add a marker.
3. Import one normal text SDS and confirm the Product/SDS metadata.
4. Import an image-only scan and inspect the OCR text before approving fields.
5. Import a two- or three-document batch, adjust one boundary, save, close, reopen, and resume.
6. Approve one new Product and one update to an existing Product.
7. Create a Work Area, Worker, placement, assignment, verification, review, and training event.
8. Review all four reports and open the exported CSV.
9. Export a Company backup, restore it as a separate workspace, and compare representative records/SDS.
10. Stop and export Diagnostics, then attach the sanitized ZIP if any visible behavior differs from this acceptance evidence.

Real Google sign-in and a full click-through of the visible native WebView remain the first manual checks because this environment could not bind its native automation surface.
