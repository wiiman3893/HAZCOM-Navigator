# Commercial lifecycle convergence work resume

## FINAL — milestone integrated; no continuation work pending

Remote main was fast-forwarded from `30fa9fd2ca6d46d1892259340c165b3e7ff57157` to validated implementation checkpoint `3a0c1de617f200f3aa237573b4347d0ed0c735a3`. A fresh fetch and remote ref read verified the exact intended SHA. Origin/main had not advanced, so reconciliation was unnecessary. The task branch remains intact and pushed. This documentation-only closeout follows the implementation commit on both branches.

All required automated validation passed; final full report is `diagnostics/output/20260927T223956` (six PASS groups; WARN only for four explicitly unverified live probes). Native all-target 11, browser 10, publication/lifecycle 12, and integrated restored publication passed. Bounded audits are complete; no known corruption, Company/workspace isolation, or authority blocker remains within the reviewed milestone. See [complete closure report](COMMERCIAL_WORKSPACE_CLOSURE.md) for fixes, commands, audit evidence and limitations.

No deployment, real Firebase write, billing action, frozen/archive change or setup-script edit occurred. The older canonical checkout contains pre-existing local changes and was deliberately not switched or overwritten. The task checkout is the validated source. Next frontier, only as a separately authorized task: development rollout/backfill rehearsal and live security/native acceptance. Do not claim production commercial rollout, fresh signed-in native visual acceptance, or the four live-security denials. Earlier checkpoint sections below are historical, not remaining work.

## Closure checkpoint 21 — final validation and bounded audits complete

Access-refresh fix is pushed as `8b447521316010bf32013f3c22c8823dc82ded46`. Bounded whole-diff review additionally fixed zero-SDS restore activation and unknown/null subscription read/export elevation under ending coverage. Export now follows authoritative Company capability. The first broad run exposed an intermittent shared Firebase fixture failure; its exact 14-day entitlement used two clock reads. A deterministic 1 ms reproduction proved that fixture could exceed the strict grace limit. One timestamp fixes the fixture without weakening production policy.

Final `diagnostics:full` evidence `diagnostics/output/20260927T223956` passes all six groups: diagnostic tests, npm test (including authoring), Firebase 24/24, Windows publication/lifecycle 12/12, Windows/mobile build and Functions build. Overall WARN is solely the four retained live-security probes. Native all-target tests pass (11 library tests); browser 10/10 and integrated native/Firebase restored publication pass after the fixes. `git diff --check` passes. [Closure report](COMMERCIAL_WORKSPACE_CLOSURE.md) records the bounded commercial/workspace audit, defects, evidence and remaining limitations.

Integration is the next authorized step. No main advance was observed at recovery. The separate old canonical checkout contains unrelated tracked changes and the personal setup script; it must remain untouched. Integrate the clean validated task via a normal fast-forward remote-main push, fetch and verify its exact SHA. No cloud mutation/deployment, frozen branch change or setup modification. Historical checkpoints below retain their original stage descriptions; current state is this closure section.

## Closure checkpoint 20 — access refresh fixed

Closure started with clean local/remote task `342e2a97911a0d534c7c74f2dfd2a18308095872` and fetched main `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. The interrupted combined tool call executed neither its patch nor tests: automatic review failed because usage was exhausted. There were no partial/uncommitted changes to recover.

Root cause: the Workspace effect depended only on Company ID/role, and ensureWorkspace returned its cached lease without rechecking the effective mode. Refresh now reruns on refreshed Company context, reauthorizes the existing selection, and closes/invalidate its native session before reopening the same identity when mode changes. Authorization or reopen failure leaves no usable old writable session; the UI clears stale authoring/publication state. A delayed result cannot close a newer selected session. Mode-stable refresh retains its existing token and data.

Focused validation passed: Windows publication/lifecycle 12/12, browser 10/10, native library 11/11, Windows production build. Native tests additionally prove old writable/read-only tokens are rejected across both mode transitions and recovered authoring can write. Browser coverage proves same restore survives authoring → export → authoring and failed reopen hides stale controls. Next: final broad regression, bounded audits, documentation alignment and non-destructive integration. No deployment/cloud mutation; frozen refs and personal setup untouched.

## Continuation checkpoint 19 — native restored publication acceptance

Recovered clean task HEAD/remote `b09b49460becec7268b5517c4fc41943442b5bad`; fetched main remains `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. Added `npm run test:windows:publication:emulator`: actual JavaScript authoring/backup/projection and publication workflow call disposable Rust SQLite/file/journal sessions and real local Firebase schema-2 Functions. It passes with production upload concurrency, A/B distinct fingerprints, separate attempt journals and SDS roots, interrupted upload/resume with the same ID, lost finalization response reconciliation without duplicates, stale native tokens, primary journal isolation, and both switch/publication exclusion directions. No real Firebase publication occurred.

