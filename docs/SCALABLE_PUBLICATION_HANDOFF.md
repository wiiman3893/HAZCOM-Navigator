# Scalable staged publication — September 22, 2026

**Windows UI update (September 25, 2026):** The native Reports & Export screen is now connected to the existing schema-2 service through a readiness/retry controller. Its local SDS hash check compares bytes with the authoring-time integrity record, and its current-revision display is confirmed from the Company pointer. See [Windows publication handoff](WINDOWS_PUBLICATION_HANDOFF.md). This is a local/emulator source update; schema-2 has not been deployed to the development Firebase project.

This implementation builds on `f43f509bfefb544ef9122da8a33198a5e1a6ebf4`. Existing frozen/archive branches remain immutable. The application publisher now uses schema 2 staging; schema 1 endpoints remain explicitly isolated for development compatibility and regression tests. Authentication, subscriptions, Membership/Company semantics, the canonical SQLite schema and training-event reconciliation were not redesigned.

## Invariant and state machine

**An incomplete revision must never become the current revision.**

```text
begin immutable plan -> staging -> sealed -> ready -> published
                         |          |        |
                         +----------+--------+-> abandoned (irreversible tombstone)
```

`staging` permits bounded trusted chunk/file writes. `sealed` forbids all new writes while referential and file integrity checks run. `ready` records successful validation of the exact manifest. Only `finalizeStagedPublication` may move ready to published, and it writes the revision header and Company pointer in one transaction. Abandoned revisions cannot reopen, finalize or reuse their IDs. Cleanup preserves their tombstones.

Every staging transaction reads the revision state and rechecks enabled Google identity, canonical Manager/Administrator membership and Company coverage. A sealing/state transition conflicts with in-flight Firestore writes: transactions retry and then reject the incompatible state. Staging content stays unreadable even when some chunk/file receipts are complete. Existing receivers keep the prior published revision throughout the upload and validation phases.

## Layout and immutable manifest

```text
companies/{companyId}/publishedRevisions/{revisionId}
  schemaVersion: 2
  companyId, revisionId, parentRevisionId, createdByAccountId
  company: {id, name, contact_email}
  createdAt, expiresAt                         server-controlled; 24-hour staging deadline
  status, validationCursor                     server-controlled progress
  manifestHash, contentHash
  recordCounts, attachmentCount, chunkCount
  validatedManifestHash, validatedAt           set only after all pages validate
  revisionNumber, publishedAt                  set only by final atomic commit

  stagingPlan/root                             immutable canonical manifest
  chunkReceipts/{chunkId}                       trusted hash/count/range completion receipt
  {entityKind}/{stableId}                       ordinary eventual published records
  attachments/{attachmentId}                    expected identity/hash/size, verified/generation
  sdsOwners/{chemicalProductId}                 enforces one SDS slot across plan chunks
```

The canonical manifest contains schema version, Company/revision/parent/creator identity, Company settings snapshot, per-kind record counts, attachment count, ordered chunk descriptors and a deterministic content hash. Each descriptor has `chunkId`, `kind`, `count`, `firstId`, `lastId`, UTF-8 `bytes` and `sha256`. Attachment-plan chunks contain the complete expected attachment ID, Chemical Product owner, SDS slot, SHA-256 and byte size. Creation/deadline/state fields are server-owned header metadata and do not change the immutable plan hash.

`manifestHash` is SHA-256 over a fixed field-order serialization of the whole canonical manifest. `contentHash` covers Company, counts and all ordered descriptors, including attachment-plan hashes. Hashes therefore bind file metadata as well as records. The server reconstructs canonical field order rather than trusting Firestore map iteration order. The client likewise reconstructs it when verifying a published manifest.

Client totals are assertions, not authority. Begin validates descriptor sums, kinds, IDs, nonoverlapping ranges, limits, Company context and creator. A chunk receipt exists only after the submitted normalized rows match its descriptor exactly and all row writes commit. A file receipt exists only after the trusted uploader checks actual received bytes and private object metadata. Pre-seal counts ensure all expected receipts exist. Sealed validation reads the actual stored rows, reproduces chunk hashes, validates references and verifies file generations/metadata. These steps establish that the accepted counts describe real, validated data before publication.

The manifest can contain private Worker ID ranges. It is not returned in public revision metadata. Only Managers/Administrators can read `stagingPlan/root`, and only after publication; staging progress is returned to the creator through an authorized callable. Members never download another Worker's manifest details.

