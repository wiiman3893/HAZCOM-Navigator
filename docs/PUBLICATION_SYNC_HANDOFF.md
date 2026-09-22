# Publication and replication proof — September 21, 2026

This milestone starts from canonical main `5757b8f`. It adds service APIs and executable evidence without changing deployed Firebase Functions, Firestore/Storage rules, authentication, entitlements, the source Constellation schema, or existing frozen refs. No cloud deployment or real customer data is involved in this proof.

## Entry points and execution

- `packages/sync/src/projection.js`: `buildPublication(sql, companyId, files)`.
- `packages/sync/src/publisher.js`: `publish({projection, revisionId, parentRevisionId, transport, files, journal, signal})`.
- `packages/sync/src/firebase.js`: authenticated Firebase SDK transport for callable Functions, server-only Firestore reads and authenticated Storage `getBytes`.
- `packages/sync/src/receiver.js`: `receiver(...).sync(companyId)` and separate `syncTraining(companyId)`.
- `packages/sync/src/sqlite.js`: canonical record/ownership insertion and transactional replica activation.
- Windows: `apps/windows/src/data/publication.ts`, `publishWindowsCompany`. Select the active Company first. The service revalidates authoring access and reads the existing Tauri author database. Its persistent, account-scoped publication journal uses a separate database. Native SDS reads are bounded to `<app data>/attachments`, reject traversal/symlink escapes, and enforce the existing PDF size/signature checks.
- Mobile: `apps/mobile/src/data/published-replica.ts`, `openPublishedReplica(firebase, companyId)`. It creates a new database name derived from account + Company, never opens the author/demo database, and uses Capacitor `executeSet(..., true)` for atomic replacement. Staged SDS bytes live in private SQLite as base64; consumers use `readActive()` after a live membership check. No new UI is wired.
- Harness: `packages/sync/test/emulator.test.mjs`, with generated SQLite/PDF fixtures in `fixtures.mjs`. Node's built-in SQLite is the executed native SQLite engine; mobile adapter types compile, but this milestone does not claim an Android/iOS device runtime test.

Run from repository root (Node 24; Java 21 on PATH for emulators):

```text
npm ci
npm test
npm run test:firebase
npm run build
npm run test:sync:emulator
cargo check --manifest-path apps/windows/src-tauri/Cargo.toml
```

Run the two emulator suites sequentially; they share ports and the isolated `demo-hazcom-navigator` namespace. `test:sync:emulator` builds Functions, starts Auth + actual callable Functions + Firestore + Storage emulators, and uses separate Firebase client app/auth instances. The harness refuses non-local emulator hosts/non-demo project configuration. Synthetic Google credentials are the documented Auth-emulator facility, never a production sign-in bypass. Admin SDK is restricted to synthetic entitlement/membership/security and timestamp-pagination fixtures; publication itself always goes through authenticated client callable endpoints.

Generated evidence: [local measurements](publication-sync-measurements.json), [emulator results](publication-sync-emulator-results.json). Temporary databases and PDFs are generated under the system temporary directory; no author database is copied or uploaded. Both generated reports are machine-specific, single-run evidence, not production benchmarks.

## Projection contract

The serializer uses **one SQLite SELECT** for a consistent relational snapshot, including pooled Tauri connections. It follows Company ownership through Work Areas, Chemical Products, Workers, Work Area Products, Work Area Assignments, SDS Verifications, HAZCOM Reviews and Training Events. Ownership/link tables become the existing explicit foreign IDs. Required references must resolve within the projected Company. Active unowned records cannot be assigned safely to any Company, so they block projection; SQLite foreign-key corruption also blocks it. Soft-deleted records and descendants of deleted owners are omitted. An included live relationship to an excluded/deleted target is an error rather than silently losing the relationship.

Stable IDs remain unchanged. Arrays use ordinal ID ordering; field order matches the server validator. Optional values become null. Dates are strict calendar dates; explicit-zone timestamps normalize to UTC dates, and ambiguous timestamps fail. Company details are validated locally and checked against authoritative cloud Company context by the Firebase transport; publication does not grant Managers permission to change Company settings.