Restored publication is now enabled through the existing guarded workflow; read/export sessions remain explicitly blocked. Extracted the existing run guard so production and emulator acceptance use the same guard. Diagnostics reports support separately from unverified live eligibility. Windows build, publication/lifecycle 10/10 and diagnostics 12/12 pass. Browser tests now pass 9/9 including the actual Workspace selector with isolated adapters: failed switch preserves authoring/publication selection, reload remembers it, cancellation preserves it, missing selection fallback is visible, export uses selected workspace, and Member never opens authoring. Initial test-server escaping and disabled-option assertion errors were corrected; no application defect was concealed. Full regression and final branch audit remain next; no main integration or fresh signed-in native visual acceptance claim. Main/frozen/setup/cloud mutations remain untouched.

## Continuation checkpoint 18 — deterministic orderings and filesystem bounds

Checkpoint 17 pushed as `3cba6ac`. Added all six sequential release/takeover/seat-removal permutations alongside the simultaneous race. Each proves direct Member preservation, inherited owner removal, buyer coverage, exact 0/1 Company counts and harmless old cancellation replay. Found and fixed downgrade's stale `coveredCompanyCount`: billing transactions now persist it from the resulting authoritative covered list. Firebase suite passes 24/24, including persisted pending-downgrade removal.

Native activation now rejects primary database path aliases; restored SDS inspection requires its exact managed path and checks recorded size/5 MiB bounds before reading bytes. Added oversized SDS and invalid foreign-key database cases to the failure-preserves-active-session matrix. Native 11/11, existing UI 6/6 and diagnostics 12/12 pass. Diagnostics now accepts legacy v1 manifests without requiring the v2-only schema field and applies the same SDS bounds. No deployment/cloud mutation; main/frozen/setup unchanged. Next: complete publication-isolation determination, frontend selector acceptance, current full regression and remaining whole-diff audit. Restored publication remains blocked pending integrated transport/native acceptance; no main integration claim.

## Continuation checkpoint 17 — persisted recovery and real backup concurrency

Recovered checkpoint 16 is now pushed as `25b82a2`; main remains `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. Found that reducer-deleted `paymentFailureAt`/`pendingDowngrade` fields were omitted from Firestore update(), leaving stale stored state. The adapter now explicitly deletes cleared fields and removes them from deadline calculation input. Ordered event versions now also reject backward effective timestamps; exact old-ID replays remain no-ops. Core tests pass 13/13 plus runner; Firebase 23/23 includes repeated failure IDs, fixed deadline, persisted recovery, stale-copy rejection and a subsequent legitimate new failure. One core expectation initially failed because the new stale-time guard rejects earlier than the old early-renewal guard; the expected denial was updated and rerun passed.

Expanded the actual JavaScript→native SQLite round-trip test with deterministic hooks for authoring during row reads, SDS replacement during file reads, Trash→restore during export (including an ABA change), and shutdown after the first query. Exports fail explicitly rather than returning mixed packages; retry validates, and primary remains unchanged. Focused native bridge test passes. No deployment/real cloud mutation; frozen/setup/main unchanged. Next: deterministic permutation matrix, publication isolation decision, selector/restart acceptance, final capability/path audit and broad regression. No integration readiness claim.

## Continuation checkpoint 16 — recovered interrupted audit work

New continuation started at local/remote task `6c625077c106f32eaf6bf23ed0362be3a6e1f3f6`; freshly fetched main remains `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. Ten uncommitted files were recovered; no staged changes or unpushed commits. The prior combined tool call was stopped by usage exhaustion before either the checkpoint-16 note or Git commit executed. This note reconstructs that missing record; no completed work was recreated.

Recovered changes: three-way release/takeover/seat-removal emulator test; repeated outstanding payment failures no longer roll grace forward; legacy dev-admin entitlement replacement refuses before credentials/network; first-administrator preserves the deadline; obsolete fixed SQLite plugin registration removed; duplicate startup effects share pending activation per Account/Company/generation; two documentation line endings fixed. Prior runs passed Firebase 22/22, core 13/13, Windows publication/lifecycle 10/10, native 11/11 and Windows build. Fresh continuation revalidation has passed core 13/13 plus runner, Windows 10/10/build, native 11/11 and diff check; Firebase revalidation is running. No cloud mutation/deployment or main/frozen/setup changes.

