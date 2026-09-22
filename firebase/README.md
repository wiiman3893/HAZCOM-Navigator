# HazCom Navigator Firebase development foundation

## Current scalable publication source checkpoint — 2026-09-22

Schema 2 staged publication is implemented and emulator-verified for **Small, Medium, Large (2,000 SDS), and Stress (5,000 SDS)**, each through independent SQLite replication. Main now uses immutable manifests, bounded chunks, authenticated binary PDF uploads, progress/resume, sealed validation, a two-document final transaction and privileged abandoned-staging cleanup. The old numeric limits were not raised; schema 1 endpoints remain explicitly isolated for compatibility/regression tests. Existing Google sign-in, Account/entitlement/Membership/Company and SQLite foundations remain intact.

See [scalable publication handoff](../docs/SCALABLE_PUBLICATION_HANDOFF.md), [measured results](../docs/scalable-publication-results.json), and the security audit. The new permanent branch is `frozen/scalable-publication-proof-2026-09-22`; never repoint it or any older frozen ref. **This is a validated source/emulator milestone, not a new cloud deployment.** The development cloud still has its earlier deployed Functions/rules until a coordinated deployment of the new Functions, indexes, rules and clients is performed.

The sections below retain historical foundation/checkpoint details. Their 350-record/3-MB/100-attachment publication description applies to schema 1 only; current client publishing uses schema 2.


## Project and provisioned resources

- Display name: **HazCom Navigator Dev**
- Project ID: **hazcom-navigator-dev**; project number: **391606138651**
- Web app: **HazCom Navigator Windows Dev**, `1:391606138651:web:b4b8dab8d0ef45d43f85be`
- Tauri Windows identifier remains `com.saturnstraw.hazcomnavigator`. Firebase uses a Web registration for the JavaScript frontend, not an Android registration for Windows.
- Firestore: **Standard**, Native mode, **(default)** database, **us-central1**. Created and verified on 2026-09-20. This preserves the existing SDK/default-database model and supports Storage Rules' default-Firestore lookup requirement.
- Authentication: Google provider enabled; localhost authorized. Anonymous and email/password are not enabled. Google OAuth browser consent still requires the actual user.
- Firebase Cloud Messaging API: enabled and verified. Device registration, APNs credentials, Android app registrations, service workers and notification dispatch belong to subsequent client work.
- Functions: all ten callables deployed ACTIVE on Node.js 22 in `us-central1`, 512 MiB, maximum 3 instances per function. Artifact Registry cleanup retains seven days. Blaze billing verified enabled through the fresh Cloud Billing API.
- Storage: **hazcom-navigator-dev.firebasestorage.app**, **US-CENTRAL1**, provisioned privately; rules deployed. Cross-service Firestore IAM and local development download CORS are configured. Real authenticated SDK download passed, with no persistent download-token metadata before or after download.
- No application Hosting deployment or mobile Crashlytics setup. Firebase's project creation supplies a default hosting-site identifier used by Auth; no application website was deployed.
- No production project/alias. No writes or deployments target `command-rhythm`.

`../.env.example` contains verified public Web SDK configuration. `../.env` is ignored and must stay uncommitted. Never add Admin credentials, CLI credentials or refresh tokens. The Windows application now gates the existing shell behind Google sign-in, live Account/entitlement/membership reads and Company selection. Its native browser relay is intentionally development-only; see below.

## Run and deploy

Run commands at the repository root unless stated otherwise. Use Node.js 22 for Functions and Java 21+ for emulators.

```powershell
npm install
npm run build
npm test
npm run test:firebase
npm run firebase:signin
```