Each selected `chemical_product`/`sds` attachment must belong to an included Product. One SDS per Product is the current backend contract. The builder reads managed bytes, checks declared size, signature and 5 MiB ceiling, computes SHA-256, and records stable attachment/owner IDs, relative local path, hash and size. Files are reread and rehashed immediately before upload. Products without an SDS reference are permitted by the existing contract; a reference whose file is absent fails. The service is an integrity checker, not a PDF renderer/content-safety scanner.

The logical fingerprint includes Company, normalized records and attachment identities/hash/size, excluding machine-local file paths. SQLite insertion order and equivalent date representations do not change it. Raw SQLite, accounts, subscriptions, roles, local audit/configuration tables and unrelated Company records never enter the publication payload.

## Publication lifecycle

The client persists revision ID, parent ID and fingerprint before `beginPublication`. It then uploads bounded PDFs through `uploadPublicationSds` and calls `finalizePublication`. Transient unavailable/deadline/network failures receive bounded retries; a later invocation resumes using the same journal/revision. Re-uploading identical SDS bytes is safe under the existing server contract. A lost finalization response is resolved by beginning the same revision, skipping uploads if already published, and finalizing the same payload again to verify idempotency.

Changed logical data requires a new revision ID. A stale parent is rejected by the server. Cancellation stops subsequent work; already-uploaded staging is retained and remains inaccessible. Cancellation cannot undo an acknowledged server commit. Staging expires after the existing 24-hour window; expired sessions require a fresh revision. There is no remote delete-on-cancel and no new privileged client write path.

Cloud shape is unchanged:

```text
companies/{companyId}                         currentRevisionId / currentRevisionNumber
  publishedRevisions/{revisionId}             immutable published metadata + Company snapshot
    {datasetKind}/{stableId}                  normalized authorized entity documents
    attachments/{attachmentId}                ownership, SHA-256, size, path, published flag
  trainingEvents/{stableId}                   append-only events independent of publication

Storage: companies/{companyId}/revisions/{revisionId}/sds/{attachmentId}/{sha256}.pdf
```

The existing finalizer atomically commits all records, attachment publication flags and the Company pointer. Pending, failed and stale revisions never become current. Its payload hash is SHA-256 of server-normalized rows plus sorted attachment IDs. It is not a cryptographic hash of the entire Company/attachment metadata manifest.

This receiver verifies the canonical ID ordering produced by the new serializer. The old finalizer hashed input array order without recording that order in Firestore; a legacy revision submitted in a different order may therefore fail full-payload verification and require a fresh canonical publication. It fails safely without replacing the active replica. The backend hash behavior is deliberately unchanged at this checkpoint.

## Receiver and atomic SQLite activation

Every synchronization starts with fresh authenticated Company/membership reads. An unchanged revision in the same role/Worker scope is a no-op. Scope changes require replacement even if the revision ID is unchanged. Cross-account/Company database reuse is refused.

The receiver validates revision/schema identity, counts, all required relationships, attachment uniqueness/ownership, exact Company/revision Storage paths, SHA-256 and size. Managers/Administrators additionally reproduce the full server payload hash. Members cannot recompute that global hash without retrieving forbidden personal data: they validate complete hazard counts, scoped personal records and authoritative authenticated metadata instead. Members read only their Worker document, Worker-filtered assignments/training, and Company-wide hazard/SDS data. Null Worker links produce no personal rows.

Downloaded bytes are staged in the receiver's own managed store and read back for integrity verification. Company revision and membership are rechecked after download. A revision or membership change aborts activation; a subsequent sync retries from the current cloud pointer. A cloud update immediately after that last check can still leave a **complete, valid older revision**, which the next sync discovers. There is no distributed SQLite/Firestore transaction.

The local import constructs canonical records and ownership/link statements in temporary, uncommitted SQLite state. One transaction deletes the previous canonical snapshot, inserts all new records and file references, validates foreign keys, and switches the local revision marker. A compare-and-swap guard on the entire previous marker prevents a concurrent importer overwriting newer state. Other SQLite connections see the old snapshot until commit. Fault injection at four positions, including after partial insertion, demonstrates rollback; a separate connection observes the old revision during successful replacement.

