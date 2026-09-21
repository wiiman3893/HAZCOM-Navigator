# Codex handoff — Firebase checkpoint

> **Checkpoint date:** 2026-09-20. Read this before spending tokens rediscovering Firebase state.

## Already completed and verified

- Firebase development project **HazCom Navigator Dev** exists as `hazcom-navigator-dev` (project number `391606138651`).
- Firebase Web app **HazCom Navigator Windows Dev** exists: `1:391606138651:web:b4b8dab8d0ef45d43f85be`.
- Firestore `(default)` exists in `us-central1`, Native mode / Standard edition.
- Google Authentication is enabled. `localhost` is an authorized domain. Anonymous and email/password auth are disabled.
- FCM API is enabled.
- Firestore rules/indexes in this directory were compiled and deployed to the development project.
- Backend Functions source below was built and tested locally.
- Firebase Auth/Firestore/Storage emulator suite passed **10/10** tests under Node 22 as documented in `VALIDATION.md`.
- The existing `command-rhythm` Firebase project was not used or modified.

## Intentionally implemented backend contracts

Do not regenerate these from scratch unless a requirement changes:

- `bootstrapAccount`
- `createCompany`
- `updateCompany`
- `setActiveCompany`
- `setMembership`
- `coverCompany`
- `recordTrainingCompletion`
- `beginPublication`
- `uploadPublicationSds`
- `finalizePublication`

The security model is deliberate: Firebase owns identity, subscriptions/entitlements, Company coverage, memberships/roles, published revisions, and published SDS access. Windows SQLite owns unpublished working drafts. Mobile SQLite is a published replica/cache. Publication is explicit and revision-oriented; there is no raw SQLite upload and no continuous bidirectional edit sync.

## Completed cloud setup and current client work

- Blaze billing verified enabled with fresh Cloud Billing API; stale MCP billing state was bypassed with a fresh Firebase CLI process.
- Default private bucket `hazcom-navigator-dev.firebasestorage.app` created in US-CENTRAL1.
- All ten existing Node 22 callable Functions deployed ACTIVE in us-central1. Seven-day Artifact Registry cleanup configured. All ten reject unauthenticated cloud calls.
- Firestore and Storage rules deployed and remote source compared to this checkout. The missing-membership Storage null warning was fixed with fail-closed null/default guards; no client writes were enabled.
- Storage cross-service IAM was initially missing because non-interactive CLI deployment skips the check. The Storage service agent now has roles/firebaserules.firestoreServiceAgent. Browser-download CORS is deployed from storage.cors.json.
- Real Google Account bootstrap, 30-day Professional entitlement (existing IAM-only utility), Company/Manager membership and role enforcement passed. No client entitlement bypass.
- Real SDS upload/publication/download/hash, nonmember/unauthenticated denial and overwrite/delete/list denial passed at 2026-09-21T02:48:26Z. Administrative metadata check confirmed no persistent Firebase download token after download. Synthetic Development Smoke Test Companies and one private denial fixture remain in dev only.
- Windows gate implemented: system-browser Google sign-in -> Account -> entitlement -> canonical Memberships -> active Company selection/create -> existing shell. SQLite preload removed; live Manager/Admin authorization required to open drafts. Member view does not open draft SQLite.
- Native relay is intentionally debug-only, loopback-bound, one-use nonce/strict origin, three-minute lifetime, memory-only credentials. Production native OAuth, persistent secure credentials and offline leases remain separate work. See README and VALIDATION for exact verification status.

## Important boundaries for future Codex runs

- Do **not** use `command-rhythm`.
- Do **not** create a second HazCom dev Firebase project.
- Do **not** add anonymous/local-auth bypasses.
- Do **not** let the desktop client write roles, entitlements, coverage, publication pointers, or SDS objects directly.
- Do **not** weaken Firestore/Storage rules merely to make client development easier.
- Do **not** upload the raw Windows SQLite database as synchronization.
- Do **not** edit `docs/constellation/*` to match implementation details; those are source/reference artifacts.
- Billing-provider integration, production Firebase project creation, offline signed entitlement leases, and production native Tauri OAuth/PKCE/return handling remain future work.

See `README.md` for the data model, entitlement semantics, callable contracts, publication flow, SDS path design, and operator commands.