## Chunking and bounds

Client chunk assignment is deterministic: kind order follows the existing entity contract, rows sort by stable ID, and a greedy bounded splitter starts a new chunk at the count/byte threshold. IDs are `chunk-00000`, `chunk-00001`, etc. Entity chunks contain at most 100 rows; attachment-plan chunks contain at most 50 files; each chunk is at most 256,000 JSON bytes. Large individual text fields therefore cause a smaller row count per chunk. Source soft-deletion and Company ownership checks remain in the one-query SQLite serializer.

`stagePublicationChunk` normalizes and checks every field, requires sorted unique IDs and the exact descriptor, and writes rows plus receipt atomically. Entity chunks require at most 101 writes. Attachment plans require at most 101 writes including Product uniqueness guards. Duplicate identical chunks return without rewriting; conflicting bytes under the same chunk ID fail. Nonexistent cross-chunk foreign IDs are checked during sealed validation rather than bypassed.

This is not an unbounded publisher. Additional resource guardrails are 1,000 manifest chunks, 512,000 manifest JSON bytes, 100,000 entity rows and 20,000 attachments. These are protocol safety ceilings, **not claims that all combinations were tested**. The 1,000-chunk ceiling can be reached before either total-count ceiling. The old 350-record/3-MB/100-file limits still apply only to the explicitly legacy schema 1 endpoint. They were not raised to implement schema 2.

## SDS transport and visibility

V2 objects use a distinct path:

```text
companies/{companyId}/revisions-v2/{revisionId}/sds/{attachmentId}/{sha256}.pdf
```

`uploadStagedSds` is an authenticated binary HTTP Function, not an oversized base64 callable. One request carries one PDF, still capped at 5 MiB. It verifies the Firebase ID token (including revocation), Google account status, current authoring membership/coverage, revision state and the already-accepted attachment plan. Actual received bytes must match the manifest's SHA-256 and byte size. A Product owner is taken from that immutable plan, not an upload request field.

The backend creates the content-addressed object with generation-match-zero, clears any Firebase download token, verifies size/hash/manifest metadata, then rechecks authorization/state before registering its generation as verified. Identical retries can reuse the verified receipt without another object write. In-flight uploads after sealing/abandonment cannot register completion. No public upload/download bearer URLs are issued, and all direct client Storage creates/updates/deletes/lists remain denied.

Resume is **per file**: completed SDS files are skipped; an interrupted individual file restarts from byte zero. This is deliberate for bounded 5-MiB PDFs. There is no byte-offset resumable-upload protocol in this milestone. The client uses four concurrent uploads by default, capped at eight, and drains in-flight requests before returning an error or cancellation.

