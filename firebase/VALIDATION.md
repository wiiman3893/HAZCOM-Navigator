# Verified local working checkpoint — 2026-09-21

## Current scalable publication source checkpoint — 2026-09-22

Schema 2 staged publication is implemented and emulator-verified for **Small, Medium, Large (2,000 SDS), and Stress (5,000 SDS)**, each through independent SQLite replication. Main now uses immutable manifests, bounded chunks, authenticated binary PDF uploads, progress/resume, sealed validation, a two-document final transaction and privileged abandoned-staging cleanup. The old numeric limits were not raised; schema 1 endpoints remain explicitly isolated for compatibility/regression tests. Existing Google sign-in, Account/entitlement/Membership/Company and SQLite foundations remain intact.

See [scalable publication handoff](../docs/SCALABLE_PUBLICATION_HANDOFF.md), [measured results](../docs/scalable-publication-results.json), and the security audit. The new permanent branch is `frozen/scalable-publication-proof-2026-09-22`; never repoint it or any older frozen ref. **This is a validated source/emulator milestone, not a new cloud deployment.** The development cloud still has its earlier deployed Functions/rules until a coordinated deployment of the new Functions, indexes, rules and clients is performed.

The sections below retain historical foundation/checkpoint details. Their 350-record/3-MB/100-attachment publication description applies to schema 1 only; current client publishing uses schema 2.


The local source was committed as `64b65c9311557de05eb93840ae88ff4ec0c46fb4` and pushed to main and `frozen/working-google-auth-2026-09-21`. The old GitHub main was preserved at `archive/pre-local-working-import-2026-09-21` (`d9bf90897003c4a5f46b32348706114610b53fea`). Remote refs and authentication files were verified after push. No remote history rewrite or replacement of the working local auth approach occurred.

## Actual cloud state

| Check | Verified result |
|---|---|
| Project / app | Existing `hazcom-navigator-dev`, number `391606138651`, Web app `1:391606138651:web:b4b8dab8d0ef45d43f85be` |
| Auth | Google enabled; real Google UID present and enabled; anonymous/email-password disabled; localhost authorized |
| Billing | Fresh Cloud Billing API returns billingEnabled=true |
| Firestore | `(default)`, STANDARD, FIRESTORE_NATIVE, us-central1 |
| Rules | Remote Firestore and Storage release sources retrieved and compared with repo; all direct client writes denied |
| Index | trainingEvents workerId ASC + createdAt ASC present; server includes its normal __name__ suffix |
| FCM | fcm.googleapis.com enabled |
| Functions | All ten existing functions ACTIVE, us-central1, nodejs22; unauthenticated cloud calls rejected |
| Storage | Private hazcom-navigator-dev.firebasestorage.app in US-CENTRAL1; no public IAM binding |
| Storage integration | Storage service agent has firebaserules.firestoreServiceAgent; local GET/HEAD CORS recorded in storage.cors.json |
| Deployment housekeeping | Seven-day Artifact Registry cleanup configured |
| Unrelated project | No writes/deployments targeted command-rhythm |

The ten functions are bootstrapAccount, createCompany, updateCompany, setActiveCompany, setMembership, coverCompany, recordTrainingCompletion, beginPublication, uploadPublicationSds and finalizePublication. A cached MCP process initially reported stale billing state; fresh CLI deployment and API verification succeeded. Non-interactive CLI deployment skipped cross-service IAM; granting the documented role to the Storage service agent fixed authorization. Browser getBytes also required explicit bucket CORS. Neither fix loosened Security Rules.

## Real-cloud evidence (not emulator substitutes)

The signed-in user's cloud harness passed at **2026-09-21T02:48:26.742Z**. It used actual Google Auth, bootstrapped the Account, read a temporary 30-day Professional entitlement assigned by the existing IAM-only development utility, created a Company with Manager membership, selected it, and verified Manager administration/self-promotion/client-entitlement writes were denied.

