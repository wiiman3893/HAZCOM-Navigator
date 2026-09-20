# Build notes

## Architecture fitness

The Constellation architecture is a reasonable fit and was retained without substitution: SQLite is the local/offline persistence foundation, Windows is the draft-authoring authority, Firebase is the published/shared authority, and Android/iOS are offline published replicas. The publish-revision boundary is intentionally explicit rather than a continuous bidirectional edit sync.

## Repository destination

The Constellation artifact originally named `SaturnStraw/HAZCOM-Navigator` as the implementation target. The repository actually created and explicitly approved by the project owner is `wiiman3893/HAZCOM-Navigator`, so this repository is the active implementation destination. The original Constellation artifact is retained unchanged under `docs/constellation/` for traceability.

## Source fidelity

`database/migrations/001_constellation.sql` is retained verbatim from the supplied `schema-plan.sql`. The implementation does not add convenience `company_id`, `work_area_id`, or similar ownership columns to domain tables; tests exercise the canonical ownership and reference relationship tables from Constellation.

## Validation

Run from the repository root:

```text
npm test
```

The test command builds/tests the shared TypeScript business logic and creates the SQLite schema in-memory, enables foreign keys, inserts records through the canonical relationship tables, runs `PRAGMA foreign_key_check`, and verifies review/SDS/training derived views.
