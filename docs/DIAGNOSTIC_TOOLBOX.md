# HazCom Navigator diagnostic toolbox

## In-application reproduction sessions

HazCom now has two complementary diagnostic artifacts. The existing CLI `diagnostic-bundle.zip` describes system/repository/workspace/cloud health. The Windows app's `hazcom-diagnostic-session-<session-id>.zip` records the semantic timeline of a reproduction. Neither automatically includes the other, uploads anything, or changes application authority. CLI report schema `diagnosticSchemaVersion: 1` remains unchanged.

In the Windows app, **Ctrl+Shift+Alt+D** opens Diagnostics, including at sign-in or under a Member account. Opening the panel does **not** record. Choose **Start Diagnostic Session**, reproduce the problem, optionally press **Ctrl+Shift+M** to mark a moment, then **Stop Diagnostic Session**. The persistent **DIAGNOSTICS ACTIVE** indicator shows elapsed time. Completed/interrupted sessions can be selected and exported. **Open diagnostic folder** reveals the managed export location without asking the customer to find AppData. Diagnostics grants no role, entitlement, workspace, authoring or publication permission.

Mark Moment records the current screen and session-pseudonymous Company/workspace context with a reference to at most the previous 64 events. It does nothing while inactive. Hotkeys require the exact modifier combination, ignore repeats/composition, and React listeners are removed on unmount. No keyboard contents or arbitrary event objects are recorded.

### Native storage and runtime launch

The central Rust service owns one active session per process. A bounded background queue receives batches from the typed frontend client; React components never write diagnostic files. Storage is independent of all Company databases, restored workspaces, attachment roots and publication journals:

```text
<app-data>/diagnostics/sessions/diag_<128-bit-random-hex>/
  manifest.json
  app-events.jsonl
  session.lock
<app-data>/diagnostics/exports/
  hazcom-diagnostic-session-diag_<128-bit-random-hex>.zip
```

On Windows, app-data is normally `%APPDATA%/com.saturnstraw.hazcomnavigator`. Native commands accept session IDs, not arbitrary paths. They reject traversal and redirected/reparse support paths. Metadata and ZIP exports use temporary files and rename. A session lock prevents another running process from being mistaken for a crashed process. Clean native exit flushes and finalizes; a subsequent launch marks an unlocked incomplete session interrupted. It does not resume it. Export can retain a valid JSONL prefix when a crash interrupted the last line; corruption within the completed prefix is refused. No automatic evidence deletion is performed.

Launch the installed/built Windows executable with runtime arguments:

```text
hazcom-navigator.exe --diagnostics --diagnostic-session smoke-run-001
```

`--diagnostics` starts a fresh automated session before frontend startup. `--diagnostic-session` is optional and only used with that flag. Labels must be nonempty and at most 128 UTF-8 bytes; invalid labels are omitted. The stored correlation is SHA-256 of the label, never its raw text. Future runners can compute the same hash and discover the generated session ID from managed manifests. This adds no network listener, control channel, sign-in bypass or runner implementation. Build provenance is the Git HEAD embedded by the native build script; developer builds can also contain uncommitted changes, so a SHA is not a claim of a pristine build.

### Event and package contract

Session package schema is independently versioned at 1. ZIP members are exactly `manifest.json`, `app-events.jsonl`, and `summary.json`. Timing and errors are typed events rather than empty separate streams. The manifest describes ID, state, launch source, timestamps, version/build, OS/architecture, screenshot status, event/drop counts and safe failure code. Summary includes the JSONL SHA-256 and byte count. ZIP uses the same store-only/CRC32 convention as the CLI bundle. Repeated identical exports are idempotent; an existing different package is never overwritten.

Each JSONL record contains `schemaVersion`, `sessionId`, monotonic `sequence`, `timestampMs` (UTC Unix milliseconds at native acceptance), a typed `event`, and optional `recentFrom`. Event payload fields are explicitly allowlisted: operation/outcome, screen, Company/workspace/entity pseudonyms, role category, readOnly state, publication phase, reason code, count, byte count, duration and submitted field names. Numeric timestamps plus sequence permit deterministic ordering even if the wall clock changes. Context is captured when the frontend event is submitted. Native acceptance timestamps may be close together for a batch.

Implemented observations cover navigation/dialog state; workspace open/switch/authorization/mode; authentication and Company access refresh/revocation; authoring create/update/trash/restore for the current domain entities; append-only SDS Verification, HazCom Review and Training Events; SDS import/read/unlink; Bulk SDS import/split/merge/review save; backup export/restore/inspection; publication readiness, progress and outcome; validation and unexpected frontend errors. Significant operations include duration. This is not a profiler or an audit record of every SQL query, render or cloud request. A readiness check may return a blocking domain result without throwing; the UI still displays that result.

Read-only package validation is part of the same toolbox:

```text
node scripts/diagnostics/session-package.mjs <exported-session.zip>
```

