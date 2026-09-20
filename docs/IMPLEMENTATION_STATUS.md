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
- Firebase development project `hazcom-navigator-dev` with Google Auth, Firestore and FCM configured
- Firestore tenant/security rules deployed to the development project
- Trusted callable backend for Account bootstrap, entitlement-sensitive Company creation, Company settings, memberships, coverage, append-only training, and immutable revision publication
- SDS Storage rules and content-addressed upload path implemented and emulator-tested
- Development-only IAM/ADC entitlement utility and Google sign-in bootstrap harness
- Core automated business-rule tests
- SQLite migration/relationship/foreign-key/derived-view validation test
- Firebase Auth/Firestore/Storage emulator security suite (10/10 at the recorded checkpoint)

## Firebase cloud checkpoint

Firestore and Google Authentication are live in `hazcom-navigator-dev`. Cloud Functions source and Storage rules are in this repository but their cloud deployment is still blocked on Blaze billing and creation of the default `us-central1` Storage bucket. See `firebase/CODEX_HANDOFF.md`, `firebase/README.md`, and `firebase/VALIDATION.md` before resuming Firebase work.

The current Windows Management Home remains a shell prototype: the real Tauri Google sign-in gate, Account/entitlement hydration, Company selection/creation UX, and local SQLite binding to the authenticated active Company are not yet implemented.

## Next implementation slices

1. Complete Blaze/Storage provisioning and deploy Functions + Storage Rules; perform real cloud SDS/auth smoke tests.
2. Wire Google sign-in and the authenticated Account -> entitlement -> Memberships -> active Company front door into the Windows Tauri app.
3. Implement Windows CRUD repositories/forms for Work Areas, Workers, Chemical Products, Work Area Products, and Work Area Assignments.
4. Connect Windows publish builder to the existing trusted revision Functions and SDS upload flow.
5. Implement mobile revision downloader and local-replica replacement transaction.
6. OCR/extraction review workflow on Windows.
7. Reporting/PDF/handoff package generation.
8. Billing-provider integration once the processor is selected.

The original Constellation source artifacts remain authoritative reference inputs and are intentionally unchanged.
