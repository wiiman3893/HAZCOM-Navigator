# Windows offline authorization handoff

Implemented from `origin/main` `aaed2b365653f36e828bc983276f929d5bd9bad5` on `work/windows-offline-authorization-lease-2026-09-29`. This is source and emulator validation only. No Firebase deployment, production signing secret, production OAuth credential, or real Company/user mutation was performed.

## Authorization artifact

`issueWindowsOfflineAuthorizationLease` issues a compact JWS/JWT signed with ES256 (P-256/SHA-256). Its protected header is `alg=ES256`, `typ=JWT`, `kid=offline-lease-es256-v1`. Claims are limited to schema `v`, issuer, audience `hazcom-navigator-windows`, Firebase UID (`sub`), project/environment (`env`), Company ID, effective `administrator` or `manager` role, `canAuthor=true`, server issuance (`iat`), fixed expiry (`exp`), and random token ID (`jti`).

The callable uses the existing trusted identity guard, including enabled Google-provider and token-revocation checks. It derives Company, active Membership, role, coverage, and commercial capability from server data. Members, inactive Companies/Memberships, unauthorized Companies, disabled/revoked identities, and read/export-only coverage are denied. Client-selected claims and extra fields are rejected.

Expiry is `floor(min(serverNow + 7 days, paidThrough))/1000`. Issuance fails if this is not later than issuance. The artifact never slides or renews locally; another lease requires a new successful online server authorization.

## Keys and environment separation

The server private key comes from the Functions v2 secret `WINDOWS_OFFLINE_LEASE_PRIVATE_KEY` and is never present in Windows code. It must be an ES256 PKCS#8 PEM whose public SPKI PEM is included in the native build trust map. Production/development deployment and secret creation remain separate authorized operations.

The synthetic private key in `firebase/functions/src/offline-lease.ts` is accepted only when the project is exactly `demo-hazcom-navigator` and Functions or the required Auth plus Firestore emulator hosts are present. Native test code trusts its matching public key only under `cfg(test)` and only for the demo project.

Native release trust is compiled from `HAZCOM_OFFLINE_LEASE_ENVIRONMENT` and `HAZCOM_OFFLINE_LEASE_PUBLIC_KEYS_JSON`, where the JSON object maps `offline-lease-es256-v1` to an SPKI PEM. Missing, invalid, wrong-environment, or unknown-key configuration fails closed for offline access. The public key is build configuration, never supplied by frontend JavaScript. The key-ID map permits controlled future rotation.

## Native protected cache and enforcement

The native layer verifies the signature, algorithm, key ID, schema, issuer, audience, project, UID, Company, role, capability, `iat`, `exp`, token ID, and maximum duration before storage and each offline activation. Raw tokens are stored only in `offline-authorization.bin` under the Tauri app-data directory, outside Company SQLite, protected for the current Windows user with `Windows.Security.Cryptography.DataProtection` using `LOCAL=user`. Frontend APIs receive bounded metadata only.

The protected cache is keyed by project, Firebase UID, and Company ID. It also contains a global last-observed time floor. A clock more than five minutes behind that protected floor makes the lease read-only. Forward time never extends expiry. This protects ordinary clock rollback across restarts; it does not claim protection from a fully privileged local administrator who can restore the entire user profile or machine image.

Offline workspace activation ignores frontend `readOnly=false` and derives writable/read-only mode from native verification. Native mutation checks run again on every SQL batch, managed SDS write, publication-journal write, child-PDF materialization, OCR mutation path, and backup restore. Expiry during a running session flips the native lease to read-only and rejects the write. Reads, SDS reads, reports, backup export, and journal reads remain available. Existing random workspace session tokens continue to reject stale sessions.

## Application lifecycle

After successful online Manager/Administrator Company authorization, Windows requests and immediately hands a fresh signed lease to native protected storage. Failure to cache it produces a visible warning but does not block valid online authoring. Read/export-only online coverage deletes the Company's cached writable lease.

If server authorization fails because the network is unavailable, a restored Firebase UID can list only native-verified metadata for that UID and project. A valid lease opens that Company locally with authoring enabled. An expired but correctly signed lease opens read/export mode. Missing, corrupt, forged, wrong-UID, wrong-Company, or wrong-project credentials expose no Company. Multiple cached Companies remain isolated and are selectable by Company ID until online names can be refreshed.

Offline mode uses the existing application. Work Areas, Chemical Products, Workers, relationships, events, SDS management, Bulk SDS/OCR, reports, and backup export remain local. Publication, Company creation, Membership/Company administration, backup restore, and trusted Firebase mutations are unavailable. The UI marks offline state and expiry and removes publication/administration services.

At expiry, the UI lifecycle closes and reopens the workspace read-only; native enforcement independently rejects a write even if the timer is delayed. On reconnect, the app closes the offline workspace before current server authorization. Success produces a fresh fixed lease. Confirmed Membership/Company/identity/role failure removes cached authorization and closes access. Commercial read/export status removes writable authorization while preserving local read/export. Remote changes cannot be learned during a true outage; the signed expiry is that interval's bound.

Explicit sign-out closes the workspace and removes every cached lease for that UID before Firebase sign-out. It does not delete SQLite, SDS files, restored workspaces, journals, or backups. Account switching closes the old native token before authorizing the next UID.

## Privacy and limits

Offline credentials are absent from Company SQLite, SDS metadata, publication data/journals, reports, backups, diagnostics, and normal UI. Diagnostics receive semantic authorization/workspace outcomes through existing bounded events, not the raw JWS, signature, private key, or Firebase token. DPAPI protects against casual access and other normal Windows users; it is not a hardware-bound or privileged-administrator security boundary.

## Validation status

- Firebase emulator: 25/25 tests, including server-derived Admin/Manager issuance, Member/inactive/disabled/unauthorized denials, fixed and clipped expiry, and read/export-only denial.
- Native Rust: 27/27 passed, including signature/scope/key/time validation, Windows user protection, cache corruption/isolation, protected rollback floor, valid offline mutation, expired mutation rejection, online-only restore, stale sessions, SDS, OCR, journals, and workspace/backup regressions.
- Windows UI: 20/20 passed; focused session acceptance is 6/6. This covers writable offline startup, cloud-action removal, expired read-only records/reports, no-lease denial, reconnect/fresh issuance request, revocation, sign-out, and account switching.
- Root regression: 13 commercial tests, SQLite validation, 10 sync/backup/publication tests, and 30 authoring/Bulk SDS/report tests passed.
- Windows environment 4/4, persistent Firebase session 1/1, publication/workspace lifecycle 12/12, and diagnostics/privacy 16/16 passed.
- Root production build, Windows production build, Functions TypeScript build (inside emulator validation), native all-target check, and `git diff --check` passed. Existing non-fatal Node metadata lookup, frontend bundle-size, and two pre-existing test-helper dead-code warnings remain.

No packaged executable, real outage, production project, deployed callable, real signing secret, or human native acceptance is claimed.
