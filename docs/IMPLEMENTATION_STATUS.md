# Implementation status

## Commercial entitlement V1 source checkpoint — local/emulator only

The canonical [commercial contract](COMMERCIAL_CONTRACT_V1.md) and [entitlement handoff](ENTITLEMENT_ENGINE_HANDOFF.md) describe a validated Demo/capability foundation. Account bootstrap, Demo limits/switching, trusted publication gates, local authoring limits, synthetic billing events, Pro-seat inheritance, takeover, backup-email verification with a mock outbox, emulator-only cleanup, and versioned local backup round-trip have automated coverage. A Windows service exports that backup during paid grace/export. Production email/cloud delivery, scheduled cleanup, native restore, and real billing integration remain future work. The development Firebase project was not deployed.

## Current Windows authoring checkpoint

HazCom Navigator now has a native Windows Manager/Administrator authoring workspace backed by the existing Company-scoped SQLite model.

Implemented and validated through the native app:

- Google sign-in and authenticated Account -> entitlement -> Membership -> active Company front door
- Company-scoped Work Areas
- Chemical Products
- Work Area Products
- Workers
- Work Area Assignments
- managed local SDS draft PDFs with SHA-256/size integrity metadata
- append-only SDS Verifications
- append-only HazCom Review Events
- append-only Training Events
- Trash/restore
- trusted Company administration boundaries
- persistence across application restart
- local-calendar date defaults for Windows authoring forms

A native Manager acceptance pass created, edited, persisted, trashed/restored, and re-opened representative HazCom records and an SDS through the actual Windows application. The validated authoring source including the local-date correction is preserved at:

`frozen/windows-authoring-validated-2026-09-22`

See [Windows authoring handoff](WINDOWS_AUTHORING_HANDOFF.md) and [Windows authentication handoff](WINDOWS_AUTH_HANDOFF.md).

The current Reports & Export screen does **not** yet expose publication controls. Connecting the authoring workspace to the already-implemented scalable publication service is the next primary product slice.

## Scalable publication and replication

Schema 2 staged publication is implemented and emulator-verified through independent SQLite replication.

Verified fixtures:

- Small: 140 records / 20 SDS files
- Medium: 1,560 records / 250 SDS files
- Large: 10,700 records / 2,000 SDS files
- Stress: 28,000 records / 5,000 SDS files

The schema 2 pipeline uses immutable hashed manifests, bounded deterministic chunks, authenticated binary SDS uploads, resumable progress, sealed completeness/relationship validation, a small final transaction that atomically switches the Company current revision, and privileged abandoned-staging cleanup.

An incomplete revision never becomes current. Receiving clients build a separate temporary SQLite replica, verify revision/SDS integrity, and activate it only after the import succeeds. Member privacy and separate append-only Training Event reconciliation are preserved.

See [scalable publication handoff](SCALABLE_PUBLICATION_HANDOFF.md), [publication/sync handoff](PUBLICATION_SYNC_HANDOFF.md), and [measured results](scalable-publication-results.json).

The scalable source checkpoint is preserved at:

`frozen/scalable-publication-proof-2026-09-22`

**Important deployment boundary:** schema 2 is validated in source/emulators but is not yet the coordinated production/dev-cloud deployment. The development Firebase project still has the earlier deployed Functions/rules until schema 2 Functions, indexes, rules, and clients are intentionally deployed together.

## Firebase cloud checkpoint

Development project:

`hazcom-navigator-dev`

Verified cloud foundation:

- Blaze enabled
- Google Authentication enabled
- Firestore configured in `us-central1`
- private Cloud Storage bucket
- FCM enabled
- ten Node 22 Functions from the earlier backend deployment
- Firestore and Storage Rules deployed
- cross-service Storage membership authorization configured
- real Google authentication smoke test passed
- real SDS upload/download test passed
- unauthorized/direct-write SDS access denied
- published SDS download did not leave a persistent Firebase Storage download token

See [Firebase handoff](../firebase/CODEX_HANDOFF.md) and [Firebase validation](../firebase/VALIDATION.md).

## Authentication boundary

The current Windows development login uses the system browser and a one-use loopback callback into the Tauri application. The working development flow is proven.

Current limitations:

- Firebase session persistence is intentionally in-memory; restarting the app requires login again
- the current loopback relay is a development implementation, not the final packaged production OAuth/session design
- production OAuth/PKCE/return handling and secure persistent/offline authorization remain future work
- Member published-data screens are not yet implemented in the Windows authoring client

SQLite opens only after live Firebase Company authorization. Member accounts do not open the Manager/Administrator authoring workspace.

## Core foundation

The repository also includes:

- canonical domain types and stable relationship IDs
- role/capability definitions
- Customer and Professional entitlement definitions
- derived review/SDS/training status logic
- assignment/product-added training requirement behavior
- Constellation-derived SQLite schema and derived views
- Company-scoped authoring repository/service layer
- deterministic SQLite -> publication serializer
- independent published-replica importer
- Mobile Capacitor shell and replica foundation
- Firebase emulator security/integration tests
- SQLite migration/integrity/relationship tests
- scalable publication/replication harnesses
- Windows authoring tests

## Next implementation slices

1. **Wire Windows Publish UI to schema 2.** Add publication readiness validation, Publish/progress/retry/status behavior, and confirmation of the resulting current revision using the already-validated scalable publication service.
2. **Coordinate schema 2 cloud deployment.** Deploy the new Functions, indexes, rules and compatible clients together; configure staged cleanup scheduling/quotas and perform a real-cloud scalable publication smoke test.
3. **Exercise the mobile/published-member path on physical devices.** Validate the existing replica adapter and build authorized published-data screens.
4. **Harden production Windows authentication/session behavior.** Replace the development-only auth boundary with the approved packaged OAuth/session strategy and define the offline entitlement policy.
5. **Build SDS ingestion/OCR review workflow.**
6. **Build reporting/export/handoff outputs.**
7. **Integrate the eventual billing provider and webhook lifecycle.**

## Frozen recovery checkpoints

Existing frozen/archive branches are recovery points and must not be repointed.

Important checkpoints include:

- `archive/pre-local-working-import-2026-09-21`
- `frozen/working-google-auth-2026-09-21`
- `frozen/authenticated-front-door-2026-09-21`
- `frozen/publication-replication-proof-2026-09-21`
- `frozen/scalable-publication-proof-2026-09-22`
- `frozen/windows-authoring-core-2026-09-22`
- `frozen/windows-authoring-validated-2026-09-22`

The older `frozen/windows-authoring-core-2026-09-22` checkpoint intentionally predates the local-calendar date correction. The validated authoring checkpoint above includes that fix.