The validator checks fixed member paths, ZIP local/central structure, CRCs, stream hash/size, schema, session IDs, sequence, and event vocabulary. It neither repairs nor finalizes sessions and never imports their contents into a workspace.

### Privacy and limits

The frontend and native writer share `apps/windows/src/diagnostics/contract.json`. Unknown operations/fields are discarded; native structs reject arbitrary object fields. All Company/workspace/entity identifiers are session-scoped SHA-256 pseudonyms truncated to 24 hex characters. Raw names, emails, descriptions, submitted values, filenames, paths, document bytes/text, auth responses, credentials, secrets and stack traces are not event fields. Errors become bounded reason codes; unknown errors become `OPERATION_FAILED`. Export revalidates and reconstructs allowed data instead of copying arbitrary artifacts. The existing CLI redactor remains responsible for its health-snapshot text; both layers use the same documented exclusions and representative privacy test corpus. Pseudonyms provide correlation, not cryptographic anonymity against someone already knowing the IDs.

Screenshots are **explicitly deferred/unsupported**. Metadata-only sessions are complete and useful. Tauri's native WebView2 controller exposes CapturePreview, but a maintainable implementation still needs tested COM stream/callback lifetime, cancellation, and allocation limits. No DOM canvas workaround, desktop capture, dependency, or false opt-in is shipped. A future selective provider must require explicit consent and disclose that visible UI pixels are not text-redacted. Current screenshot count is always zero.

Bounds: frontend queue 256 events, batches 64, roughly 100 ms batching; native queue 16 batches/commands; recent sequence ring 64; event stream 4 MiB; at most 32 retained session directories. Starts are refused at the retention limit rather than deleting evidence. The native writer flushes batches and at most every 500 ms while idle, without per-event fsync. Control operations wait at most three seconds; authoring does not await event writes. Overflow counts dropped events and appears in the panel/manifest. Reaching the stream cap leaves recording visibly degraded and refuses further event bytes until Stop. A forced exit can lose the in-flight/queued tail; an interrupted package never claims a complete recording. Export memory is bounded by the stream/package limits. Disk exhaustion, malformed evidence, queue saturation and export failure stay in the diagnostic subsystem. No diagnostic failure rolls back a business save.

### Acceptance evidence (2026-09-27 local date)

Native tests exercise lifecycle, privacy sentinels, independent Python ZIP CRC/content validation, restart/partial-tail recovery, corrupt metadata, queue/storage bounds and live-session locking. A local 15,000-event stress test took approximately 0.28 s; the 4 MiB cap held at 4,194,250 bytes with 3,417 dropped events. These are local test measurements, not production latency guarantees.

Production React panel/hotkeys run in the existing browser acceptance harness with synthetic native transport and isolated authoring SQLite. Tests verify no implicit start, exact modifiers/repeat suppression, one session, timer, marker, semantic navigation/CRUD, Stop/export UI, logging failure isolation and Member access without authoring. Separately, `apps/windows/test/diagnostics-runtime.ps1` launches the actual built Windows executable without sign-in and verifies runtime auto-start, startup event, clean native exit, forced termination and inactive manual restart. Native export is tested independently from browser UI. Authenticated native interaction through every newly instrumented workflow is not claimed.

No real Firebase writes or deployments are part of diagnostics acceptance. Existing outstanding live Member, Demo, nonmember SDS and privileged-write denial probes remain pending. Screenshot acceptance and a future external UI smoke runner remain separate work.

Run from the repository root with Node 24 and installed npm dependencies:

```text
npm run diagnostics:quick
npm run diagnostics
npm run diagnostics:full
npm run diagnostics:cloud
```

`diagnostics:quick` is the fast, local, read-only pass: Git state, tool versions, SQLite integrity and Company-scoped counts, active SDS bytes/hash checks, authoring projection, publication journal, and bounded local errors. `diagnostics` is the recommended handoff command. It also checks the live remote main, attempts a **read-only** development-cloud audit when Firebase CLI credentials are available, and runs focused diagnostic and Windows-publication tests. `diagnostics:cloud` does the same local inventory and the cloud audit without running tests. `diagnostics:full` adds `npm test`, `npm run test:firebase` (demo emulators), `npm run test:windows:publication`, the app build, and Functions build. Diagnostic full mode suppresses the existing benchmark tests' tracked JSON snapshot rewrites while still running their measurements and assertions. No mode runs the 5,000-SDS scale stress suite.

The collector refuses any cloud target except `hazcom-navigator-dev`, including `command-rhythm`. It reads the project from `firebase/.firebaserc` unless `--project hazcom-navigator-dev` is supplied. It does **not** publish, deploy, change IAM, invoke cleanup, mutate Firestore/Storage, or repair SQLite. The cloud audit uses the existing Firebase CLI login and Google API metadata reads; it performs no interactive sign-in. If credentials are absent, cloud sections are `UNAVAILABLE` and the local bundle still succeeds. The report labels privileged CLI reads explicitly: they establish cloud metadata and revision facts, **not** Firebase client Rules authorization. The reported commercial capabilities come from read-only cloud documents passed through the repository's local resolver, not an authenticated client callable. Cached/local evidence is kept separate from that cloud snapshot.

