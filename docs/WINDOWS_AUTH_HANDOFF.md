# Windows authentication and front-door handoff

Checkpoint: 2026-09-21. The authoritative project is the local `HAZCOM Navigator` source, promoted without merging older remote implementation choices.

## Frozen source and recovery

- Original local base and archived old remote main: `d9bf90897003c4a5f46b32348706114610b53fea`.
- Old remote archive: `archive/pre-local-working-import-2026-09-21`.
- Working local import: `64b65c9311557de05eb93840ae88ff4ec0c46fb4`, message **Promote working local HazCom Navigator build**.
- Permanent first recovery branch: `frozen/working-google-auth-2026-09-21`, at that same SHA. Local main, origin/main and this branch matched immediately after the push, verified with `ls-remote`. Authentication source files were verified in the fetched remote tree.
- `main` is the working line. A second `frozen/authenticated-front-door-2026-09-21` checkpoint records the validated source plus this handoff. Resolve its exact SHA with `git ls-remote origin refs/heads/frozen/authenticated-front-door-2026-09-21`; do not amend/repoint either frozen branch.
- No remote history rewrite was necessary. Preserve `codex-firebase-local-backup` and the pre-existing `frozen/firebase-foundation-2026-09-20` branch.

The first import includes all working auth source/configuration and both lockfiles. The optional untracked `Setup-HazComNavigator.ps1` was inspected and left intact outside the commit: it is a personal setup/pull/launch helper, not an app dependency, and contains checkout/pull behavior unsuitable for preserving an authoritative dirty tree. `.env`, dependencies, target/dist output, emulator output and reference artifacts remain ignored. Constellation sources were not changed.

## Exact working login implementation

1. `apps/windows/src/App.tsx` observes Firebase Auth. No Google account means the sign-in screen; SQLite is not preloaded.
2. `src/auth/firebase.ts` invokes the Rust `google_browser_sign_in` command. There is no Google login inside the embedded Tauri webview and no custom Firebase-token/anonymous bypass.
3. `src-tauri/src/browser_auth.rs` accepts only the dev project/authDomain and debug builds. It binds an Axum HTTP listener to **127.0.0.1 on an ephemeral port**, makes a random 256-bit nonce, then uses Tauri Opener to open `http://localhost:PORT/#NONCE` in the system browser. Only one pending login is allowed.
4. The browser receives `browser-auth.html` with public Firebase Web config. It removes the fragment from history, creates an in-memory Firebase Auth instance using pinned official Firebase 12.19.0 modules, and starts `signInWithPopup(GoogleAuthProvider)` when **Continue with Google** is clicked. Google handles the account chooser/consent.
5. The browser extracts the **Google OAuth ID token**, not the Firebase ID token, and POSTs it with the nonce to the same-origin `/complete`. No credentials are sent in URLs or written to SQLite, localStorage or logs. The callback requires the exact Host and Origin, matching nonce, bounded JSON, and a one-use pending sender. The listener expires after three minutes and shuts down after completion.
6. Rust returns that Google ID token over Tauri IPC. The app calls `signInWithCredential(auth, GoogleAuthProvider.credential(token))`. Firebase exchanges and validates it and manages its Firebase session in memory. The browser relay signs out its temporary Firebase session; this does not sign the person out of Google itself.
7. The Auth listener runs Account bootstrap, entitlement lookup, membership discovery/canonical rechecks, active Company resolution, then opens the existing Management Home for Manager/Admin. There is **no OS deep link or custom URI scheme**; the local HTTP callback is the return mechanism.

Public config comes from the root ignored `.env`, with a committed `.env.example`. Vite's envDir points to the repository root. Missing config shows setup guidance. Run `npm run tauri -w @hazcom/windows -- dev` from the root.

## State and authority behavior