Failure leaves the old active dataset usable. Downloaded but unreferenced staging files are retained, not deleted on an ambiguous commit acknowledgement; deleting them could corrupt a successfully committed replica. Future garbage collection must inspect committed references first. Read access is gated by live membership/scope. Previously downloaded private app data is not remotely erased on revocation; offline leases, encryption-at-rest policy, secure wipe and persistent UI access handles remain separate product work.

## Training Event reconciliation

`syncTraining` is separate from full revision synchronization. It reads the append-only Company event collection with Member filtering, paginated by `createdAt` then document ID. Each invocation rescans the log and deduplicates stable IDs in a separate SQLite ledger. It deliberately does **not** persist a timestamp high-water mark: server timestamps are assigned before transaction commit, so a late commit could otherwise be skipped forever. Tests cover more than 100 equal-timestamp events and a later inserted event with an older timestamp.

New events, canonical training rows and the local generation marker commit together. Conflicting reuse of an event ID fails. A later published revision containing an already-reconciled event does not duplicate it. When an assignment disappears from a newer publication, its event remains in the historical ledger but is not inserted into canonical tables with a broken foreign key. Role/Worker scope changes replace personal rows and clear the old scoped ledger. This is one-way published/event reconciliation, not live draft synchronization.

## Measured capacity

Current source limits are **350 total entity records**, **3,000,000 UTF-8 JSON bytes**, **100 selected attachments**, and **5,242,880 bytes (5 MiB) per PDF**. Company headers and attachments do not count as entity records. Base64 input is separately capped at 7,000,000 characters. These limits were not raised.

| Fixture | Areas / Products / Workers | Entity records | JSON bytes | SDS files | Result |
|---|---:|---:|---:|---:|---|
| Small | 5 / 20 / 10 | 140 | 19,515 | 20 | Full emulator publication and independent replica proof |
| Medium | 30 / 250 / 100 | 1,560 | 218,291 | 250 | Rejected before upload: records and attachments |
| Large | 100 / 2,000 / 500 | 10,700 | 1,529,811 | 2,000 | Rejected before upload: records and attachments |

Medium first exceeds the running record ceiling in `workers` (30 Areas + 250 Products + 100 Workers = 380). Large first exceeds it in `chemicalProducts` (100 Areas + 2,000 Products = 2,100). The validator rejects the whole offending collection; it does not truncate to 350. Neither fixture reaches the JSON ceiling. Synthetic PDFs are roughly 600 bytes each; larger real SDS payloads will change network/storage costs independently of JSON size.

The boundary harness accepts exactly 350 records/100 selected attachments together through actual callable finalization, rejects 351 records/101 attachments, validates 3,000,000 versus 3,000,001 JSON bytes using the current backend validator, uploads exactly 5 MiB, and rejects 5 MiB + 1. Medium/Large are also rejected by the real backend validator, not just a client estimate. Local import benchmarks bypass **cloud publication only** to quantify SQLite capacity; they do not claim these Companies were published successfully.

The JSON measurement report records projection time (including attachment reads/hashes), one-query SQLite export time, local transactional import time, and checkpointed author/replica DB sizes. Separate SDS file bytes are not included in Node SQLite database sizes. Mobile's base64 SQLite SDS store would be larger and has not been benchmarked on-device.



### Local performance evidence

Single run on Node v24.18.0, 2026-09-22T01:35:23.551Z. Export is the consistent SQLite snapshot query; projection includes export and SDS reads/hashes. Import is the SQLite transaction after staging files. Database sizes exclude separately stored SDS bytes.

| Fixture | Export ms | Projection ms | Import ms | Author DB bytes | Replica DB bytes |
|---|---:|---:|---:|---:|---:|
| small | 1.38 | 17.56 | 7.95 | 536576 | 536576 |
| medium | 5.65 | 192.83 | 59.81 | 1204224 | 1208320 |
| large | 42.96 | 1539.45 | 459.26 | 5103616 | 5111808 |

## Executed failure coverage