Immediate audit frontier: verify failed-payment → recovery → stale replay and persistence of cleared optional billing fields; then deterministic transition ordering, backup mutation cases, publication isolation, full regression and final review. Restored publication remains blocked and live security checks remain unverified. Do not claim integration readiness.

Fresh Firebase revalidation finished successfully: 22/22. The recovered checkpoint is ready to commit/push; the audit frontier above is subsequent work.

## Continuation checkpoint 15 — read-only workspace diagnostics and failed-startup recovery

Hosted cutoff checkpoint is pushed as `6f74216`. New read-only workspace inventory reports distinct restore identities, remembered Account/Company preferences, schema/integrity/counts, baseline-manifest integrity, current and historical SDS verification, publication blocking and unavailable selection reasons. It explicitly does not claim to know the in-memory active session or live authoring eligibility. No raw SQLite/SDS is packaged. Diagnostics tests 12/12 prove database/registry hashes unchanged, corrupt SDS detection and no creation of a missing database.

Native adversarial tests reject missing/corrupted DB, missing SDS root, same-size SDS corruption, wrong size, malformed manifest, future schema and missing workspace while keeping the previous session usable. A corrupt preference registry preserves an already-open session on failed switch; on startup only, authorized primary may open with an explicit unsaved-selection warning, leaving registry bytes unchanged. Native suite 11/11 and Windows build pass. Quick diagnostic bundle `diagnostics/output/20260927T121255` contains the new inventory; no local restored workspaces/registry were found, so current in-memory selection stays unverified. Older full report remains evidence for the broad suite, not the later inventory implementation. Main/frozen/personal setup/cloud writes remain untouched.

Next: complete selector/restart frontend acceptance, publication-isolation decision (still blocked), broader lifecycle transfer/concurrency and transaction-size checks, final branch-wide audit and broad validation. Do not integrate main while these uncertainties remain.

## Continuation checkpoint 14 — emulator hosted cutoff and release races (2026-09-27)

Checkpoint 13 pushed as `b96c0f1`. Added trusted `hostedReadUntil` Membership projections, maintained in the same lifecycle/invitation/coverage/billing transactions. Published Firestore data, training feeds and both Storage layouts deny at/after that absolute deadline; missing fields fail closed. Company/Account/Membership/coverage control records remain readable for expiry/recovery status. No deployment/backfill was performed. A separate authorized rollout must backfill existing Memberships, verify gates/index readiness and assess transaction-size limits for large audiences. Emulator-only backfill rehearsal helper is provided.

Fixed released Company seat removal: released coverage is no longer in the capacity list, so removal now also queries owned ending coverage (new collection-group index definition). Direct Membership survives with its export cutoff; inherited-only access and Account index are removed. Fixed double decrement when a released Company transfers to paid Company coverage. Cleanup claim also zeros content deadlines transactionally.

Validation: Firebase emulator 21/21, including real request-clock expiry without cleanup for Firestore + schema-1/schema-2 SDS, server exact boundary, missing-gate denial, replacement coverage restoration, concurrent release/seat removal and idempotent replay. Full `diagnostics:full` report `diagnostics/output/20260927T120839`: all six groups PASS (diagnostic tests, npm test, Firebase emulator, Windows publication/lifecycle, app builds, Functions build). Overall WARN includes retained live security gaps, not a failed test. No real cloud writes/deployment, main/frozen/setup unchanged. New diagnostics workspace inventory is in progress separately, not part of this backend proof.

Remaining: finish inventory/tests, deeper native missing/corrupt/schema/path cases and restart fallback, final selector/native acceptance audit, publication remains blocked for restores, fuller coverage-transfer race matrix and final branch-wide review. DO NOT CLAIM milestone merge-ready or deployed cutoff.

## Continuation checkpoint 13 — switch/export async guards (2026-09-27)

Checkpoint 12 is pushed as `205ccca`. Fixed a race where publication could pin the old workspace after a switch had already entered native activation. `WorkspaceLifecycle` now marks transitions pending synchronously, serializes switches, excludes pins during transitions, rejects switches during pinned operations and allows security shutdown to invalidate pending generations. Backup export also pins the workspace. Added three deterministic race tests to the normal Windows publication test command; all pass. Windows build passes.