| State | Current behavior |
|---|---|
| Unauthenticated | Sign-in screen; no SQLite preload or local Company selector |
| Authenticated, Account not bootstrapped | `bootstrapAccount` runs idempotently before hydration; failures leave the shell closed with Refresh access |
| No personal entitlement | Displays that state; existing canonical memberships remain usable; creation unavailable |
| Customer, no Company | Eligible active/grace subscription with zero covered Companies exposes create; callable enforces the one-Company limit and Administrator role |
| Professional, no memberships | Eligible subscription exposes create; callable assigns Manager, never automatic Administrator |
| One available Company | Picker is available; a valid saved active Company restores automatically |
| Multiple Companies | Picker uses Firebase discovery plus canonical Company/membership checks; selection persists through `setActiveCompany` |
| Valid saved active Company | Resolves only against the freshly verified membership set |
| Revoked/invalid saved Company | Does not resolve/open it; picker or no-membership state remains. Membership/Company listeners close an invalid current workspace |
| Member role | Verified member screen; local Manager/Admin draft/Worker data is not opened. Published member reader is not implemented yet |
| Offline | Shell closes; online authority is required until an approved offline lease exists |

Client entitlement labels and creation availability are presentation only. Every cloud mutation is checked by trusted Functions. A personal subscription is not equivalent to Company membership or Company coverage. A Manager may work under another account's coverage. No full CRUD, billing checkout or publication UI is included here.

`getDashboardCounts` rechecks current Firebase UID, Company and canonical membership from the server before opening SQLite. It rejects Member role, initializes foreign keys, upserts the cloud Company header and queries counts through Company ownership relationships. Tauri SQL preload is removed. `sql:allow-execute` is scoped to the existing local **main** window and supports PRAGMA/Company header initialization; it does not grant cloud writes or remote-window access. SQLite is local draft storage, not an encrypted security boundary against the computer's owner or compromised app code.

## Restart, logout, failure and verification limits

- Both browser and Windows Firebase instances use **inMemoryPersistence**. App restart/reload requires login again; there is no implemented persistent desktop session to restore. A browser may remember Google's account selection independently. The server's activeCompanyId survives and is revalidated after the next login.
- Sign out calls Firebase `signOut`; its listener clears the shell and closes the database. No draft data is deleted. This path was code-reviewed; a fresh interactive logout/relogin acceptance run was not completed on September 21.
- Popup cancellation/error is displayed in the system-browser relay and can be retried there. Closing the browser without completing leaves Windows waiting until the three-minute timeout. Browser-open errors and Firebase exchange errors are displayed in Windows. There is no immediate in-app Cancel command yet.
- Focus/online events and a 60-second timer refresh live access. Company/membership listeners react to online revocation. Stale async account loads are ignored using a generation counter.
- The user confirmed the actual Gmail chooser completed and the native app unlocked. On September 21, the debug binary was rebuilt/launched again successfully. Direct Windows UI inspection then encountered **Computer Use app approval timed out**; no automated bypass was attempted. Consequently the fresh restart screen, logout interaction, and full visual state matrix are not claimed as observed.
- A read-only inspection of the actual app database found both migrations successful, `integrity_check=ok`, and the authenticated development Company headers (including the passing cloud smoke Company). This confirms local SQLite initialization and Company workspace persistence beyond a frontend build. No capability error appeared in the successful native launch output, but full visual absence of errors was not independently confirmed after the timeout.
- The native relay test passes for wrong Host, wrong Origin, wrong nonce, callback replay and oversized body rejection. Backend emulator tests cover plan limits, roles, revocation, tenant isolation and publication. They do not stand in for native Google consent.

## Ranked technical hurdles and next Work/Codex tasks

