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
- Mobile Capacitor shell with SQLite published-replica initialization
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

## Next implementation slices

1. Finalize production desktop OAuth and secure session/offline policy. Development cloud provisioning and smoke tests are complete.
2. Extend native authentication acceptance tests and implement published member read screens. The development front door is wired.
3. Implement Windows CRUD repositories/forms for Work Areas, Workers, Chemical Products, Work Area Products, and Work Area Assignments.
4. Connect Windows publish builder to the existing trusted revision Functions and SDS upload flow.
5. Implement mobile revision downloader and local-replica replacement transaction.
6. OCR/extraction review workflow on Windows.
7. Reporting/PDF/handoff package generation.
8. Billing-provider integration once the processor is selected.

The development Firebase project is hazcom-navigator-dev. Google Authentication, Firestore in us-central1, Firestore rules/indexes and FCM are configured. Blaze, Storage and all ten deployed Functions are verified, including real-cloud Google/SDS checks. The trusted backend now supports Account bootstrap, entitlement-sensitive Company creation, roles/memberships, coverage, explicit immutable publication, SDS uploads and member self-training. See [Firebase setup and contracts](../firebase/README.md). The payment processor, OCR engine and canonical Company/SDS retention period remain undecided.
