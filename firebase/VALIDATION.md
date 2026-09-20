# Development foundation verification — 2026-09-20

This checkpoint was produced by the uploaded Codex working folder and is retained so future work does not need to rediscover completed Firebase setup.

| Check | Verified result |
|---|---|
| Project | Firebase MCP and CLI both listed `hazcom-navigator-dev`, HazCom Navigator Dev, ACTIVE |
| Windows Web registration | `1:391606138651:web:b4b8dab8d0ef45d43f85be`; public config retrieved from Firebase |
| Google provider | Auth configuration reported Google enabled; localhost added to authorized domains |
| Firestore | `(default)`, STANDARD, FIRESTORE_NATIVE, `us-central1` |
| Firestore rules/indexes | CLI deployment succeeded; rules compiled and remote rules were retrieved for comparison |
| FCM | `fcm.googleapis.com` enabled |
| Storage cloud | Bucket list was empty; deployment reported Storage not set up; blocked by billing/bucket creation |
| Functions cloud | CLI function list was empty; deployment was blocked enabling `artifactregistry.googleapis.com` without Blaze |
| Aliases/guard | default/dev point to HazCom Dev; deployment hook restricts project |
| Firebase suite | 10/10 tests passed on Node.js 24 and Node.js 22.23.2 with Java 21/Auth/Firestore/Storage emulators |
| Functions TypeScript | Build passed as part of the suite |
| Existing repository tests | `npm test` passed core business rules and SQLite validation |
| Client builds | Windows React/Tauri frontend and mobile React frontend builds passed; no native binary build claimed |
| Sign-in harness | Typecheck passed; localhost harness served successfully; interactive Google consent was not performed |
| Command Rhythm | No writes/deployments targeted it |

The emulator suite covers concurrent Customer creation/publication, retries, Professional isolation, self-enrollment/role escalation attempts, tenant and personal-data reads, direct write/delete denial, malformed payloads, SDS restrictions, entitlement expiration, self-training, and membership revocation.

The Storage emulator may generate a bearer download token after a successful GET. A real cloud smoke test after bucket provisioning must verify production objects remain token-free before and after authenticated download.

No end-to-end native Tauri OAuth or real development-user entitlement test is claimed at this checkpoint. Re-run the suite after dependency installation and before modifying the security model.