If Java is installed only with Android Studio:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
```

`test:firebase` uses the isolated `demo-hazcom-navigator` Auth, Firestore and Storage emulators. The suite refuses to run without all three emulator endpoints. It invokes the actual callable handlers against emulator-backed Admin services, and tests Firestore/Storage Rules with unprivileged SDK clients. Auth token signature verification is supplied by Firebase's callable transport; handler tests do not substitute for a deployed callable smoke test.

Both repository-root and `firebase/.firebaserc` map `default` and `dev` to **hazcom-navigator-dev**. Configuration lives in this existing `firebase/` directory. Use the root shortcut or change directory:

```powershell
npm run firebase:deploy
# Equivalent:
cd firebase
npx -y firebase-tools@latest deploy --project hazcom-navigator-dev
# Deploy only the already-available database:
npx -y firebase-tools@latest deploy --only firestore --project hazcom-navigator-dev
```

Firestore, Storage and Functions predeploy hooks reject any project ID other than `hazcom-navigator-dev`. There is no production alias or reference to Command Rhythm as a deployment target. The Hooks are guardrails against accidental targets; IAM remains the remote administrative boundary.

## Verified development provisioning (2026-09-20 Chicago / September 21 UTC)

Billing, bucket provisioning, all ten Functions, and both rules deployments are complete. The real Google-authenticated smoke test passed at 2026-09-21T02:48:26Z. The operator verified the uploaded object still had no persistent Firebase download token after the client download. See [VALIDATION.md](VALIDATION.md) for evidence and [CODEX_HANDOFF.md](CODEX_HANDOFF.md) before continuing.

Two prerequisites were discovered by the live SDS test:

1. Firebase Storage's service agent `service-391606138651@gcp-sa-firebasestorage.iam.gserviceaccount.com` needs `roles/firebaserules.firestoreServiceAgent` on this project. This is now assigned. Firebase CLI 15.30.2 skips its cross-service IAM check with `--non-interactive`, and skips it when the rules upload is unchanged; a successful rules deployment alone does not prove the binding exists. Keep this role on the Google service agent only. See [cross-service permissions](https://firebase.google.com/docs/rules/manage-deploy#manage_permissions_for_cross-service).
2. Browser SDK `getBytes` requires bucket CORS. [storage.cors.json](storage.cors.json) records the deployed GET/HEAD origins: localhost ports 1420/1421 and the Windows Tauri origin. This does not grant object access; Storage Rules still enforce membership. To apply the same configuration with an authenticated Cloud SDK: `gcloud storage buckets update gs://hazcom-navigator-dev.firebasestorage.app --cors-file=firebase/storage.cors.json`. See [Firebase direct download requirements](https://firebase.google.com/docs/storage/web/download-files#cors_configuration).

The Firebase MCP process held a stale billing-disabled cache; a fresh Firebase CLI process verified billing and deployed successfully. Do not create another project or change the runtime to work around stale process state. Google sign-in is enabled, localhost is authorized, anonymous/email-password auth remain disabled. CLI 15.30.2 did not originally apply authorizedDomains; it was set separately through the authenticated Auth API and verified.

See [Windows auth handoff](../docs/WINDOWS_AUTH_HANDOFF.md) for the frozen commit, exact authentication mechanism, state matrix, acceptance limits and ranked next tasks. The actual user confirmed browser sign-in unlocked the native app; the local Company workspace database was independently checked.

## Windows authenticated development entry

Copy the public repository `.env.example` to ignored `.env` if needed. Run `npm run tauri -w @hazcom/windows -- dev` from the repository root. The native app opens its sign-in page in the system browser. Click **Continue with Google**, finish Google's consent, and return to Windows. The Firebase Web SDK exchanges the returned Google ID token for a Firebase session, calls bootstrapAccount, reads the Account/entitlement and membership discovery index, rechecks canonical Company membership, and restores or selects the active Company through setActiveCompany. Eligible accounts can create a Company through createCompany; backend plan/count/role checks remain authoritative.

The relay binds only to 127.0.0.1 on an ephemeral port, uses a 256-bit one-use state value in a fragment removed from browser history, checks exact Host/Origin, accepts bounded JSON only, and expires after three minutes. Google credentials are POSTed locally and passed to Firebase; no token is put in a URL, log, localStorage or SQLite. Browser and Windows Firebase sessions use memory persistence. The relay is disabled in release builds and restricted to the existing dev project. Its official Firebase browser modules are version-pinned to 12.19.0. This is a development bridge, not the finalized production OAuth architecture.

