# HazCom Navigator

HazCom Navigator is the implementation of Constellation project **SS-2026-1764**.

## Architecture

The repository preserves the architecture resolved by Constellation:

- **Windows authoring client:** React + TypeScript in a Tauri 2 shell. Local SQLite is the draft/working authority.
- **Android/iOS consumption client:** React + TypeScript in Capacitor 8. Local SQLite is a published-replica store with offline access and limited capture.
- **Shared backend:** Firebase Authentication, Cloud Firestore, Cloud Storage, Cloud Functions, and FCM.
- **Data movement:** publish-revision. Windows drafts are not treated as cloud-authoritative until published.
- **Canonical Organization:** `Company`. Membership/role authorization never creates a duplicate organization domain object.

The original Constellation artifacts are retained under `docs/constellation/` and the initial SQLite plan is retained verbatim in `database/migrations/001_constellation.sql`.

## Repository layout

- `packages/core` — canonical TypeScript domain types, permission matrix, compliance logic, plan definitions, revision contracts, and SQLite schema text.
- `database/migrations` — SQLite schema and derived non-authoritative views.
- `apps/windows` — full-authoring Windows client foundation.
- `apps/mobile` — Android/iOS consumption client foundation.
- `firebase` — Firestore/Storage rules plus callable backend functions for authoritative distributed mutations.
- `docs/constellation` — source build specification.

## First run

1. Install Node.js 22+ and Rust (for Tauri) on the Windows development machine.
2. Run `npm install` from the repository root.
3. Copy `.env.example` to `.env` and supply the Firebase project values.
4. Run `npm test` to validate canonical business rules.
5. Run `npm run dev:windows` for the Windows shell.
6. Run `npm run dev:mobile` for the Capacitor web shell, then `npm run cap:android -w @hazcom/mobile` or `npm run cap:ios -w @hazcom/mobile` after native platform generation.

## What is already enforced

The initial foundation includes stable IDs, canonical relationships, Company ownership, append-only event semantics at the service layer, derived review/verification/training state, role/scope definitions, paid plan definitions, explicit active-Company context contracts, and published-revision contracts. SQLite connections are required to enable `PRAGMA foreign_keys = ON`.

## Deliberately not guessed

The Constellation source does not define a Firebase project ID, payment processor, detailed visual design system, OCR engine, or canonical-retention period for Company data/SDS files after subscription lapse. Those are left configurable instead of being invented in code.
