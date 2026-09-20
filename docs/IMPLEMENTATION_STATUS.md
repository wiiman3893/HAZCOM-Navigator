# Implementation status

## Foundation implemented

- Canonical domain types and stable relationship IDs
- Role/permission definitions and authorization helper contracts
- Customer and Professional plan definitions
- Derived HazCom review, SDS verification, and assignment training status logic
- Assignment/product-added training requirement behavior
- Publish-revision manifest contract
- Verbatim Constellation SQLite schema plus derived non-authoritative views
- Windows Tauri shell with SQLite initialization, explicit active-Company context, and scoped dashboard queries
- Mobile Capacitor shell with SQLite published-replica initialization
- Firebase Firestore rules scoped to active Company membership
- Firebase Storage revision reads scoped to active Company membership through Firestore-backed Storage rules
- Callable Cloud Function for append-only Member training completion with linked-Worker relationship authorization
- Core automated business-rule tests
- SQLite migration/relationship/foreign-key/derived-view validation test

## Validation completed

`npm test` passes in the build environment. This validates the shared business logic and creates the Constellation schema in an in-memory SQLite database with foreign keys enabled, exercises canonical ownership/reference tables, and verifies the three derived compliance/training views.

The development workstation now passes both Windows and mobile frontend builds. The Firebase foundation has 10 passing emulator integration/security tests, verified on Node.js 22 and 24. Native binaries were not rebuilt in this backend task. See [Firebase validation](../firebase/VALIDATION.md) for the cloud provisioning and test evidence.

## Next implementation slices

1. Windows CRUD repositories/forms for Work Areas, Workers, Chemical Products, Work Area Products, and Work Area Assignments.
2. Managed SDS file service (local attachments + publish upload + mobile download cache).
3. Google sign-in, Account/Membership hydration, and active-Company selection from Firebase Authentication/Firestore.
4. Publish builder that serializes one Company revision and uploads its attachment manifest.
5. Mobile revision downloader and local-replica replacement transaction.
6. OCR/extraction review workflow on Windows.
7. Reporting/PDF/handoff package generation.
8. Billing-provider integration once the processor is selected.

The development Firebase project is hazcom-navigator-dev. Google Authentication, Firestore in us-central1, Firestore rules/indexes and FCM are configured. Storage creation and deployed Functions await Blaze billing approval. The trusted backend now supports Account bootstrap, entitlement-sensitive Company creation, roles/memberships, coverage, explicit immutable publication, SDS uploads and member self-training. See [Firebase setup and contracts](../firebase/README.md). The payment processor, OCR engine and canonical Company/SDS retention period remain undecided.