| Rank / risk | Hurdle | Current boundary and useful next task |
|---|---|---|
| 1 — High | Packaged Windows OAuth/browser return and session security | Debug-only loopback relay works; release builds deliberately reject it. Register/test production desktop OAuth with PKCE or an approved HTTPS return, multiple browsers, loopback restrictions, cancel/restart/concurrent flows and OS-protected session persistence. Strong focused Work/Codex task, with real-user consent checkpoints |
| 2 — High | Scalable immutable publication | Current limits are **350 total dataset records, 3,000,000 JSON bytes, 100 attachments and 5 MiB per PDF**. Design and fault-test the staged/chunked publisher below before targeting large Companies. Strong architecture plus implementation task |
| 3 — High | Windows serializer and mobile replica importer | Contracts exist; end-to-end client sync does not. Build the SQLite-to-manifest serializer and transactional mobile importer with schema upgrades, hash verification, interruption recovery, old-replica retention and role-filtered personal data. Excellent bounded Work/Codex tasks |
| 4 — High | Offline entitlement and revocation | No signed lease implemented. Set product policy, then server-signed bounded leases, clock-rollback handling, membership/coverage versions and expiry. Offline revocation cannot erase previously downloaded bytes |
| 5 — High | Billing/webhook lifecycle | Blaze infrastructure billing is enabled; product subscription billing is absent. Choose provider; implement verified idempotent webhooks, cancellation/grace, coverage transfer, downgrade limits and audit/reconciliation without granting roles |
| 6 — Medium-high | Backup/restore and disaster recovery | Git frozen branches preserve source, not Firestore/Storage/SQLite data. Firestore PITR and deletion protection were observed disabled in dev. Plan tested consistent data/attachment exports and restore drills, then agree production retention/cost policy |
| 7 — Medium | App Check/device abuse and local hardening | No enforced App Check. Choose supported desktop attestation, rate/size/instance budgets, monitoring, webview CSP and narrower native data APIs as authoring grows |
| 8 — Medium | Multi-Company Professional operations | Roles/coverage separation works; real Company administrator onboarding, sponsorship transfer, bulk switching and billing reconciliation still need audited workflows. Do not promote Professional managers automatically |
| 9 — Medium | SDS ingestion/cleanup | Callable base64 uploads are bounded and token-free. Add resumable trusted ingestion, PDF validation/scanning, quotas and explicit staging leases. Clean only proven-abandoned staging generations; never infer canonical history deletion from age alone |
| 10 — Lower immediate risk | Firebase deployment operations | Ten Node 22 functions, rules, bucket, IAM and CORS are live. Add repeatable environment verification, clean Node 22 CI and deployment rollback checks. Non-interactive CLI skipped cross-service IAM; record/check it explicitly |

## Scalable publication design (proposal, not implemented)

1. Allocate a revision/job with immutable Company/creator/parent IDs, a lease, schema version and idempotency key. Keep all staging data non-current and unreadable to ordinary clients.
2. Accept bounded, immutable, content-hashed dataset chunks and PDF uploads with idempotent chunk/object identifiers and generation preconditions. Resume only missing chunks. Track manifest version, counts, hashes, ownership references and upload-job completion on the server; do not trust client totals.
3. Seal the upload session before validation; disallow new chunks and drain/cancel in-flight upload leases. A background trusted job validates every record, cross-chunk reference, duplicate, permission, PDF digest/size and required attachment. Freeze a validated manifest/root digest. Revalidate authorization/coverage before publish.
4. Finalize with a **small Firestore transaction** checking the original parent/current pointer and validation seal, setting revision status to published and atomically switching the Company currentRevisionId/number. Losing publishers remain non-current. Readers follow only the committed manifest; no partial revision becomes current. Retrying identical finalization returns the original result.
5. The existing two-lookup Storage rule requires an attachment publication marker. Updating thousands of markers cannot fit the current final transaction. Do not pre-mark attachments as published. A scalable option is an authenticated streaming download service that checks canonical membership, the revision's published seal and attachment inclusion/hash before serving private object bytes (including Range requests). It must not mint persistent Firebase download tokens. This requires its own authorization/load tests; preserve the current Storage rules until the replacement is implemented and verified.
6. Receiving clients download to a temporary replica, verify manifest/chunk/SDS hashes, then swap their local revision transactionally. Keep the last valid replica until the replacement commits. Add adversarial tests for retries, missing/corrupt chunks, concurrent parents, revocation, interrupted upload/finalize/import and cleanup racing publication.

Recommended next run: finish production native-auth acceptance/security first; then separate serializer/importer and scalable-publication tasks. Avoid mixing OAuth, billing and large-scale synchronization into one implementation change.