Backup now checks authoring version and Company metadata before/after gathering tables/SDS, rejecting a mixed export when edits happen during download. Regression injects both version and Company-name changes: backup tests 4/4, all native tests 10/10. No cloud changes. Main remains unchanged. Next: adversarial restored-workspace corruption/restart tests, hosted-read cutoff, Pro release/inheritance races, diagnostics and broad regression. The cutoff is still a policy decision only; do not claim rules enforcement.

## Continuation checkpoint 12 — actual native authoring/backup proof (2026-09-27)

Checkpoint 11 is committed/pushed as `7074c2d`. New test-only pipe bridge runs the real JavaScript authoring, publication projection and backup services against the actual Rust workspace SQL/file/session implementation (disposable SQLite, no cloud). It creates all eight authoring entities, owned SDS, Training/SDS Verification/HazCom Review events, exports primary, restores A, edits A, trashes/restores a placement, replaces SDS, persists a Bulk review session across close/reopen, exports A, restores B and compares every backup table and SDS payload plus publication datasets. B edits remain absent from A; primary tables/SDS remain byte-for-byte equivalent at the logical export level.

This uncovered a real defect missed by legacy fixtures: restore statement validation rejected `sha256` column names because digits were excluded. Fixed the identifier grammar without allowing punctuation or SQL expressions. Initial native scenario failed on that error; rerun passed. Final sync tests 9/9 and native tests 10/10 passed. The current backup v2 contract deliberately omits unfinished Bulk review sessions; the new test proves local restart persistence and that omission, and the UI now states the boundary explicitly. This is not native visual acceptance or live authentication proof. Hosted cutoff, commercial races, async audit, diagnostics and final broad regression remain pending. Cloud/main/frozen/setup state unchanged.

## Continuation checkpoint 11 — recovered frontend/native routing (2026-09-27)

