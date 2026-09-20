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

A full dependency installation/client bundle build was not completed in the build environment because the package-registry install attempt timed out. The repository keeps the client dependencies and native shells explicit so they can be installed and built on the development workstation.

## Next implementation slices

1. Windows CRUD repositories/forms for Work Areas, Workers, Chemical Products, Work Area Products, and Work Area Assignments.
2. Managed SDS file service (local attachments + publish upload + mobile download cache).
3. Google sign-in, Account/Membership hydration, and active-Company selection from Firebase Authentication/Firestore.
4. Publish builder that serializes one Company revision and uploads its attachment manifest.
5. Mobile revision downloader and local-replica replacement transaction.
6. OCR/extraction review workflow on Windows.
7. Reporting/PDF/handoff package generation.
8. Billing-provider integration once the processor is selected.

No source artifact specifies the payment processor, OCR engine, Firebase project identifiers, or the canonical Company/SDS retention period after subscription lapse, so those values are intentionally not hard-coded.