- Publication offline before begin; interruption after an SDS upload response; duplicate upload; lost finalization response; already-published retry; changed-data retry; cancelled publication; stale parent.
- Malformed/unknown fields, cross-Company IDs, unowned rows, missing relationships, missing SDS file/registration, bad declared size, unsafe file paths, invalid dates.
- Incomplete manifest, wrong SDS ownership/path/hash/size, corrupted/interrupted downloads, wrong revision metadata, missing data, mid-sync revision advance.
- SQLite failure before and during import, concurrent importer conflict, reader visibility during transaction, same-revision no-op.
- Revoked/deleted/inactive/invalid-role membership, Company deactivation, revocation during download, denied Member full-dataset reads, same-revision Manager-to-Member replacement.
- Training deduplication, separate post-publication advancement, pagination/timestamp ties/late commits, republished events, removed assignment history and unauthorized other-Worker training.

The report files and command exit results are the evidence. Browser/native visual acceptance is neither requested nor claimed for this milestone. Windows Rust compiles; desktop/native file I/O and mobile Capacitor runtime integration beyond the automated Node SQLite harness remain platform acceptance work.

## Follow-up scalable publisher design (not implemented)

1. **Freeze a manifest first.** Allocate a revision with immutable parent, schema version, creator, normalized Company snapshot, entity/chunk counts, SDS identities/owners/hash/size, per-chunk hashes, and a canonical root hash. Changing content creates a new revision ID. Personal Worker manifests/chunks must be separately authorized so Members can verify completeness without receiving other Workers' data.
2. **Write bounded chunks through trusted services.** Deterministic entity/chunk IDs and content hashes make retries idempotent. Keep every chunk under request/document/write budgets. Persist acknowledgements per chunk; reject conflicting content for an existing chunk. Chunks remain staging and unreadable to ordinary receivers.
3. **Resume thousands of uploads.** Use a narrowly authorized resumable staging upload protocol tied to account, Company, revision, attachment ID, expected size and hash. Store server-verified object generation, bytes and hash per file. Never issue public persistent download tokens. A privileged verifier registers complete uploads; clients cannot declare their own integrity success. Reuse verified content only with explicit Company ownership and revision references.
4. **Seal then validate.** Stop accepting mutations once sealing begins. A trusted worker verifies all manifest chunks, exact counts, duplicate IDs, cross-chunk relationships, SDS ownership, object existence/generation and hashes. Persist a validation receipt bound to the root hash. Incomplete or inconsistent work stays staging/failed and cannot produce a valid receipt.
5. **Commit a small final transaction.** Recheck identity, membership, coverage, expected current parent, sealed state and validation receipt/root. Mark the immutable revision published and switch `currentRevisionId`/number in the same transaction. No bulk entity writes occur in this transaction. A competing publisher invalidates the stale parent; no implicit merge or forced pointer update.
6. **Make visibility depend on final publication.** Rules and receiving manifests must require the published root state. Storage registration/visibility must fit the existing cross-service lookup budget; do not expose partially completed objects while mass-updating attachment flags. Design and test that change explicitly before replacing today's contract.
7. **Recover and clean safely.** A durable job/session journal tracks chunks and upload offsets. Retry of the same sealed/published root returns its original result. Expired staging cleanup uses leases plus a terminal abandoned state, checks current/published references, and deletes only staging objects at their recorded generations. Never let cleanup race finalization or delete published SDS/history. Track orphan local staging separately using committed replica references.
8. **Keep receiver activation atomic.** Download bounded authorized chunks into an isolated temporary replica, validate manifest root and per-file integrity, retain a durable resume journal, then switch only after complete validation and final access/pointer checks. A failed download/import must leave the previous complete replica active.

The invariant is unchanged: **an incomplete revision must never become the current revision**. Add cloud-scale/load/device tests only after this follow-up design is approved for implementation; this checkpoint intentionally proves today's bounded architecture.

## Git preservation

Commit validated work to main and create `frozen/publication-replication-proof-2026-09-21` at that exact commit. Never repoint it. Existing `archive/pre-local-working-import-2026-09-21`, `frozen/working-google-auth-2026-09-21`, `frozen/authenticated-front-door-2026-09-21` and other existing frozen refs remain immutable. Resolve the new checkpoint SHA with `git rev-parse frozen/publication-replication-proof-2026-09-21`; the final task report records it after creation.
