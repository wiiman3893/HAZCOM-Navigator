# Commercial lifecycle convergence work resume

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

Files changed since checkpoint 5: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Files changed since checkpoint 4: `firebase/functions/src/index.ts`, `firebase/functions/test/foundation.test.mjs`, `docs/ENTITLEMENT_ENGINE_HANDOFF.md`, and this document.

Files changed since checkpoint 3: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/test/foundation.test.mjs`, and this document.

Files changed since checkpoint 2: `packages/sync/src/backup.js`, `packages/sync/test/backup.test.mjs`, `apps/windows/src-tauri/src/backup_restore.rs`, new `apps/windows/test/generate-native-restore-fixture.mjs`, new `apps/windows/test/native-restore-plan.json`, and this document.

Known blocker: no external blocker. The native restore is an isolated active directory, but the current authoring UI/database selector does not open it. There is no production-safe cleanup scheduler, production email transport or real billing adapter. The exact post-grace hosted-read cutoff versus membership-based read until physical cleanup is a contract/implementation ambiguity; no rule change was made here.

Exact next action: commit/push checkpoint 8, then continue the broader authority/Pro/race matrix. A future authoring-workspace switch needs an explicit isolated-data design; do not merge a restored Company into the existing primary DB. Resolve the hosted-read cutoff ambiguity before main integration.

Uncommitted work at this checkpoint: none expected after commit; run `git status --short` to verify.

**DO NOT CLAIM YET:** complete commercial convergence; native restore integrated into the active authoring UI; existing Company merge; production billing/email/cleanup; real-cloud security denial tests; precise post-grace rule-level read cutoff; live commercial deployment; completed Pro/adversarial matrix; main integration.
