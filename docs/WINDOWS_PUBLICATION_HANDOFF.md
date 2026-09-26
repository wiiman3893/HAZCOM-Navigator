# Windows schema-2 publication workflow — September 25, 2026

**Later cloud status:** The matching backend was deployed to `hazcom-navigator-dev`, but native live acceptance is pending an explicit Cloud Run HTTPS invoker setting. The real app restored Account/Company/role/coverage, then reported `internal [0]` opening authoring because Cloud Run rejected `getCompanyCapabilities` before its Firebase handler. No real-cloud publication result exists yet. See [deployment handoff](FIREBASE_SCHEMA2_DEPLOYMENT_HANDOFF.md). The description below records the original local/emulator checkpoint.

The Windows Reports & Export screen now exposes publication for an authenticated Company Administrator or HAZCOM Manager. This is a source and local/emulator checkpoint. The schema-2 Functions, rules and indexes have **not** been deployed to the development Firebase project, and no live Company was published by this task.

## Application boundary

`PublicationPanel.tsx` only displays workflow state. `publication-workflow.ts` owns readiness, attempt selection, retry reconciliation and local receipt comparison. `data/publication.ts` supplies the native Firebase/Tauri adapters. The existing `@hazcom/sync` schema-2 publisher still owns immutable manifest construction, staging, SDS binary upload, sealing, paged validation and finalization. The UI never writes published Firestore records or Storage objects directly.

The native adapter verifies Google identity, active Company and Manager/Administrator Membership, active Account Company, authoritative `getCompanyCapabilities().capabilities.canPublish`, Company pointer and published revision metadata. Demo, grace/export and expired coverage show distinct blocking explanations. The server repeats authorization on each publication operation; UI gates are advisory.

## Readiness

Opening Reports & Export or selecting **Check readiness** takes a fresh authoritative Company/coverage read and builds one Company-scoped local projection. The projection validates SQLite ownership, foreign keys, normalized relationships, Company fields, SDS file readability/signature/declared size and schema-2 chunk/manifest limits. The Windows adapter additionally compares each current SDS file's SHA-256 against `authoring_sds_integrity`, which was recorded when the PDF was attached. A missing file or mismatch blocks publication and identifies its attachment/Product ID in diagnostic detail. Company name/email must match the authoritative cloud Company.

READY has no issues. WARNING allows publication: examples are a Company with no Work Areas, no Chemical Products or a Product without an SDS, since the existing server contract permits those. BLOCKING disables Publish. The screen shows readable issues and counts. No new rule requires every Product to have an SDS.

Readiness builds a schema-2 manifest locally before enabling Publish. The workflow then rechecks Company/role/capability/cloud parent and the projection fingerprint immediately before starting. The trusted backend remains the final authority.

## Progress, retry and revision display

Progress reports stages and exact completed/total counts only where the publisher emits counts: staged record/reference chunks, SDS files, validation pages, finalization and success. There is no invented byte progress. Publication attempts persist a revision ID, parent ID and draft fingerprint in a user-scoped SQLite journal. The existing publisher also persists its manifest and completed work; Retry Publication reuses the same revision for unchanged data/parent and skips completed chunks/files. Changed draft or cloud parent uses a new revision ID after a fresh check. Stale parents and changed-data retries fail closed server-side.

A lost finalization response is reconciled against the Company's current published revision and its manifest hash. If the published manifest matches the interrupted local attempt, the UI records success without creating another revision. If it cannot verify that identity, it blocks another publish and directs the user to support. A successful response is not shown as current until a fresh Company pointer read confirms the revision.

The screen shows the current revision number, publication time, Company, record count and SDS count from the published cloud header. It shows a shortened revision ID. A user-scoped local receipt stores the exact projection fingerprint after confirmed publication. A later readiness check compares the current schema-2 content hash with the fresh local plan, including when no local receipt exists. For older schema-1 cloud revisions without a comparable content hash or local receipt, it does **not** claim the draft matches the cloud.

Changing Company while publication runs is blocked in the current UI; Company ID is also checked at every workflow boundary. Diagnostics log Company/revision IDs, stage, counts, retry and failure category. They omit tokens, credentials and PDF bytes.

## Validation and deployment boundary

The new controller tests use synthetic SQLite publication projections and cover role/entitlement gates, SDS file failures and stored-hash checks, Company scope, retry ID reuse, lost finalization response, stale cloud parent, duplicate avoidance and local changes. The Playwright acceptance harness uses synthetic authoring SQLite and a local publication endpoint to exercise SDS attachment, Product placement, readiness, Publish, revision display and a later draft edit. It does not claim a native live-cloud acceptance pass. Existing schema-2 emulator tests exercise actual callable Functions, Firestore, Storage, upload authorization, publication/replication and security failures.

Executed validation: `npm test`, `npm run test:firebase` (16 tests), `npm run test:windows:publication` (5 tests), `npm run test:authoring:ui` (5 tests), `npm run build`, Functions build and `cargo check` passed. `HAZCOM_SCALE_SIZES=small npm run test:scale` passed its security/recovery suite and the 140-record/20-SDS full publish to clean replica. The [focused emulator result](scalable-publication-development-results.json) records that run. The historical Medium/Large/Stress measurements remain in the scalable-publication handoff and were not rerun here.

Before any real schema-2 cloud publication, deploy the matching Functions, indexes, Firestore/Storage rules and compatible clients together; run a controlled development-project acceptance with a paid test entitlement and verify SDS reads/replication. The current deployed development backend remains older than this source checkpoint. No deployment, billing connection or real Company mutation occurred here.