Recovered starting task/remote task `ed369561623d64f3214d023cfd163e00ff08e96c`; fetched main remains `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. Eleven uncommitted routing files were preserved. The interrupted App/workspace patch had not executed: automatic review could not run because the usage allowance expired, not because the action was determined unsafe. Smaller read-only UI/native changes were applied normally and verified.

Authoring, managed SDS/Bulk source files, backup export and publication journals now use a captured native workspace lease. Removed obsolete fixed-pool authoring commands and frontend SQL-plugin permissions. Each restore receives a distinct managed identity. The minimal selector lists Company-scoped restores, preserves the previous workspace on failed selection, and remembers selection per Account/Company. Restored inspection permits newly authored SDS only with integrity metadata. Grace/export access opens SQLite read-only, skips migrations, rejects writes/files/journal mutation and offers export without authoring UI. Restore enforces current entity limits. Restored publication remains explicitly blocked pending isolation acceptance.

Validation executed: native `cargo test --lib` 9/9; Windows build passed; publication workflow 6/6; existing browser authoring UI 6/6. Native tests include repeated A/B switches, failed-candidate preservation, pool closure, stale leases, same-Company restore isolation, owned SDS reads, atomic batch rollback, separate journals, reopening, and byte-identical read-only database access. These are native service tests, not a fresh visual native-app acceptance. Bundle-size warning remains informational.

Next: full actual-authoring/native workspace round trip, async switch audit, adversarial restart/corruption cases, hosted-read cutoff implementation and emulator lifecycle races, diagnostics, broad regression. DO NOT CLAIM YET: all milestone acceptance complete, restored publication safe/enabled, hosted cutoff enforced, main integration or live security proof. No deployment/cloud mutation; frozen branches and personal setup script untouched. This checkpoint is on the task branch only.

## Continuation checkpoint 10 — native session foundation (2026-09-27)

Continuation started at task `c6a19e127a8ab70d65b55e2eec974c787215530b`; fetched main remains `30fa9fd2ca6d46d1892259340c165b3e7ff57157`. The user decided hosted reads must stop exactly at the 14-day grace/release deadline; that policy is now recorded in the commercial contract, but Rules implementation remains pending.

New `apps/windows/src-tauri/src/workspace.rs` adds explicit native sessions, token-bound SQL/file commands, transactional per-Account/Company selection persistence in a separate registry database, managed path checks, candidate migration/integrity verification, and switch serialization. Failed preparation preserves the old pool; successful activation closes it and invalidates old tokens. File reads require a matching Company-owned attachment or Bulk SDS import row. Fixed Bulk SDS source retry comparison to use its configured size bound.

Validation: `cargo test --lib` passed 8/8, including a real migrated SQLite primary/restored switch, failed switch preservation, old-pool closure, stale-token rejection, persisted selection, reopening and original-data isolation. An initial test compile error in a MutexGuard borrow was corrected. This foundation is registered natively but the existing frontend still uses its prior routing. Multiple restores per Company, mutable-restored SDS inspection, frontend routing/selection, publication isolation, diagnostics, hosted cutoff and commercial race expansion remain pending. Cloud mutations: NONE.

Next action for this continuation: route frontend database/authoring/file services through the new session, then finish distinct restore identities and editable-workspace integrity. Do not claim the selectable authoring milestone complete. The older next-action section below is historical.

This is an isolated local task branch. It is not deployed and is not on `main`.

- Base and last fetched `origin/main`: `30fa9fd2ca6d46d1892259340c165b3e7ff57157`.
- Branch: `work/commercial-lifecycle-convergence-2026-09-26`.
- Current task SHA: resolve `git rev-parse HEAD` in this branch; this document is part of the checkpoint commit, so embedding its own hash would change that hash.
- Cloud mutations performed: **NONE**. No deployment, IAM, billing, live Company mutation, or cleanup.
- `Setup-HazComNavigator.ps1`: untouched in the separate canonical checkout.

## Checkpoint 1 — committed `f0a277c2dceb0e8a8df98b771f08448eb541f071`

- Priority 1, partial: inspected the canonical commercial contract, core resolver/event reducer, Firebase coverage/backend, native authoring/export gates, rules, and the backup importer. Plan, billing cadence, Membership role, commercial coverage and authorization remain separate. The task has not completed a full operation-by-operation authority matrix.
- Priority 2, partial: provider-neutral events now reject starting an already paid subscription, early renewal, renewal after cancellation, Demo/unknown paid events, expired/grace seat additions, missing seat removal, unknown coverage transfer, and reused event IDs with conflicting identity. Payment failure now records its effective time and bounded grace; recovery clears the failure marker. The trusted adapter persists that marker.
- Priority 4, partial: backup format v2 binds sorted SDS descriptors into the manifest; v1 remains readable. Preflight validates Company ownership chains, link targets, history scope, SDS metadata/bytes and duplicate IDs before staging any file. Import requires a fresh Company destination.
- Functions packaging now copies current core output before TypeScript compilation so the build checks current commercial types.

Files changed in this checkpoint: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `packages/sync/src/backup.js`, `packages/sync/test/backup.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/package.json`, and this document.

Validation passed: `npm run test:core` (10 commercial tests and core runner), `npm run test:sync` (9 sync tests including backup), `npm run build -w @hazcom/firebase-functions`. An initial sync test failed because a fixture assumed an `authoring_versions` row; it was corrected and the full suite passed. An initial Functions build failed because it read stale bundled core types; the build order was fixed and it passed.

## Checkpoint 2 — validated locally; commit on this task branch

- Priority 1, partial: `resolveCompanyCommercial` now combines subscription and Company coverage state in shared core. Backend `coverage()` and `getCompanyCoverageStatus` use it. It blocks parked Demo Companies, uncovered Companies, deleting coverage, and ended release windows; release windows expose only hazard read and backup/export. Denials have stable reason codes. The read-only status also reports effective role, inherited/direct source, coverage reason, pending downgrade, failure time, and backup eligibility.
- Priority 2, partial: new event audit entries include version and a canonical signature of an allowlisted, string-only payload. Duplicate IDs with conflicting payloads are rejected through the trusted adapter, not just the core reducer. Unknown provider payload fields are rejected rather than persisted. Earlier audit entries without signatures retain compatible identity checks.
- Priority 3, partial: emulator tests prove a Pro seat's prior direct Member role is restored after seat removal, inherited access to another covered Company is revoked, and an uncovered Company stays inaccessible. Existing takeover/release tests still pass. Larger team/Company transaction limits and other Pro races remain untested.
- Priority 4, partial: backup v2 includes explicit minimum SQLite `schemaVersion: 3`; v1 packages remain readable. A native IPC restore plan is built only after manifest, relationship, SDS size and SHA checks.
- Priority 5, **foundation only**: `restoreWindowsCompanyBackup` requires live Manager/Administrator access, active Company context and active authoring coverage. The native Rust command migrates a fresh SQLite database, stages managed SDS bytes, checks SHA/size/path/metadata, foreign keys and SQLite integrity, then atomically renames the staging directory to `restored-workspaces/<Company>/active`. It refuses repeat import or merge, and leaves the existing primary authoring database untouched. A focused native test covers corrupted/missing SDS, broken Company ownership, successful restore and repeat refusal. No UI or authoring-workspace switch to that separate restored database is implemented.
- Priority 6, partial: release/ending capabilities and deadline are enforced consistently by the shared policy in backend callables and status. Firestore/Storage read rules still rely on Membership/physical cleanup, so precise post-window hosted-read revocation is unresolved and must not be claimed.
- Priority 7, partial: emulator-only `planExpiredCompanyCleanupInEmulator` reports eligibility, reason, Firestore subtree and Storage object names without mutation. The destructive emulator worker re-evaluates the same policy in its claiming transaction.
- Priority 8, partial: `getCompanyCoverageStatus` explains commercial and authorization state without credentials.
- Priority 9, partial: new core and emulator denial cases cover duplicate billing IDs, unsafe lifecycle transitions, coverage ownership, Pro direct/inherited overlap, release expiration and cleanup planning.

Authority map checked so far: Company creation uses Account subscription capability and coverage count; local Work Area/Chemical Product/Worker creation uses live Company capability plus role and per-Company limits; Company settings require Administrator and `canManageCompanySettings`; invitations require authorized Manager/Administrator plus `canInviteCompanyMembers`, with Pro seats limited to client Members; publication uses Manager/Administrator plus trusted `canPublish`; backup export uses Manager/Administrator plus `canExportBackup`; native restore uses Manager/Administrator plus active `canAuthor`; Pro Company cover/release and seat changes remain trusted or membership-gated separately from payment ownership. This map is not a claim that every operation and race has been audited.

Files changed since checkpoint 1: `apps/windows/src-tauri/Cargo.toml`, `Cargo.lock`, `src/lib.rs`, new `src/backup_restore.rs`, `apps/windows/src/data/backup.ts`, `packages/sync/src/backup.js`, `packages/sync/test/backup.test.mjs`, `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `firebase/functions/src/access.ts`, `commercial-admin.ts`, `index.ts`, `test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md`, and this resume document.