SQLite preload was removed. The local draft workspace opens only after a live Google Account and canonical Manager/Administrator membership check. Company IDs/names come from Firebase, not an unauthenticated local selector. Members see a verified access screen without reading local Worker/draft records. Account/Company switching, sign-out, offline events, membership listeners, focus and periodic refresh clear or revalidate the shell. This session adds no domain CRUD or publication UI. Existing membership retains entry when the user's personal subscription expires; server mutations still check Company coverage. No signed offline lease is implemented.

Before production: choose/register the production desktop OAuth/PKCE or approved HTTPS return architecture, verify production origins/CSP/App Check, add OS-protected session persistence if desired, and implement the reviewed offline lease. Do not enable the development relay in release builds as a shortcut.

## Authority and data layout

Company is the only Organization object. Every Company-owned dataset is nested beneath its stable Company ID. IDs are 1–128 characters matching `[A-Za-z0-9][A-Za-z0-9_-]*` (UUIDs work).

```text
accounts/{uid}                         private Account profile and activeCompanyId
  memberships/{companyId}              server-maintained discovery index for this UID
subscriptions/{uid}                    private entitlement and coveredCompanyCount
administrativeAudit/{eventId}           privileged utility audit; no client reads/writes
companies/{companyId}                   Company settings and current revision pointer
  memberships/{uid}                    canonical role/active/workerId
  workerLinks/{workerId}                server-only uniqueness constraint for Worker links
  coverage/current                     sponsoring accountId, independent of membership
  publishedRevisions/{revisionId}       staging → published metadata, parent and number
    workAreas/{id}
    chemicalProducts/{id}
    workers/{id}
    workAreaProducts/{id}
    workAreaAssignments/{id}
    sdsVerifications/{id}
    hazcomReviews/{id}
    trainingEvents/{id}                 immutable draft-history snapshot
    attachments/{attachmentId}          SDS metadata and atomic published marker
  trainingEvents/{eventId}              authoritative append-only post-publication events
```

All client Firestore writes are denied. Every exposed mutation validates a real, enabled Google-authenticated Firebase UID and checks Company authorization again on the server. Account bootstrap is a callable after sign-in, so failure/retry does not depend on an Auth trigger or mint any entitlement.

`accounts/{uid}` and `subscriptions/{uid}` are readable only by that UID. Membership discovery uses `accounts/{uid}/memberships`; it is a transactionally maintained index, not the access authority. Every Company operation checks canonical membership. Company membership lists are Administrator-only, except that each member may read their own membership. Administrators manage Company memberships and settings, not other users' global Firebase identity or personal subscription.

Managers and Administrators can publish HazCom data. Managers cannot modify Company settings, Account membership, or roles. Members may read Company-wide hazard/SDS data; Worker, assignment and training data are limited to their linked Worker. Managers/Administrators may read all those Company records. One active Firebase Account can link to one Worker per Company; a Worker cannot be linked to two active Accounts. Deactivating membership removes online dataset and SDS access. Previously downloaded bytes cannot be remotely erased from an offline device.

## Entitlements and coverage

`subscriptions/{uid}` fields:

- `accountId`, `plan` (`customer` or `professional`), `status` (`active`, `grace`, `export_only`, `inactive`)
- `validUntil`, `graceUntil`: Firestore Timestamps; grace must end no later than 14 days after validUntil
- `coveredCompanyCount`: backend-maintained integer; never trust a client count
- `source`, `version`, `updatedAt`: origin/audit information for future billing updates

Authoring operations require an active/grace entitlement whose server-calculated time window has not ended. Expired `active` documents do not grant unlimited access: authorization checks timestamps on every operation. A scheduled status transition is not necessary to enforce expiration. Both coverage and roles must authorize the operation; a paid account without Company membership has no Company access. Managers may work under another account's valid Company coverage without owning the subscription.

Customer creates and automatically covers one Company, with initial Administrator membership. The count update and Company creation share a transaction, preventing concurrent creation from exceeding the limit. Retry with the same Company ID does not increment the count again.

