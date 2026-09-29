# Windows persistent Firebase session handoff

Validated locally on September 29, 2026 from starting main `d17e9a84b11640f91ed3495707b2e530b8f8af93`.

## Persistence mechanism

The Windows Tauri client uses the public Firebase JS Auth 12.19.0 `initializeAuth` API with this ordered persistence list:

1. `indexedDBLocalPersistence`
2. `browserLocalPersistence`

Firebase selects the first implementation supported by WebView2, finds and migrates an existing Firebase account from a secondary configured store when applicable, persists its own session state, and performs normal token refresh. HazCom Navigator does not serialize Firebase objects, refresh tokens, Google tokens, Firebase ID tokens, or private SDK state. The existing system-browser Google sign-in and localhost relay are unchanged.

This is Firebase-managed WebView storage. It is scoped to the HazCom Navigator WebView origin and application user-data profile under the current Windows user profile. Normal Windows profile/file permissions provide the same local-user boundary as other WebView application data. This milestone does **not** use Windows Credential Manager or a custom DPAPI vault, and does not claim that Firebase records are separately encrypted at rest by HazCom Navigator. A person or process able to read the Windows user's application profile is outside the protection this mechanism adds.

## Startup and authorization

Startup begins in an explicit Firebase restoration state. No prior Company, Account session, or workspace is rendered while Firebase resolves persisted auth. A restored user is an identity candidate only. The app closes any native workspace, then performs the existing online sequence: Account bootstrap, Account/subscription reads, discovery membership reads, canonical Company and Membership checks, and the trusted Company coverage/capability callable. Only a selected Company that survives those checks can be rendered; native SQLite activation still performs its own live authorization check before opening.

The trusted callable identity guard loads the Firebase Auth user, requires an enabled Google provider, and rejects an ID token whose `auth_time` predates `tokensValidAfterTime`. Membership, Company activity, role, and current commercial coverage remain server-authoritative. Focus, reconnect, Firebase ID-token changes, the existing Company/Membership listeners, and the 60-second refresh continue to revalidate access. Confirmed failure clears Account/Company state and closes SQLite. Detection is bounded by those server calls, listeners, and Firebase token refresh behavior; this is not a claim of instantaneous offline revocation.

If a persisted identity restores while the computer cannot complete online authorization, the app retains the Firebase identity and local files but does not open authoring. Reconnect or Refresh access retries the current checks. The seven-day offline authorization lease is intentionally not implemented.

## Sign-out and account switching

Explicit sign-out first invalidates the frontend generation, removes in-memory Account and Company state, and closes the native workspace. It then calls Firebase `signOut`, which removes the Firebase-managed durable session. Company SQLite, managed SDS files, restored workspaces, publication journals, and backups remain on disk. Opening them again requires a Firebase identity and current server authorization.

An identity change follows the same close-first path. Account A's UI is removed immediately; Account B must pass bootstrap, Membership, Company, role, and coverage checks before its Company context mounts. Native workspace leases remain random, single-active-session tokens, and workspace selection preferences remain keyed by Account plus Company. Existing native tests prove stale leases cannot access a newly activated workspace.

## Invalid and revoked sessions

- A disabled Firebase Account, removed Google provider, or server-detected revoked token is rejected by the trusted identity guard.
- Inactive Membership, inactive Company, role change, selected-Company loss, and commercial capability loss fail closed and close SQLite.
- Firebase invalid-session events remove the workspace and require reauthentication when Firebase no longer has a usable user.
- Temporary network failure is reported as a connection requirement and does not itself call sign-out or erase local customer data.

## Credential and privacy boundary

Firebase Auth data is confined to Firebase-managed WebView persistence. Application code does not copy it into Company SQLite, SDS metadata, publication payloads, reports, publication journals, Company backups, diagnostic events/bundles, console logging, or URLs. Diagnostics accept allow-listed semantic fields and redact token/key/credential patterns; backups enumerate Company tables and managed SDS bytes and have no browser-profile input. The localhost relay continues to carry the one-time Google ID token in a bounded same-origin POST body and Tauri IPC, never a URL.

## Automated evidence

- `npm run test:windows:auth:persistence`: Firebase Auth emulator plus an Edge persistent user-data directory. A synthetic user signs in, the entire browser context closes, a new Edge process opens the same profile and restores the same Firebase UID, Firebase sign-out runs, and a third process starts signed out. The test also confirms Firebase created its IndexedDB persistence database.
- Session UI acceptance: initial restoration is bounded; no workspace opens before the live authorization step; valid restoration succeeds; inactive Company, revoked Membership, invalid Firebase session, and offline startup fail closed; reconnect succeeds; sign-out remains signed out after reload; Account A cannot remain visible or reuse its workspace as Account B.
- Existing native tests cover close/replace behavior, Account/Company-scoped remembered selection, stale lease rejection, and preservation of local SQLite/SDS data.
- Existing diagnostics and backup tests cover secret redaction and bounded Company-only export content.

## Remaining acceptance

The persistence implementation is exercised against the local Firebase Auth emulator in a real Edge persistent profile, which is the same browser storage API family used by WebView2. A packaged HazCom Navigator executable has not yet completed a human Google sign-in, full native process exit, relaunch, automatic restoration, and sign-out/relaunch acceptance against a legitimate production Firebase configuration. No production Firebase project, OAuth configuration, deployment, real user mutation, seven-day offline lease, billing, installer signing, updater, mobile feature, or application-level SQLite encryption is included.

The next milestone is the separately designed seven-day server-authorized offline lease, after packaged production OAuth and native restart acceptance are available.