V2 Storage Rules use two Firestore lookups: canonical active membership and published revision header. Object metadata must bind the exact Company, revision, attachment, SHA and accepted manifest hash. Thus a verified object is still unreadable until the revision is published; one final marker exposes the complete validated set without updating thousands of attachment flags. The separate legacy path retains its original membership + published-attachment rule. See [Storage Rules conditions](https://firebase.google.com/docs/storage/security/rules-conditions) and [GCS generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions).

PDF validation is the existing signature/size/integrity contract, not full PDF content analysis. The Firebase Storage emulator can create download-token metadata on successful reads; tests verify removal before publication. That emulator behavior is not used as evidence of new real-cloud token behavior.

## Completeness proof and finalization

1. `sealPublication` checks complete chunk receipts and verified-file totals using server aggregation queries. Completion is monotonic while staging. The state transaction then freezes the revision. A premature seal/finalize fails without moving the pointer.
2. `validatePublicationPage` processes at most four descriptors per call. It checks the immutable manifest hash, receipt, actual stored chunk count/range/hash and required references within **this** revision. Work Area/Product/Worker ownership paths remain Company-scoped. Training `workerId` must equal its referenced assignment's Worker. SDS Product ownership and globally unique SDS slots are checked.
3. File validation checks that each required object exists at its expected path/generation with the expected byte size, previously computed SHA and manifest metadata, without a persistent token. Metadata checks run in bounded groups of eight. The SHA is calculated from bytes by the trusted uploader, not accepted from the client unchecked.
4. Each page advances a server-only cursor with compare-and-swap semantics. A repeated or competing validation call cannot double-advance it. Because all content writes are forbidden after seal, successful earlier pages remain valid. The last page sets `ready` and `validatedManifestHash`.
5. `finalizeStagedPublication` rechecks identity, membership, coverage, expiry, matching manifest/receipt, completed cursor and current parent. The critical transaction reads only the small authorization/header set and writes exactly **two documents**: revision and Company. It does not enumerate or mutate entity/file collections. Same-manifest retry returns the original revision number; competing parents cannot both win.

This proof assumes the Admin/IAM boundary remains trusted. An operator with unrestricted Admin access could manually corrupt or publish data outside these services; client rules cannot constrain that authority. [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) provide the final atomic boundary.

## Resume, cancellation and cleanup

The SQLite journal persists schema version, source fingerprint, revision/parent and manifest hash before the first network mutation. After restart, the client recreates the same manifest and asks `getPublicationProgress` for completed chunk/file IDs in pages of 200. It uploads only missing work, resumes validation from the server cursor, or resolves an ambiguous finalization response with an idempotent finalization retry. Changed logical data/Company context/creator cannot silently reuse the revision ID. Transient failures have bounded backoff; invalid data, stale parents, revoked membership and lost coverage fail closed.

Cancellation stops new operations and retains resumable staging. Explicit `abandonPublication` is allowed to the current creator or Company Administrator and is irreversible. Cleanup does not require paid coverage, but its public callable requires an active Company Administrator. The internal `cleanupStagedRevision` core is suitable for a future IAM scheduler.

Cleanup first checks that the revision is neither published nor the Company's current revision. Only expired staging or already-abandoned work qualifies. It marks an irreversible abandoned tombstone and waits 180 seconds to let bounded in-flight uploads drain. Each call deletes at most 100 objects (with generation preconditions) or 100 Firestore documents from fixed revision-local collections. It retains the root tombstone and refuses ID reuse. Repeated cleanup is safe and rescans for late orphaned objects. Tests fast-forward the cleanup clock using trusted emulator fixture writes; clients cannot change those times. Scheduling is not provisioned or deployed by this task.

## Receiver and compatibility

The receiver still consumes one immutable published revision through ordinary entity collections; it does not read staging chunks. Firestore reads are paginated at 400 records. Members retain Worker-filtered queries and never receive other Workers' records. Full Managers/Administrators fetch and verify the canonical manifest and each reconstructed chunk; Members verify their authorized data, hazard counts and every SDS against authenticated metadata without fetching the private full manifest.

SDS verification, temporary SQLite import, relationship validation, the local compare-and-swap guard and atomic active-replica replacement are retained. The Node harness downloads files with concurrency eight; the mobile adapter keeps serial file persistence because its SQLite plugin owns transactions. Separate training-event reconciliation, timestamp-tie handling, deduplication and historical ledger behavior are unchanged.

Schema 1 remains explicitly recognized; unknown schemas are rejected. Its old order-dependent payload hash may require republishing noncanonical development revisions. Schema 2 legacy-endpoint isolation is enforced on begin/upload/finalize: an old finalizer cannot turn a partially staged v2 plan into a published v1 revision. New client publication uses v2 by default, while `publishLegacy` exists only for compatibility tests.

## Running validation

Use Node 24 on the test workstation (for built-in SQLite) and Java 21 for emulators. Cloud Functions remain configured for Node 22; the emulator uses host Node 24 and reports that existing difference.

```text
npm test
npm run test:firebase
npm run test:sync:emulator
npm run test:scale
npm run build
npm run build -w @hazcom/firebase-functions
cargo check --manifest-path apps/windows/src-tauri/Cargo.toml
```

Run emulator commands sequentially because they share ports. `test:scale` defaults to Small, Medium, Large and Stress. `HAZCOM_SCALE_SIZES=small` is a development-only faster iteration option; it must not be confused with the full scale proof. The harness refuses nonlocal emulator hosts or a non-demo project. Admin fixture actions establish entitlements/Administrator membership, inject adversarial corruption, and advance expiry/cleanup clocks; all actual publication and receiver traffic uses authenticated client endpoints. No new real-cloud deployment or physical mobile acceptance is claimed.

The generated [scale results](scalable-publication-results.json) record pass/fail status, tested fixture sizes, timing and operation accounting. A dataset is supported by this checkpoint's evidence only if its full publication **and** fresh independent replica import completed and matched the author's logical fingerprint.

## Performance and cost accounting

The report measures projection, chunk staging, SDS upload, bounded validation, finalization, full receiver time, SDS download/staging and SQLite import. JSON sizes distinguish the source dataset, immutable manifest and total staged JSON. SQLite size excludes Node's separately stored SDS files. Synthetic PDFs are original safe local fixtures, roughly 600 bytes each; the 5,000-file test does not simulate 5,000 maximum-size real PDFs.

Actual callable/upload/download request counts and validation record/reference/metadata-read counts are observed. Logical operation estimates for a successful no-retry publish/receive are:

- Firestore writes: `records + 3 × SDS + chunk receipts + validation pages + 5` (plan + owner guard + verified receipt per SDS; begin 2, seal 1, finalization 2).
- Storage operations: approximately 5 per SDS (create, metadata update, upload metadata read, validation metadata read, receiver download).
- Additional Firestore reads come from each callable/file request's authorization checks, progress pages, manifest/chunk receipts, receiver queries and Storage Rule lookups. Transaction retries, indexes, SDK internals, network egress and authentication costs are not measured as billed operations.

SDS request/metadata operations and receiver downloads scale with file count; entity writes/readback scale with record count. Finalization stays constant. No dollar prices are invented. Local emulator timing is not a cloud throughput or billing guarantee.



## Executed scale measurements

Full callable/binary HTTP emulator run recorded 2026-09-22T06:59:59.816Z. Every row below completed publication and clean independent SQLite replication with logical fingerprint equality.

| Fixture | Records | Chunks | SDS | Dataset JSON bytes | Total staged JSON bytes |
|---|---:|---:|---:|---:|---:|
| small | 140 | 9 | 20 | 19515 | 26032 |
| medium | 1560 | 23 | 250 | 218291 | 276354 |
| large | 10700 | 147 | 2000 | 1529811 | 1969183 |
| stress | 28000 | 381 | 5000 | 3974711 | 5087814 |

| Fixture | Projection ms | Chunk upload ms | SDS upload ms | Validation ms | Finalize ms | Full publish ms | Full replica ms | SQLite import ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| small | 18.9 | 2544.0 | 1117.2 | 981.7 | 108.5 | 5345.2 | 454.8 | 8.0 |
| medium | 195.5 | 753.8 | 14026.5 | 2352.4 | 109.9 | 17793.6 | 2427.7 | 63.5 |
| large | 1631.9 | 4380.7 | 113014.9 | 17504.4 | 80.5 | 135656.2 | 13773.4 | 440.3 |
| stress | 3913.5 | 11409.9 | 281330.9 | 55605.3 | 108.7 | 349338.3 | 35455.1 | 1220.1 |

| Fixture | Estimated logical Firestore writes | Estimated Storage operations | Observed validation record / reference / metadata reads |
|---|---:|---:|---|
| small | 217 | 100 | 160 / 105 / 20 |
| medium | 2344 | 1250 | 1810 / 1290 / 250 |
| large | 16889 | 10000 | 12700 / 12600 / 2000 |
| stress | 43482 | 25000 | 33000 / 32750 / 5000 |

Stress reached 5,000 SDS files and 28000 relational entity records successfully. No hard practical ceiling was reached at that scale. The first observed performance bottleneck is the per-file SDS upload/authorization/metadata work, followed by linear validation and receiver work; exact phase timings above distinguish them. Finalization remains two writes and does not grow with record/file count. These measurements establish the tested ceiling, not unlimited scale.

## Remaining boundaries

- Tested scale and observed bottleneck are reported from the completed run, not inferred from guardrail maxima.
- Stage/receiver plans still live in memory; the manifest has a 1,000-chunk/512-KB bound. More extreme scale needs a manifest tree or paged plan protocol.
- Per-file resume restarts an interrupted PDF. Very large real SDS collections may justify a separately reviewed byte-resumable binary protocol.
- Validation and per-file authorization add linear read/request cost. Long-running operations must finish within the 24-hour staging window; expiry requires a new revision.
- Cleanup is implemented but unscheduled. Abandoned server/local staging consumes space until cleanup runs.
- Storage retains the existing two-lookup limitation: Company deactivation alone is not an extra Storage lookup. Canonical membership revocation removes SDS access, and receiver entry rechecks Company.active. Previously downloaded private bytes cannot be remotely erased.
- Native/mobile runtime acceptance, on-device storage/encryption, production authentication/App Check decisions and real-cloud load testing remain separate work. The emulator's post-download token artifact is documented above.

## Checkpoint

After full validation, commit main and create `frozen/scalable-publication-proof-2026-09-22` at that exact commit. Never repoint it or any earlier frozen branch. The final task report supplies the verified local/remote SHA.