SDS checks passed: trusted PDF upload, atomic immutable publication, authenticated member getBytes with matching SHA-256, unauthenticated download denial, signed-in nonmember download denial against a private fixture, and direct overwrite/delete/broad-list denial. The operator read object metadata after download: **no persistent firebaseStorageDownloadTokens**. The upload Function also checks token absence before registering the attachment.

Evidence Company: `smoke-5e801676-e4a3-4ba1-aca4-9629385730b0`; revision: `d5bd3eb4-0a56-4b69-bb5d-e0f87ac5f5d7`; SHA-256: `b8274cd2f933ba897ac5a626e96063aa6ed45d4389b105279661a55aedd2bc6f`. This is a synthetic development PDF, not a safety document. The ignored local report is firebase/.firebase/cloud-smoke.json. Smoke Companies/private fixture remain in development; no production data was created.

The unauthorized signed-in check uses a real signed-in user with no membership in the fixture Company, not a fabricated second Google identity. A separate human account was not tested.

## Validation of the committed local source

| Command/check | Result |
|---|---|
| npm install | Passed; lockfiles retained; four existing moderate advisories, no forced audit fix |
| npm test | Core business-rule tests and SQLite schema/derived-view validation passed |
| npm run test:firebase | **10/10 passed**, Java 21, Node 24 workstation, isolated demo-hazcom-navigator |
| npm run build | Core, Windows frontend and mobile frontend passed |
| npm run build -w @hazcom/firebase-functions | TypeScript build passed; deployed runtime remains Node 22 |
| cargo test --lib --manifest-path apps/windows/src-tauri/Cargo.toml | Passed callback security test (Host/Origin/nonce/replay/body limits) |
| npm run tauri -w @hazcom/windows -- dev | Debug native build and actual executable launch succeeded |
| Actual Google -> native return | User explicitly confirmed choosing Gmail and the app unlocking; no embedded-login shortcut |
| Actual local workspace DB | Read-only inspection: integrity_check=ok; both SQLx migrations successful; authenticated development Company headers persisted |
| Secrets/artifacts | Staged source scan found no credential/private-env/generated-output candidates; required untracked auth files included |

The missing-membership Storage null-value warning is resolved with fail-closed guards, without increasing its two document lookups. The latest suite had no Storage null warning. A non-fatal Admin SDK metadata-discovery warning remains. Node 24 produces a Node 22 engine warning locally; cloud Functions are verified nodejs22. The Windows Firebase bundle emits a size warning; no cosmetic/bundling rewrite was made.

## Precise acceptance limits

No release installer or production OAuth flow was tested: the current native relay intentionally rejects release builds. Windows and browser Firebase sessions are memory-only, so restart requires sign-in again. The September 21 native launch succeeded, but direct desktop inspection returned **Computer Use app approval timed out** while the user was away. Fresh visual verification of restart, logout/relogin, popup cancellation and every front-door state was therefore not completed; these are code-reviewed behaviors, not claimed interactive passes. No permission/authentication bypass was used to manufacture evidence.

The authenticated Company/front-door implementation and prior user-confirmed sign-in are preserved. Local database evidence independently verifies initialization/persistence after the SQL capability fix. See [Windows auth handoff](../docs/WINDOWS_AUTH_HANDOFF.md) for implementation details, the state matrix, production work and ranked technical risks.

Source snapshots do not back up cloud or SQLite data. Development Firestore PITR and deletion protection were observed disabled. Offline leases, billing-provider webhooks, App Check enforcement and large-scale publication remain unimplemented. Windows publisher serialization and independent SQLite replica importing are now implemented and emulator-proved; physical mobile-device acceptance remains separate.


## Publication/replication proof — September 21, 2026

The deterministic Company-scoped Windows SQLite serializer, durable publication orchestration, authorized receiver, atomic independent SQLite replacement, SDS verification and separate Training Event reconciliation are implemented in `@hazcom/sync`. A real callable emulator harness proves Small Company publication, clean Device B import, later revisions, interrupted/failed imports, privacy enforcement and training reconciliation. Existing Firebase server code/rules and limits are unchanged; no cloud deployment was needed.

