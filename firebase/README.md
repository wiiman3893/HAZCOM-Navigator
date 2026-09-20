# HazCom Navigator Firebase development foundation

> Future Codex/automation runs: read `CODEX_HANDOFF.md` first. It records what already exists in Firebase and what is still blocked.

## Development project

- Display name: **HazCom Navigator Dev**
- Project ID: `hazcom-navigator-dev`
- Project number: `391606138651`
- Web app: **HazCom Navigator Windows Dev** — `1:391606138651:web:b4b8dab8d0ef45d43f85be`
- Firestore: `(default)`, Native mode, `us-central1`
- Authentication: Google enabled; anonymous and email/password disabled; `localhost` authorized for development
- FCM API: enabled
- Functions: Node.js 22 / `us-central1`; source is implemented but cloud deployment awaits Blaze
- Storage: intended default bucket `hazcom-navigator-dev.firebasestorage.app` in `us-central1`; bucket provisioning/deployment awaits Blaze

The existing `command-rhythm` Firebase project is unrelated and must not be used by HazCom Navigator.

## Authority model

Firebase is authoritative for identity, subscriptions/entitlements, Company coverage, memberships/roles, published revisions, and published SDS access. Windows SQLite remains the unpublished draft/working authority. Mobile SQLite is a local published replica/cache.

The synchronization model is deliberately:

`Windows SQLite draft -> explicit publish -> Firebase immutable revision -> client downloads revision -> local SQLite replica`

Do not upload the raw Windows SQLite database and do not introduce continuous bidirectional edit synchronization.

## Firestore layout

```text
accounts/{uid}
  memberships/{companyId}
subscriptions/{uid}
companies/{companyId}
  memberships/{uid}
  workerLinks/{workerId}
  coverage/current
  publishedRevisions/{revisionId}
    workAreas/{id}
    chemicalProducts/{id}
    workers/{id}
    workAreaProducts/{id}
    workAreaAssignments/{id}
    sdsVerifications/{id}
    hazcomReviews/{id}
    trainingEvents/{id}
    attachments/{attachmentId}
  trainingEvents/{eventId}
```

All ordinary client Firestore writes are intentionally denied. Trusted callable Functions perform privileged mutations and independently enforce identity, entitlement, Company coverage, membership, and role checks.

## Implemented callable Functions

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

Customer creation is transactionally limited to one covered Company and starts the creator as Administrator. Professional creation can cover multiple Companies and starts the Professional as Manager, not Administrator. Company membership and subscription coverage are separate authorities.

Published revisions are immutable and use a staging/finalize workflow with a parent revision check. SDS objects use content-addressed paths:

```text
companies/{companyId}/revisions/{revisionId}/sds/{attachmentId}/{sha256}.pdf
```

Clients may read authorized published SDS objects; they may not write, list, overwrite, or delete them. Trusted Functions perform uploads.

## Development commands

From repository root:

```powershell
npm install
npm test
npm run test:firebase
npm run firebase:signin
npm run firebase:deploy:firestore
npm run firebase:deploy
```

`test:firebase` uses the isolated `demo-hazcom-navigator` emulators. It must never point the security suite at cloud data.

`firebase:signin` runs a temporary browser-only Google sign-in harness. It is not the final Tauri authentication UX and does not grant an entitlement.

## Development entitlement bootstrap

After Functions are deployed, sign in through the development harness and call `bootstrapAccount`. An IAM-authorized operator can then use Application Default Credentials from `firebase/functions`:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'hazcom-navigator-dev'
node scripts/dev-admin.mjs entitlement REAL_FIREBASE_UID professional 30
```

The utility is deliberately not a Cloud Function and must never be exposed in the Windows/mobile client. It accepts only `hazcom-navigator-dev`, requires a real Google-authenticated Firebase UID, writes an audit record, and creates a time-limited development entitlement with the 14-day grace semantics.

## Remaining provisioning

1. Upgrade only `hazcom-navigator-dev` to Blaze / attach billing.
2. Create the default Storage bucket in `us-central1`, private/restricted.
3. Run `npm run firebase:deploy`.
4. Verify deployed Functions, Storage Rules, and cross-service membership checks.
5. Run a real authenticated SDS upload/download and confirm no `firebaseStorageDownloadTokens` metadata is left on the object.
6. Create a real dev identity/entitlement, then wire the Windows Tauri application gate.

Do not commit `.env`, Admin credentials, Firebase CLI credentials, refresh tokens, service-account keys, or OAuth client secrets. The public Web SDK configuration is intentionally kept in `.env.example`.
