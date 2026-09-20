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

## Cloud blockers / remaining Firebase work

1. Upgrade **only `hazcom-navigator-dev`** to Blaze / attach billing. Functions deployment previously stopped while enabling Artifact Registry.
2. Provision default Storage bucket `hazcom-navigator-dev.firebasestorage.app` in `us-central1`, restricted/private.
3. Run `npm run firebase:deploy` from repository root. The deployment guard refuses any project other than `hazcom-navigator-dev`.
4. Verify cloud Functions, Storage Rules and Firestore-backed Storage membership lookup.
5. Perform a real authenticated SDS upload/download smoke test and verify no `firebaseStorageDownloadTokens` metadata is left on the object.
6. Run the temporary `npm run firebase:signin` browser harness, Google-sign-in a real dev user, call `bootstrapAccount`, then use `firebase/functions/scripts/dev-admin.mjs` with ADC to grant that UID a temporary development entitlement.
7. Only after the backend smoke test, wire the real Tauri Windows authentication/application gate and active-Company hydration.

## Important boundaries for future Codex runs

- Do **not** use `command-rhythm`.
- Do **not** create a second HazCom dev Firebase project.
- Do **not** add anonymous/local-auth bypasses.
- Do **not** let the desktop client write roles, entitlements, coverage, publication pointers, or SDS objects directly.
- Do **not** weaken Firestore/Storage rules merely to make client development easier.
- Do **not** upload the raw Windows SQLite database as synchronization.
- Do **not** edit `docs/constellation/*` to match implementation details; those are source/reference artifacts.
- Billing-provider integration, production Firebase project creation, offline signed entitlement leases, and final native Tauri OAuth/deep-link handling remain future work.

See `README.md` for the data model, entitlement semantics, callable contracts, publication flow, SDS path design, and operator commands.