Validation passed for checkpoint 2: final `npm test` (core, SQLite, sync and authoring, including the v2 `schemaVersion` check), `npm run test:firebase` (16 emulator tests, including new denials), final `npm run build`, `npm run build -w @hazcom/firebase-functions`, `npm run test:diagnostics` (11 tests), and `cargo test --lib` (6 native tests). Tests failing: none in the most recent complete runs.

Checkpoint 2 commit: `aac91c24f58b92c91d6d862c1978976882105e9e`. The task branch was pushed to origin at that commit while `origin/main` remained `30fa9fd2ca6d46d1892259340c165b3e7ff57157`.

## Checkpoint 3 — cross-language native restore proof in progress

- The native restore plan now carries the original validated manifest and SDS owner IDs. Rust independently checks package/schema version, Company identity, attachment count, v2 sorted SDS descriptor hash, per-file bytes, and imported SQLite SDS owner/path/size metadata. The activated directory retains `restore-manifest.json` for future inspection.
- A deterministic synthetic small-Company JavaScript exporter fixture (`5` Work Areas, `20` Chemical Products, `10` Workers, `20` SDS files) is consumed by a Rust native restore test. The test restored the generated plan through SQLite migration/import and SDS activation, then verified entity counts. Regenerating the fixture twice produced the same SHA-256 (`F0CDC52AAB1A2A3AADEAF659F51510D8DEBB3C2E933F3BF9541411109F0C69FC`).
- Focused `cargo test backup_restore --lib` passed (2 tests). Final `npm run test:sync` (9 tests), `npm run build`, and `cargo test --lib` (7 native tests) passed for this checkpoint.

Checkpoint 3 commit: `75389b31f567f48f9ce6d88787281cf919bc10ba`. The task branch was pushed to origin at that commit; main remained unchanged.

## Checkpoint 4 — grace and lifecycle denial matrix