Each run creates an ignored `diagnostics/output/<UTC timestamp>/` directory with:

- `diagnostic-summary.md` — a short **CHAT HANDOFF** plus working, failing, changed, deployed, local-only, unverified, and next-check sections.
- `diagnostic-report.json` — deterministic collector facts in versioned schema `diagnosticSchemaVersion: 1`.
- `diagnostic-bundle.zip` — a portable archive of exactly those two sanitized reports.

Upload the ZIP to ordinary ChatGPT chat, or upload both Markdown and JSON. Ask the next developer/model to use the evidence labels and investigate the failing or unverified section. The JSON is suitable for a future external analysis system, but this command does not send it anywhere. Generated bundles are Git-ignored; inspect one before sharing if local privacy requirements are stricter than the default redaction.

`PASS` means that particular check completed and its stated invariant held. `FAIL` means it completed and found a concrete error. `WARN` means the check completed with a condition needing attention, such as a dirty worktree or a pending journal attempt. `UNAVAILABLE` means a source could not be read; `UNVERIFIED` means the mode or available evidence did not attempt the check. The overall status is conservative and may be `WARN` for a healthy local quick run because cloud and tests were not run. It is not a product acceptance verdict.

The local SQLite connection is opened read-only with `PRAGMA query_only=ON`. It reports the Tauri migration ledger when present, `integrity_check`, `foreign_key_check`, Company-scoped active/Trash counts, and the existing authoring service's derived state. It compares the local migration with the migration files in the checkout; migration 4 adds Bulk SDS Import review drafts, for which diagnostics reports only a Company-scoped session count and counts grouped by session status, never page snippets or source PDF bytes. The existing publication builder validates active Company relationships and produces the local fingerprint and schema-2 content hash. A separate read-only publication-journal connection reports attempt/receipt IDs and whether an attempt remains pending. SDS inspection checks only current, active Product attachments: file existence, PDF signature, size, and SHA-256 against local integrity metadata. It reports paths relative to managed attachment storage, never PDF bytes or text. With several local Companies, the collector chooses a unique highest-numbered local publication receipt **as an inference**; use `--company <Company ID>` to select one explicitly.

Cloud inspection reads Functions runtime/state, Cloud Run invocation settings and IAM bindings, configured Firestore index state, Firestore and Storage rules release IDs, bucket metadata, bounded recent warning/error logs, and the selected Company's current published revision. It reads the selected Company's coverage/plan and the journal-linked Account's role only when those documents are available. It does not claim that reading a revision through privileged CLI credentials proves a Member or Manager client can read it.

The report contains filenames and concise diff statistics, not source diffs. It includes recent error/warning lines only, with centralized redaction for Authorization and Cookie headers, bearer/JWT/OAuth/Firebase tokens, signed URL credentials, service-account private keys, passwords and common secret fields. It never includes environment variables, `.env`, raw SQLite copies, SDS PDFs, OCR/SDS text, browser profiles, credential caches, or billing secrets. There is no raw SQLite export option in this toolbox; any future copy command must be a separate explicit opt-in with privacy review.

Optional flags are `--company <id>`, `--project hazcom-navigator-dev`, `--db <path>`, `--journal <path>`, `--attachments <directory>`, and `--output <directory>`. The path flags are for a local diagnostic fixture or nonstandard app installation; they do not change the database or managed files. If the native app holds a lock, the report marks SQLite `UNAVAILABLE` or `FAIL` with the actual read error and still emits the bundle. If source packages have not been built after a fresh checkout, run the normal app build first so the local projection imports exist. When a local database is still at migration 3 under migration-4 source, the authoring summary is unavailable, but the collector still checks integrity, scoped counts, SDS bytes, and existing publication relationships without migrating the database. A schema-4 database is reported as current with `migrationPending: false`; session status counts are Company scoped. The schema-3 read-only fallback and populated schema-4 session-state path are covered by diagnostics tests.

At integration time, the current upstream lockfile did not pass `npm ci` on Node 24 (`@hazcom/core` workspace entries were reported missing). `npm install --package-lock=false --ignore-scripts` installed dependencies for isolated validation without changing the lockfile. This is a source-installation limitation, not a diagnostic or Firebase failure.

Run `npm run test:diagnostics` for focused schema, redaction, Git, read-only SQLite, journal, SDS failure, project guard, refusal, and degraded-output tests. The cloud auditor will show a limitation as `UNAVAILABLE` rather than silently inferring a pass. In particular, the remaining live Member, Demo, nonmember SDS, and privileged-write denial checks remain separate acceptance work and are not performed by diagnostics.
