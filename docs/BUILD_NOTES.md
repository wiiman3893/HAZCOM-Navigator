# Build notes

## Architecture fitness

The Constellation architecture is a reasonable fit and was retained without substitution: SQLite is the local/offline persistence foundation, Windows is the draft-authoring authority, Firebase is the published/shared authority, and Android/iOS are offline published replicas. The publish-revision boundary is intentionally explicit rather than a continuous bidirectional edit sync.

## Repository destination

The requested destination is `SaturnStraw/HAZCOM-Navigator`. At implementation time that repository did not resolve through the connected GitHub integration, and the available GitHub integration did not expose repository creation. The complete initial source tree was therefore generated locally rather than silently writing to a different repository.

## Source fidelity

`database/migrations/001_constellation.sql` is retained verbatim from the supplied `schema-plan.sql`. The implementation does not add convenience `company_id`, `work_area_id`, or similar ownership columns to domain tables; tests exercise the canonical ownership and reference relationship tables from Constellation.

## Validation

Run from the repository root:

```text
npm test
```

The test command builds/tests the shared TypeScript business logic and creates the SQLite schema in-memory, enables foreign keys, inserts records through the canonical relationship tables, runs `PRAGMA foreign_key_check`, and verifies review/SDS/training derived views.