- A Firebase emulator test moves a paid Company with an immutable published revision into grace. It proves published hazard read and backup eligibility remain, while Company creation, local authoring capability, settings edits, invitations and publication are denied. The authoring denial reports `COMMERCIAL_GRACE`.
- Provider-neutral lifecycle rejects an immediate Pro-to-Company change (the contract requires a scheduled downgrade) and rejects a same-tier/same-cadence "upgrade" that should be a renewal. The trusted billing adapter rejects `coverage_transferred` events because a billing event alone cannot transactionally reassign a Company's coverage; the separate audited takeover transaction remains the supported path.
- `npm run test:core`, Functions build, `npm run test:firebase` and final `npm run build` passed; the emulator suite now has 17 tests. Commit/push for this checkpoint are pending.

Checkpoint 4 commit: `d76a6dbe5fc57304010ce8033a57aba8d40a0195`. It was pushed to the task branch; main remained unchanged.

## Checkpoint 5 — direct Membership and Pro inheritance separation

- Found a real authorization defect: `setMembership` rejected all changes to a Pro seat's materialized document, including a client's explicit direct Membership. A Company Administrator can now update or remove only the direct Membership while current Pro coverage keeps inherited Manager access. The callable rejects stale inherited indexes and still prevents an inherited-only Pro Manager from appointing Administrators.
- Emulator tests prove direct Member removal and restoration, an explicit Administrator promotion/demotion with correct `administratorCount`, continued inherited access while the seat is active, and direct Member restoration after seat removal.
- `npm run test:firebase` passed twice consecutively with 17 tests after these changes. One earlier emulator run returned an `INVALID_ARGUMENT` failure with truncated output; the two full reruns passed. Treat the first failure as unresolved transient evidence rather than silently claiming every run passed.

Checkpoint 5 commit: `5fef7042543ab017aa1525ff4290b8fc74b5392e`. It was pushed to the task branch; main remained unchanged.

## Checkpoint 6 — anchored calendar renewals

- Found a month-end drift defect: chaining `Jan 31 -> Feb 28 -> Mar 28` violated the documented calendar anniversary. New paid terms record `billingAnchorAt`; ordinary monthly/annual renewal computes from that original date so `Jan 31 -> Feb 28 -> Mar 31` and leap-day annual terms return to February 29 in a leap year. Payment recovery retains the prior full-term restart behavior and establishes a new anchor.
- The trusted event adapter persists `billingAnchorAt`. Existing subscription documents without it fall back to their current term start; the original anchor cannot be reconstructed from an already drifted legacy term.
- Core tests cover monthly, annual leap-day and recovery dates. `npm run test:core`, Functions build, `npm run build`, and final `npm run test:firebase` (17 tests) passed. An intermediate emulator run failed because the new grace test computed paid-through and grace-end from separate clock reads, exceeding the 14-day cap by milliseconds; the test now uses one timestamp and the complete rerun passed.

Checkpoint 6 commit: `cf2670879858aab6a828b95b547c66703e545d3c`. It was pushed to the task branch; main remained unchanged.

## Checkpoint 7 — read-only verification of activated native restores

- The native importer now writes a sorted SDS descriptor sidecar while staging. A read-only native inspection command checks the activated package manifest, SQLite integrity and foreign keys, exactly one matching Company, core entity counts, SDS path/PDF header/size/SHA-256, SDS Chemical Product ownership in that Company, the saved descriptors, and the v2 manifest descriptor hash. The descriptor sidecar also detects later SDS changes in legacy v1 restores whose manifest lacks that hash.
- The Windows service rechecks a live Manager/Administrator Membership and authoritative backup/export capability before invoking inspection. It returns counts and package/schema version, not private record data. The primary authoring database is never opened by this command.
- Native tests verify the JavaScript-generated v2 restore, post-activation ownership tampering, same-size SDS corruption, and legacy v1 corruption; the failed inspections leave the active SQLite file present. `cargo test --lib` passed all 7 tests, `npm run build -w @hazcom/windows` passed, and `git diff --check` passed. The Vite build emitted its existing bundle-size warning.

Files changed in checkpoint 7: `apps/windows/src-tauri/src/backup_restore.rs`, `apps/windows/src-tauri/src/lib.rs`, `apps/windows/src/data/backup.ts`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, `docs/IMPLEMENTATION_STATUS.md`, and this document.

The sidecar is an app-managed integrity snapshot, not a signature against a local attacker who can change both data and sidecar. The Inspector does not select the restored workspace for editing. The JavaScript preflight verifies the records hash before invoking native restore; the native command does not independently recompute that records hash from SQL statements.