Professional can create and cover multiple Companies with initial **Manager** membership. They do not receive Administrator authority. An existing Company's Administrator explicitly assigns a Professional Manager membership using `setMembership`; `coverCompany` can then sponsor an uncovered Company. Existing coverage cannot be silently replaced. An independently audited transfer workflow is intentionally deferred. A new Professional-created Company with zero Administrators uses an explicit administrative onboarding action; the development-only first-Administrator utility below can establish the real business administrator without automatically elevating the Professional.

Read/export access to already-published hazard/SDS and permitted personal data is retained while membership is active, including after entitlement expiration/inactivation. Payment loss disables Company creation, publication, membership/settings changes and training mutations; it does not destroy retained safety data. Revoke Company membership to remove distributed read access. This applies consistently to Firestore and Storage.

No billing processor, price charging, webhook, or production entitlement self-service is implemented. A future verified payment-provider handler must update subscription state using Admin authority, preserve coverage counters, enforce Customer downgrade limits, increment `version`, and write an audit record. It must never grant roles as a side effect.

## Development identity and entitlement bootstrap

1. Run `npm run firebase:signin`; open [local development sign-in](http://localhost:1421). Sign in with Google. This uses the real development Firebase project, never anonymous/custom-token authentication. The resulting UID is displayed. No entitlement is granted by this page.
2. Once Functions are deployed, click **Bootstrap Account**. This creates `accounts/{uid}` idempotently. The utility has no hidden entitlement feature and is not included in either app build or Firebase Hosting.
3. An IAM-authorized operator supplies Application Default Credentials, for example with `gcloud auth application-default login` (Google Cloud CLI). Firebase CLI login and ADC are separate credentials. Keep the ADC file outside Git; do not download a service-account key just for this task.
4. From `firebase/functions`, run:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'hazcom-navigator-dev'
node scripts/dev-admin.mjs entitlement REAL_FIREBASE_UID professional 30
```

The script checks that the UID exists in Firebase Auth, has a Google provider, is enabled, and already has an Account. It accepts only this exact development project, no emulator endpoints, and a 1–90 day test term; it supplies the 14-day grace limit and an audit record. It cannot downgrade a multi-Company Professional to Customer. It is not deployed as a Function. A desktop client cannot invoke it with Firebase client credentials.

For a new Professional-created Company with **zero** Administrators, an operator may explicitly choose its actual business administrator:

```powershell
node scripts/dev-admin.mjs first-administrator REAL_BUSINESS_ADMIN_UID COMPANY_ID
```

This refuses to modify a Company that already has an Administrator. It does not silently promote the Professional. Subsequent membership/role changes use the Administrator-only callable. Neither utility has been run against a cloud user: no Google-authenticated development UID has yet been supplied/created during this task.

## Callable contracts

Use callable Functions SDK in `us-central1`. All reject unauthenticated/anonymous users. Use stable client-generated UUIDs for retryable operations.

| Function | Input | Authority/result |
|---|---|---|
| `bootstrapAccount` | `{}` | Real Google identity → private Account |
| `createCompany` | `{companyId, company:{name,contact_email}}` | Entitled Account; transactional count/role/coverage |
| `updateCompany` | `{companyId, company:{name,contact_email}}` | Administrator + active Company coverage |
| `setActiveCompany` | `{companyId}` | Current membership; preference only, never authority |
| `setMembership` | `{companyId,uid,role,active,workerId?}` | Administrator + coverage; preserves last Administrator |
| `coverCompany` | `{companyId}` | Professional entitlement + Manager/Admin membership; uncovered Company only |
| `beginPublication` | `{companyId,revisionId,parentRevisionId}` | Manager/Admin + coverage; 24-hour staging session |
| `uploadPublicationSds` | `{companyId,revisionId,attachmentId,chemicalProductId,base64}` | Staging creator + Manager/Admin + coverage |
| `finalizePublication` | `{companyId,revisionId,dataset,attachmentIds}` | Staging creator + Manager/Admin + coverage; immutable atomic revision |
| `recordTrainingCompletion` | `{companyId,assignmentId,eventId,trainingDate}` | Active coverage; Member restricted to linked Worker's published assignment |

Inputs use strict allowed fields and safe IDs. Dates must be real `YYYY-MM-DD` dates. Self-training cannot be outside assignment dates or in the future; event IDs make retries idempotent. A member's `workerId` is resolved server-side, not accepted in the completion request. Training records are append-only.

## Publication, datasets and client read contract

Windows SQLite remains the sole local working-draft authority. Export explicit entity projections into `dataset`, begin a revision, upload the referenced PDFs and finalize. No raw SQLite database is uploaded, and no bidirectional authoring sync or screen-level live listener has been introduced.

Wire datasets preserve the core model's entity fields. Flatten only ownership relationships into explicit foreign IDs within each Company revision: Work Area Product has `workAreaId`/`chemicalProductId`; assignment has `workAreaId`/`workerId`; SDS verification has `chemicalProductId`; HAZCOM review has `workAreaId`; training event has `assignmentId` (the backend derives `workerId`). Every relation must resolve inside the same submitted dataset. Top-level Company identity/settings come from the backend, not Manager-supplied payloads. Source Constellation artifacts and SQLite schemas remain unchanged.

The initial atomic publisher accepts **350 total entity records, 3 MB of JSON and 100 attachments per revision**, with PDFs up to **5 MiB each**. These explicit foundation limits keep finalization within Firestore's transaction limits. It rejects oversized publication instead of silently truncating it. Larger Companies will need a staged/chunked writer that preserves the same immutable revision and atomic current-pointer boundary; no unlimited-scale publisher is claimed here.

Revision metadata contains `schemaVersion:1`, Company/revision IDs, parent ID, creator and timestamps, `revisionNumber`, `recordCounts`, `attachmentCount`, `payloadHash`, and a Company settings snapshot. Attachment metadata retains the existing `PublishedAttachment` fields: `attachmentId`, `ownerType`, `ownerId`, `slotKey`, `relativePath`, `sha256`, and `sizeBytes`. The receiving service consumes this existing Firestore wire projection directly. Entity dates normalize to calendar strings; backend lifecycle Timestamps remain authoritative metadata rather than local draft fields.

All dataset documents, selected attachment publication flags and the current revision pointer commit in a single transaction. A stale parent fails; two concurrent publishers cannot both replace the same parent. A published revision cannot be edited or replaced. Retry of the same payload/revision returns the original result; changed content requires a new revision ID. Expired staging sessions cannot be finalized; unreferenced uploads remain unreadable. No automatic cleanup deletes canonical SDS/history. A future privileged staging cleanup must verify the revision never published before removing abandoned objects.

At startup/resume or explicit refresh:

1. Authenticate and bootstrap Account, read own subscription and `accounts/{uid}/memberships`.
2. Select Company and read `companies/{companyId}`. Recheck membership rather than trusting a cached index/activeCompanyId.
3. Compare `currentRevisionId`/`currentRevisionNumber` with the local replica. If equal, do not download the dataset again.
4. If changed, read that published revision and its authorized collections into a temporary local import. Verify file SHA-256 and size; atomically replace the local published replica only after the import succeeds. Preserve the prior replica on failure.
5. Members fetch their Worker by ID and filter `workAreaAssignments`/`trainingEvents` with `where('workerId','==',linkedWorkerId)`; unfiltered personal-data queries are denied. Managers/Administrators may download full Company datasets. Query attachments with `where('published','==',true)`.
6. Rescan Company `trainingEvents` separately in pages ordered by `createdAt` plus document ID; events can advance without a new Company revision. A composite `workerId + createdAt` index supports member-filtered reads. Do not persist a timestamp high-water mark: timestamps precede commit and late commits could be missed. Deduplicate stable IDs in the replica Training Event ledger; event reconciliation is distinct from general draft sync.

## SDS Storage

```text
companies/{companyId}/revisions/{revisionId}/sds/{attachmentId}/{sha256}.pdf
```

Only the trusted upload Function writes these objects. It validates PDF signature/size (not a full PDF malware scanner), requires staging ownership and Company Manager/Admin membership, creates immutable content-addressed bytes with `ifGenerationMatch:0`, clears download-token metadata, and verifies that removal before registering an attachment. Finalization validates every referenced Chemical Product and permits one SDS slot per product. Revision IDs preserve replacement/version history; no raw filename controls authorization.

Client reads use authenticated Storage SDK downloads, **not `getDownloadURL`/public URLs**. Storage Rules use exactly two Firestore documents: canonical membership and the attachment's atomic `published` marker/hash. Storage only supports two cross-service document reads; the marker is committed with the complete published revision, not supplied by a client. Bucket listing, writes, metadata changes, overwrite and delete are denied to all clients, including Administrators. Read metadata and paths through authorized Firestore revision metadata.

## Offline entitlement boundary (contract only)

A future backend may issue a signed JWS lease after online Firebase identity, current Company membership and entitlement/coverage checks. Required claims: `iss`, `aud` (HazCom desktop), `sub` (Firebase UID), Company ID, role and permitted capabilities, subscription/version, membership version, `iat`, `nbf`, `exp`, `jti`, schema version and signing `kid`. A proposed initial maximum lease is **24 hours**, also capped by the entitlement/grace deadline. Final offline policy requires product/security approval before implementation.

Signing keys stay server-side (KMS/managed keys); clients verify with pinned/rotated public keys. Local SQLite caches the signed lease, never creates or extends it. Refresh online at expiry, on account/Company switch, or when the server reports a changed role/entitlement. A lease is not a Firebase ID token and must never authorize cloud writes. Define clock-rollback handling and lost/revoked-device behavior before shipping offline authoring. Lease issuance, signing and client enforcement are deliberately **not implemented**; no local paid flag or unlimited offline authoring bypass was added.

## Validation and limitations

The emulator tests cover authentication rejection, bootstrap idempotency, concurrent Customer limits, Professional role isolation, immutable/atomic publication and retries, tenant/privacy rules, role/self-enrollment denial, linked Worker uniqueness, last-Administrator protection, self-training relationship/date checks, subscription/grace boundaries, unsafe IDs/schema/references, direct CRUD denial, SDS read/write/list boundaries, and membership revocation. An oversized-document mutation is denied. Direct mutation tests cover field deletion/corruption/privilege escalation by denying all client writes; the trusted handlers validate permitted payloads separately.

Storage emulator 15.30.2 generates bearer download tokens after successful GETs. Tests verify upload metadata before the first GET and verify ordinary unauthenticated reads are denied, and the real-cloud token-free SDS test now passes. App Check enforcement and production native sign-in remain future integration tasks. Auth token revocation in direct Rules reads follows Firebase ID-token lifetime; Company membership revocation is checked on every online read.

The existing SDK dependency tree reports four moderate `uuid`-related npm advisories across Cloud Storage's dependency chain and Capacitor's Xcode tooling. A compatible `npm audit fix` did not resolve them; the suggested forced fix changes unrelated Capacitor dependencies. No forced upgrade was applied.

Security Rules are a development prototype with executable tests, not a claim of an exhaustive production security audit. Review the model and broaden adversarial/device testing before broad distribution.

References: [Storage/Firestore Rules lookup limits](https://firebase.google.com/docs/storage/security/rules-conditions), [Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [Callable Functions](https://firebase.google.com/docs/functions/callable).


## Publication/replication proof — September 21, 2026

The deterministic Company-scoped Windows SQLite serializer, durable publication orchestration, authorized receiver, atomic independent SQLite replacement, SDS verification and separate Training Event reconciliation are implemented in `@hazcom/sync`. A real callable emulator harness proves Small Company publication, clean Device B import, later revisions, interrupted/failed imports, privacy enforcement and training reconciliation. Existing Firebase server code/rules and limits are unchanged; no cloud deployment was needed.

Small is 140 records/20 SDS files. Medium (1,560/250) and Large (10,700/2,000) are rejected by the unchanged 350-record/100-attachment limits, while local SQLite import benchmarks succeed. Exact JSON/PDF boundaries are also executable tests. See [publication/sync handoff](../docs/PUBLICATION_SYNC_HANDOFF.md) for APIs, test commands, measurements, failure recovery, platform acceptance limits and the proposed scalable publisher. The new permanent checkpoint is `frozen/publication-replication-proof-2026-09-21`; existing frozen/archive refs must not be moved.
