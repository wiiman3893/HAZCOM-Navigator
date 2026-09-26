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

Known blocker: no external blocker. The native restore is an isolated active directory, but the current authoring UI/database selector does not open it. There is no production-safe cleanup scheduler, production email transport or real billing adapter. The exact post-grace hosted-read cutoff versus membership-based read until physical cleanup is a contract/implementation ambiguity; no rule change was made here.

Exact next action: commit this validated checkpoint on the task branch, push the task branch, then continue with a read-only/open path for restored workspaces or an explicit import-activation UX decision. Do not merge a restored Company into the existing primary DB. Follow with the broader authority/Pro/race matrix and hosted-read cutoff decision before main integration.

Uncommitted work at this checkpoint: none expected after commit; run `git status --short` to verify.

**DO NOT CLAIM YET:** complete commercial convergence; native restore integrated into the active authoring UI; existing Company merge; production billing/email/cleanup; real-cloud security denial tests; precise post-grace rule-level read cutoff; live commercial deployment; completed Pro/adversarial matrix; main integration.
