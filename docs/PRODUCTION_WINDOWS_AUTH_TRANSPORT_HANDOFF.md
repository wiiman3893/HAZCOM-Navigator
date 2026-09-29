# Production-configurable Windows authentication transport

> Historical transport checkpoint. The later [Windows persistent session handoff](WINDOWS_PERSISTENT_SESSION_HANDOFF.md) replaces the in-memory-session limitation described below while preserving this browser transport.

Validated September 29, 2026 from starting main `4a24375ce6ca4f70d4132cc970de0cc645f7af39`.

The Windows client now requires an explicit `VITE_HAZCOM_ENV` of `development` or `production` and validates its public Firebase API key, auth domain, project ID, app ID and Storage bucket before calling `initializeApp`. Production rejects the development project, demo/emulator project IDs, local or emulator remote endpoints and emulator host variables. Missing or malformed configuration produces the existing bounded entry-screen error and cannot start sign-in or open SQLite. Firebase client values remain public configuration; no provider, service-account, billing, email or signing secret was added.

The native browser relay is no longer unconditionally debug-only. Debug builds retain the exact `hazcom-navigator-dev` contract. Release builds reject development configuration and proceed only with a validated production environment. The relay still binds only to `127.0.0.1` on an ephemeral port, uses a random 256-bit nonce, requires exact Host and Origin, accepts one bounded callback, rejects replay/concurrency, times out after three minutes and shuts down without logging or persisting credentials. Its CSP names the selected Firebase auth domain exactly for connection and framing; the development domain is no longer embedded in the production-capable path.

The credential mechanism was checked against the public Firebase JavaScript Auth contract. The system-browser page uses `signInWithPopup(GoogleAuthProvider)`, extracts the Google OAuth ID token with `credentialFromResult`, and posts it in the same-origin body. The Windows client creates a supported Google credential with `GoogleAuthProvider.credential(idToken)` and calls `signInWithCredential`. No custom token, undocumented SDK state, manual refresh-token persistence, desktop PKCE substitution or new backend exchange was introduced.

At this transport checkpoint the application still used `inMemoryPersistence`; the later persistent-session checkpoint replaced it with Firebase-managed IndexedDB/localStorage persistence. Connectivity loss still clears Company context and closes the workspace. Account bootstrap, canonical Company/Membership checks, role restrictions, commercial capability checks and the native workspace lease remain unchanged. SQLite activation continues only after current online Company authorization succeeds.

## Validation

- Windows environment tests: 4/4 passed.
- Native Rust tests: 24/24 passed, including 4 relay/config tests.
- Core/SQLite/sync/authoring: 13 core, SQLite validation, 10 sync and 30 authoring tests passed.
- Windows publication/workspace lifecycle: 12/12 passed.
- Windows browser UI: 13/13 passed.
- Diagnostics: 16/16 passed.
- Firebase emulator: 24/24 passed against `demo-hazcom-navigator`.
- Native restored-workspace publication emulator: 1/1 passed.
- Full root build passed; a Windows frontend build with synthetic production-like public configuration passed.
- Native `cargo check --release` passed with two pre-existing test-helper dead-code warnings.

## External acceptance still required

No production Firebase project, OAuth client, authorized domain, credentials or deployment was created. Real production sign-in therefore remains untested. A future production project must provide the public values accepted by the new contract, enable Google sign-in and authorize the local browser relay origin required by the supported Firebase popup flow. That separately authorized acceptance must test a legitimate packaged release and real production configuration before production OAuth is claimed.

The next milestone at the time of this checkpoint was persistent Windows Firebase sessions. That milestone now uses supported Firebase-managed WebView persistence; it does not claim a separate OS credential vault. The fixed seven-day offline authorization lease remains a later, separate milestone.
