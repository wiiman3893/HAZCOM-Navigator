# Commercial lifecycle convergence work resume

This is an isolated local task branch. It is not deployed and is not on `main`.

- Base and last fetched `origin/main`: `30fa9fd2ca6d46d1892259340c165b3e7ff57157`.
- Branch: `work/commercial-lifecycle-convergence-2026-09-26`.
- Current task SHA: resolve `git rev-parse HEAD` in this branch; this document is part of the checkpoint commit, so embedding its own hash would change that hash.
- Cloud mutations performed: **NONE**. No deployment, IAM, billing, live Company mutation, or cleanup.
- `Setup-HazComNavigator.ps1`: untouched in the separate canonical checkout.

## Completed checkpoint

- Priority 1, partial: inspected the canonical commercial contract, core resolver/event reducer, Firebase coverage/backend, native authoring/export gates, rules, and the backup importer. Plan, billing cadence, Membership role, commercial coverage and authorization remain separate. The task has not completed a full operation-by-operation authority matrix.
- Priority 2, partial: provider-neutral events now reject starting an already paid subscription, early renewal, renewal after cancellation, Demo/unknown paid events, expired/grace seat additions, missing seat removal, unknown coverage transfer, and reused event IDs with conflicting identity. Payment failure now records its effective time and bounded grace; recovery clears the failure marker. The trusted adapter persists that marker.
- Priority 4, partial: backup format v2 binds sorted SDS descriptors into the manifest; v1 remains readable. Preflight validates Company ownership chains, link targets, history scope, SDS metadata/bytes and duplicate IDs before staging any file. Import requires a fresh Company destination.
- Functions packaging now copies current core output before TypeScript compilation so the build checks current commercial types.

Files changed in this checkpoint: `packages/core/src/commercial.ts`, `packages/core/test/commercial.test.mjs`, `packages/sync/src/backup.js`, `packages/sync/test/backup.test.mjs`, `firebase/functions/src/commercial-admin.ts`, `firebase/functions/package.json`, and this document.

Validation passed: `npm run test:core` (10 commercial tests and core runner), `npm run test:sync` (9 sync tests including backup), `npm run build -w @hazcom/firebase-functions`. An initial sync test failed because a fixture assumed an `authoring_versions` row; it was corrected and the full suite passed. An initial Functions build failed because it read stale bundled core types; the build order was fixed and it passed.

Known blocker: no external blocker. The native restore/import and atomic activation foundation is not yet implemented. More lifecycle, Pro adversarial, cleanup, diagnostics, and emulator tests remain.

Exact next action: implement a native Windows restore into a **separate fresh** SQLite workspace with v2/v1 package preflight, staged SDS bytes, relationship and hash checks, and atomic activation of that separate workspace; reject an existing active destination instead of merging. Then add native failure tests. Follow with backend authority/coverage tests and the remaining regression matrix.

Uncommitted work at this checkpoint: none expected after commit; run `git status --short` to verify.

**DO NOT CLAIM YET:** complete commercial convergence; complete native restore; production billing/email/cleanup; real-cloud security denial tests; live commercial deployment; completed Pro/adversarial matrix; main integration.