Small is 140 records/20 SDS files. Medium (1,560/250) and Large (10,700/2,000) are rejected by the unchanged 350-record/100-attachment limits, while local SQLite import benchmarks succeed. Exact JSON/PDF boundaries are also executable tests. See [publication/sync handoff](../docs/PUBLICATION_SYNC_HANDOFF.md) for APIs, test commands, measurements, failure recovery, platform acceptance limits and the proposed scalable publisher. The new permanent checkpoint is `frozen/publication-replication-proof-2026-09-21`; existing frozen/archive refs must not be moved.

### Executed publication proof validation

| Check | Result |
|---|---|
| npm test | Passed: existing core tests, canonical SQLite validation, all 4 new publication/replica test groups |
| npm run test:firebase | Passed: all 10 existing Firebase foundation/security tests |
| npm run test:sync:emulator | Passed: 12 end-to-end cases plus the containing test (13/13), actual callable emulator transport |
| npm run build | Passed: core, sync package, Windows and mobile TypeScript/frontend builds |
| cargo check | Passed: native Windows SDS reader compiles |
| Limits | Exact 350 records + 100 attachments finalized; 351/101 rejected; 3,000,000-byte dataset accepted by backend validator, +1 rejected; 5 MiB upload accepted, +1 rejected |
| Replica isolation/atomicity | Separate databases, fingerprint equality, rollback fault injection, concurrent-reader visibility and revision/member races passed |

The final full emulator run took about 94 seconds on this workstation. The published JSON reports record UTC timestamps and measured values. Functions emulation used host Node 24 rather than deployed Node 22, with the CLI's existing engine warning. The existing frontend bundle-size and Admin metadata-discovery warnings remain non-fatal. No new real-cloud or physical mobile-device acceptance is claimed.


## Scalable publication validation

- `npm test`: existing core and canonical SQLite checks plus all 6 sync test groups passed.
- `npm run build`: core/sync, Windows and mobile frontend/TypeScript builds passed.
- Firebase Functions TypeScript build passed; cloud target remains Node 22 while local emulators use Node 24.
- `cargo check`: native Windows compile check passed.
- `npm run test:scale`: adversarial/recovery suite and all four full publication/replica fixture cases passed (6 tests including the parent).
- Small: 140 records, 20 SDS. Medium: 1560/250. Large: 10700/2000. Stress: 28000/5000. No dataset was counted as successful before its receiving SQLite fingerprint matched.

Full performance, operation estimates, cleanup tests and known platform/cloud limits are in [SCALABLE_PUBLICATION_HANDOFF.md](../docs/SCALABLE_PUBLICATION_HANDOFF.md).


### Final compatibility and security addendum — 2026-09-22

- `npm run test:firebase`: 10/10 passed against Auth/Firestore/Storage emulators.
- `npm run test:sync:emulator`: 13/13 passed, including the parent test. The existing schema 1 real-callable publication, revision replacement, Member privacy, training reconciliation, failure recovery and revoked access regressions remain valid.
- Supplemental schema 2 adversarial run: 2/2 passed, including the parent. Adds correctly hashed unauthorized manifest attempts, unauthenticated binary upload and Administrator revocation to the full-scale run’s adversarial coverage.
- Full schema 2 scale proof: 6/6 passed, including the parent; all four fixtures completed independent SQLite replication.
- Evidence: [legacy emulator results](../docs/publication-sync-emulator-results.json), [full scalable results](../docs/scalable-publication-results.json), [supplemental security results](../docs/scalable-publication-security-results.json), [security audit](../docs/SCALABLE_PUBLICATION_SECURITY_AUDIT.json).

The only subsequent edits were documentation and clarification that the legacy local benchmark reports schema 1 limits. No production implementation changed after the successful full-scale run. No cloud deployment or physical mobile runtime validation was performed.