Checkpoint 7 commit: `2a9973dfbd453edd5cfab65a287a09d3225de17d`. It was pushed to the task branch; `origin/main` remained `30fa9fd2ca6d46d1892259340c165b3e7ff57157` after a fresh fetch.

## Checkpoint 8 — remove stale Pro access at scheduled downgrade

- Found a Pro-to-Company downgrade authorization defect: when the retained client Company already had an Administrator, the selected billing owner was exempted from inherited-seat cleanup even though no Administrator promotion was needed. This left a materialized Pro Manager Membership after the subscription became Company coverage.
- Downgrade now skips inherited-seat cleanup for the selected person only when the Company genuinely needs that person promoted to Administrator. If an Administrator already exists, all inherited seats are removed or reduced to their saved direct Memberships. Promotion also requires an active Membership and authenticated Account.
- New emulator test covers an existing client Administrator, an inherited-only Pro owner, and a Pro seat with a direct Member role. After renewal it proves the owner loses Company read access, the direct Member remains, and the Administrator count stays correct. `npm run test:firebase` passed 18/18 tests; `npm test` passed core, SQLite, sync and authoring; `npm run build` passed. Benchmark output files regenerated by `npm test` were restored to their committed state.

Files changed in checkpoint 8: `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Checkpoint 8 commit: `d31f23cae105d6f98224a27a2048925e6c9198ad`; it was pushed to the task branch.

## Checkpoint 9 — verify current coverage before Pro membership changes

- The trusted billing adapter now reads each Company's current coverage in the same transaction before adding/removing inherited Pro seats. It refuses a missing, ending, deleting or differently owned coverage document. Scheduled Pro-to-Company downgrade likewise verifies that the retained Company's active coverage still belongs to the Pro subscription before changing Memberships.
- The new emulator case deliberately makes a subscription's Company list stale. Seat addition and scheduled renewal fail without advancing the event version or granting new access; after restoring the current coverage owner, the same event IDs can succeed. It also verifies that seat addition cannot target ending coverage.
- The first emulator run failed two existing cases because active legacy coverage documents omit `state`; the guard now treats missing state as the established active form. The final `npm run test:firebase` run passed 19/19 tests, including the new stale-ownership case. Functions TypeScript compilation is part of that command. No cloud data was touched.

Files changed in checkpoint 9: `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Checkpoint 9 commit: `d2157b8c8f9778589a3d5e95d4413e55a9c3eee9`; it was pushed to the task branch.

Native workspace review after checkpoint 9: `apps/windows/src/data/database.ts` holds one cached `sqlite:hazcom-navigator.db` connection, the SQL plugin registers migrations only for that URL, and `authoring_batch` writes through that named pool. A restored database cannot safely become the authoring workspace by swapping a file path. A future change needs explicit workspace selection, permission rechecks, migration and SDS path routing, and an atomic way to fall back to the primary workspace. The read-only inspector is the currently validated boundary.

Files changed since checkpoint 5: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Files changed since checkpoint 4: `firebase/functions/src/index.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Files changed since checkpoint 3: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, and this document.

Files changed since checkpoint 2: `packages/sync/src/backup.js`, `packages/sync/test/backup.test.mjs`, `apps/windows/src-tauri/src/backup_restore.rs`, new `apps/windows/test/generate-native-restore-fixture.mjs`, new `apps/windows/test/native-restore-plan.json`, and this document.

Known blocker: no external blocker. The native restore is an isolated active directory, but the current authoring UI/database selector does not open it. There is no production-safe cleanup scheduler, production email transport or real billing adapter. The exact post-grace hosted-read cutoff versus membership-based read until physical cleanup is a contract/implementation ambiguity; no rule change was made here.

Exact next action: continue the authority/Pro/race matrix, especially inherited-seat behavior across release, recovery and coverage transfer. Design a controlled authoring-workspace selector for the separate restore, with per-workspace SQL/migration/SDS routing and rollback; do not merge a restored Company into the existing primary DB. Resolve the hosted-read cutoff ambiguity before main integration. Run `git status --short`, fetch `origin/main`, and compare it with the recorded base before new edits.

Uncommitted work at this checkpoint: none expected after commit; run `git status --short` to verify.

**DO NOT CLAIM YET:** complete commercial convergence; native restore integrated into the active authoring UI; existing Company merge; production billing/email/cleanup; real-cloud security denial tests; precise post-grace rule-level read cutoff; live commercial deployment; completed Pro/adversarial matrix; main integration.
