# Implementation status

## Foundation implemented

- Canonical domain types and stable relationship IDs
- Role/permission definitions and authorization helper contracts
- Customer and Professional plan definitions
- Derived HazCom review, SDS verification, and assignment training status logic
- Assignment/product-added training requirement behavior
- Publish-revision manifest contract
- Verbatim Constellation SQLite schema plus derived non-authoritative views
- Windows Tauri shell with authenticated Account/entitlement/membership entry, system-browser Google sign-in, Company selection/creation, and scoped SQLite dashboard queries after live authorization
- Mobile Capacitor shell plus a separate account/Company-scoped published-replica service
- Firebase development project `hazcom-navigator-dev` with Google Auth, Firestore and FCM configured
- Firestore tenant/security rules deployed to the development project
- Trusted callable backend for Account bootstrap, entitlement-sensitive Company creation, Company settings, memberships, coverage, append-only training, and immutable revision publication
- SDS Storage rules and content-addressed upload path implemented and emulator-tested
- Development-only IAM/ADC entitlement utility and Google sign-in bootstrap harness
- Core automated business-rule tests
- SQLite migration/relationship/foreign-key/derived-view validation test
- Firebase Auth/Firestore/Storage emulator security suite (10/10 at the recorded checkpoint)

## Firebase cloud checkpoint

Blaze is enabled for hazcom-navigator-dev. The private US-CENTRAL1 bucket, ten Node 22 Functions and both rulesets are deployed. Cross-service Storage IAM and development browser CORS are configured. Real Google-auth and SDS smoke tests passed, including token-free authenticated download and denied unauthorized/direct-write access. See [Firebase handoff](../firebase/CODEX_HANDOFF.md) and [validation](../firebase/VALIDATION.md).

The Windows entry flow is implemented with a development-only system-browser relay. SQLite opens only after live Company authorization; member accounts do not open the local authoring dataset. Production OAuth/PKCE/return handling, secure persistent sessions, offline leases and full native acceptance testing remain separately tracked in Firebase documentation.

The current working source is preserved at `frozen/working-google-auth-2026-09-21` (`64b65c9`). All requested committed-source tests/builds passed. The user confirmed the real native Google return; SQLite integrity, migrations and persisted Company headers were independently verified. Interactive logout/restart/cancellation acceptance was limited by a desktop app-approval timeout. See [Windows auth handoff](WINDOWS_AUTH_HANDOFF.md) for the exact mechanisms and ranked technical hurdles. No auth redesign was made after preservation.

## Next implementation slices

1. Finalize production desktop OAuth and secure session/offline policy. Development cloud provisioning and smoke tests are complete.
2. Extend native authentication acceptance tests and implement published member read screens. The development front door is wired.
3. Implement Windows CRUD repositories/forms for Work Areas, Workers, Chemical Products, Work Area Products, and Work Area Assignments.
4. Add optional publication UI around the completed Windows publication service; retain explicit revision semantics.
5. Exercise the completed mobile SQLite replica adapter on physical devices and add authorized read screens.
6. OCR/extraction review workflow on Windows.
7. Reporting/PDF/handoff package generation.
8. Billing-provider integration once the processor is selected.

The development Firebase project is hazcom-navigator-dev. Google Authentication, Firestore in us-central1, Firestore rules/indexes and FCM are configured. Blaze, Storage and all ten deployed Functions are verified, including real-cloud Google/SDS checks. The trusted backend now supports Account bootstrap, entitlement-sensitive Company creation, roles/memberships, coverage, explicit immutable publication, SDS uploads and member self-training. See [Firebase setup and contracts](../firebase/README.md). The payment processor, OCR engine and canonical Company/SDS retention period remain undecided.


## Publication/replication proof — September 21, 2026

The deterministic Company-scoped Windows SQLite serializer, durable publication orchestration, authorized receiver, atomic independent SQLite replacement, SDS verification and separate Training Event reconciliation are implemented in `@hazcom/sync`. A real callable emulator harness proves Small Company publication, clean Device B import, later revisions, interrupted/failed imports, privacy enforcement and training reconciliation. Existing Firebase server code/rules and limits are unchanged; no cloud deployment was needed.

Small is 140 records/20 SDS files. Medium (1,560/250) and Large (10,700/2,000) are rejected by the unchanged 350-record/100-attachment limits, while local SQLite import benchmarks succeed. Exact JSON/PDF boundaries are also executable tests. See [publication/sync handoff](PUBLICATION_SYNC_HANDOFF.md) for APIs, test commands, measurements, failure recovery, platform acceptance limits and the proposed scalable publisher. The new permanent checkpoint is `frozen/publication-replication-proof-2026-09-21`; existing frozen/archive refs must not be moved.
