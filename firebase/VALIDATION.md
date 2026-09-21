# Verified local working checkpoint — 2026-09-21

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

Source snapshots do not back up cloud or SQLite data. Development Firestore PITR and deletion protection were observed disabled. Offline leases, billing-provider webhooks, Windows publisher serialization, mobile replica importing, App Check enforcement and large-scale publication remain unimplemented.
