# Development foundation verification — 2026-09-20

| Check | Verified result |
|---|---|
| Project | Firebase MCP and CLI both list `hazcom-navigator-dev`, HazCom Navigator Dev, ACTIVE |
| Windows Web registration | `1:391606138651:web:b4b8dab8d0ef45d43f85be`; public config retrieved from Firebase |
| Google provider | Auth configuration reports Google enabled; localhost added to authorized domains |
| Firestore | `(default)`, STANDARD, FIRESTORE_NATIVE, `us-central1` |
| Firestore rules/indexes | Final CLI deployment succeeded; rules compiled and remote rules retrieved for comparison |
| FCM | `fcm.googleapis.com` enabled |
| Storage cloud | Bucket listing empty; deployment reports Storage not set up; blocked by billing/bucket creation |
| Functions cloud | CLI function listing empty; deployment explicitly blocked enabling `artifactregistry.googleapis.com` without Blaze |
| Aliases/guard | Both alias files point default/dev to HazCom Dev; deployment hook restricts project |
| Firebase suite | 10/10 tests passed on Node.js 24 and **Node.js 22.23.2**, with Java 21/Auth/Firestore/Storage emulators |
| Functions TypeScript | Build passed as part of the suite |
| Existing repository tests | `npm test`: core business rules and SQLite schema/derived-view validation passed |
| Client builds | Windows React/Tauri frontend and mobile React frontend builds passed; no native binary build claimed |
| Sign-in harness | Typecheck passed; localhost HTML and transformed TypeScript returned HTTP 200; interactive Google consent not performed |
| Command Rhythm | No writes/deployments targeted it; listing metadata/etag unchanged from the initial inspection |

Tests exercise actual trusted handlers against emulator Admin services and unprivileged SDK clients against both Rules runtimes. They cover concurrent Customer creation and publication, retries, Professional isolation, self-enrollment/role escalation attempts, tenant and personal-data reads, direct write/delete denial, unsafe payloads, SDS upload/download restrictions, entitlement expiration, self-training, and membership revocation. The Storage null-value log for a nonexistent outsider membership is an expected denied request; it does not open access.

The Storage emulator creates a token after successful GET; production-like token-free download behavior remains a required cloud smoke test after bucket provisioning. Upload verifies token removal before publishing. No end-to-end native Tauri OAuth or real development user entitlement test is claimed.

Compatible npm audit fixes were attempted. Four moderate transitive uuid-related findings remain in the workspace tree (two in the standalone Functions tree); no forced unrelated dependency change was made.

Git staging is limited to Firebase foundation/config/docs, environment example, two Vite type declarations and development commands. The ignored local `.env`, original untracked root `package-lock.json`, Constellation artifacts, Evidence directory, native generated files and other pre-existing untracked files are not part of the foundation commit. No service-account keys, CLI login/refresh credentials or OAuth client secrets are included.

Next: approve Blaze for the development project, provision the default Storage bucket in `us-central1`, deploy remaining resources, then use the real Google sign-in harness and IAM-only entitlement utility described in [README](README.md).
