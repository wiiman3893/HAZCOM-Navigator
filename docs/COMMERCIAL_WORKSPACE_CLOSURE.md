# Commercial/workspace convergence closure

Integration status: validated and ready for non-destructive main integration. No deployment or real Firebase mutation.

## Recovered state

- Starting remote main: `30fa9fd2ca6d46d1892259340c165b3e7ff57157`.
- Starting task: `342e2a97911a0d534c7c74f2dfd2a18308095872`.
- Working tree and index were clean, with no unpushed commits. The usage-interrupted patch never executed.
- Verified earlier checkpoints: `25b82a210b17ba18ae9b1e1710e0b3476a0bd1a0`, `b09b49460becec7268b5517c4fc41943442b5bad`, and the starting task above.
- Access-refresh fix committed/pushed as `8b447521316010bf32013f3c22c8823dc82ded46`.

## Defects and fixes

1. Access refresh reused the cached native lease, and React reran workspace initialization only for ID/role changes. It now rechecks live coverage on refreshed Company context. A mode change closes the old native session before reopening the same workspace; authorization/reopen failure leaves the application closed, and stale controls disappear. Same-mode refresh retains the token. Delayed refresh cannot close a newer workspace.
2. Zero-SDS restores did not create their managed attachment root and could not reopen. Staging now creates the empty root, and the real JavaScript/native bridge exports, restores and reopens an empty Company before the full authoring scenario.
3. An ending coverage document could grant read/export capability when the subscription resolved to an unknown/null plan. The release override now requires a recognized Company or Pro plan. Tests include absent, unknown, inactive and unknown-catalog subscriptions. A legitimate expired paid subscription may still use its separately valid Company release window. Windows export follows the authoritative Company capability without a second subscription-status decision.
4. The Firebase test fixture read the clock twice for an exact 14-day grace window. A 1 ms difference produces an invalid 14-day-plus-1-ms entitlement; a deterministic resolver experiment reproduced active → expired. The fixture now uses one timestamp. Production deadline validation remains strict. The first closure diagnostic run failed with a missing shared Company fixture; its truncated tail did not retain the initial setup failure. A full logged rerun passed 24/24, and final regression passed after the fixture correction.

## Bounded audit conclusions

The complete task diff was reviewed against its main base, including core commercial transitions, trusted adapters, Membership changes, Rules, native restore/session/file handling, backup projection, publication routing, diagnostics, tests and documentation. No unrelated setup/source-reference/credential files are part of the diff.

| Area | Evidence and result |
|---|---|
| Billing failure/recovery/replay | Core and emulator tests cover first failure, repeated IDs/different IDs, fixed grace deadline, persisted deletion of failure state, recovery and stale effective-time rejection. |
| Cancellation, release, takeover, seats | All six sequential orderings plus concurrent release/takeover/removal preserve exact Company capacity, direct Membership and replacement coverage; inherited-only access is removed. |
| Hosted content cutoff | Firestore and both SDS schemas deny at the deadline while content still exists; replacement restores access. Trusted transition transactions update the Membership deadline with authority state. |
| Role/capability separation | Manager/Administrator authoring, Member personal-data restrictions, Demo publication denial, paid grace restrictions and direct privilege-write denials are emulator-tested. |
| Native sessions | Tokens bind SQL, SDS and journals. Old pools close; stale tokens reject. Mode transition invalidates writable state before reopen, including failed reopen. |
| Restore and backup | Fresh staging/atomic directory activation, Company/relationship/hash checks, A/B/primary isolation, empty restore, corrupted candidates and registry fallback are tested. Concurrent row/SDS/Trash changes reject mixed exports. |
| Publication | Actual native SQLite + local Functions prove distinct A/B fingerprints/journals/SDS, upload and finalization response-loss recovery, no duplicate revision, both switch exclusion directions and untouched primary journal. |
| Diagnostics | Read-only inventory tests verify unchanged SQLite/registry bytes. Remembered preference is not presented as actual in-memory selection or live authorization. |

## Validation

| Command | Closure result |
|---|---|
| `npm test` | PASS: core runner + 13 commercial tests, SQLite validation, sync and 14 authoring tests. |
| `npm run test:firebase` | PASS: 24/24 after the single-clock fixture correction. |
| `npm run test:authoring` | PASS: 14/14, executed within `npm test`. |
| `npm run test:authoring:ui` | 10/10 passed. |
| `npm run test:windows:publication` | 12/12 passed. |
| `npm run test:windows:publication:emulator` | Passed after final production fixes. |
| `npm run test:diagnostics` | 12/12 passed in closure diagnostic run. |
| `npm run build` | PASS: Windows and mobile production builds. |
| `npm run build -w @hazcom/firebase-functions` | Passed. |
| `cargo test --manifest-path apps/windows/src-tauri/Cargo.toml` | All targets passed: 11 library tests, binary/doc targets with no tests. |
| `npm run diagnostics:full` | PASS for all six test/build groups; overall WARN only for the four live-security probes. Evidence: `diagnostics/output/20260927T223956`. Earlier failed report retained at `diagnostics/output/20260927T223347`. |
| `git diff --check` | Passed. |

## Safety and remaining boundaries

No Functions/Rules deployment, IAM change, real publication, real Membership/commercial mutation, cleanup or billing-provider action occurred. Emulator writes used `demo-hazcom-navigator`. Existing frozen/archive branches are preserved. The unrelated canonical checkout remains untouched with its existing local changes; `Setup-HazComNavigator.ps1` SHA-256 is `BEA03E4ECB61044DD9B1A426B03E3B434A202C78AE1C950B560C332790EC7112`.

DO NOT CLAIM YET:

- Live authenticated nonmember SDS denial, Member publication denial, Demo publication denial, or direct privileged-field write denial. Emulator evidence does not supply those live probes.
- Fresh signed-in native visual acceptance during closure; tests exercised actual native services and actual React components with isolated browser adapters.
- Deployed commercial deadlines. A separately approved rollout must backfill existing Memberships, verify the coverage index and audience transaction-size limits, and coordinate compatible Functions/Rules.
- Production billing/webhooks, email/backup delivery, scheduled cloud cleanup, cloud restore, offline entitlement leases or production OAuth packaging.

Backup v2 intentionally omits unfinished Bulk SDS review sessions. Local manifest hashes detect corruption; they are not signatures against an OS user who can edit the database and sidecars. Backup input remains bounded by the existing 100 MiB UI limit, 5 MiB per SDS and native record/file limits. Large deadline audiences require rollout capacity assessment; failed transactions must remain atomic. Vite's large-chunk warning and native test-helper dead-code warnings are informational.

The next recommended frontier is a separately scoped development rollout rehearsal and approved live security acceptance, including Membership backfill planning and signed-in native acceptance of coverage transitions. No new feature area is started by this closure task.
