# Firebase schema-2 development deployment and live acceptance

Updated September 26, 2026. Project `hazcom-navigator-dev` (391606138651), us-central1. No other Firebase project was targeted. The deployed Functions source is main `440b1635f00996ec7fc0b7ec6929850b319496d5`; this continuation changes only Windows client source/tests and documentation, so no backend redeploy is needed. The coordinated schema-2 Functions, Firestore rules/indexes, and private Storage rules were deployed earlier. The private `@hazcom/core` package was bundled successfully in the deployed Functions artifact.

## Cloud Run invocation audit

Every deployed service was inspected on September 26. Each has `invokerIamDisabled=true`, no `allUsers` Run Invoker binding, zero IAM bindings, and completed reconciliation. This permits Firebase SDK HTTPS requests to reach application authentication; it does not grant Firestore/Storage data access. An anonymous `getCompanyCapabilities` request reached the callable handler and returned `401 UNAUTHENTICATED`. The signed-in native Manager subsequently used the backend successfully. No project-wide IAM role was granted.

| Client-facing service | Invoker IAM disabled | Public Run Invoker binding |
| --- | --- | --- |
| abandonPublication | yes | none |
| beginPublication | yes | none |
| beginStagedPublication | yes | none |
| bootstrapAccount | yes | none |
| cleanupStagedPublication (Administrator-gated callable) | yes | none |
| coverCompany | yes | none |
| createCompany | yes | none |
| finalizePublication | yes | none |
| finalizeStagedPublication | yes | none |
| getCommercialStatus | yes | none |
| getCompanyCapabilities | yes | none |
| getCompanyCoverageStatus | yes | none |
| getPublicationProgress | yes | none |
| recordTrainingCompletion | yes | none |
| sealPublication | yes | none |
| setActiveCompany | yes | none |
| setMembership | yes | none |
| stagePublicationChunk | yes | none |
| switchDemoType | yes | none |
| updateCompany | yes | none |
| uploadPublicationSds (HTTPS request) | yes | none |
| uploadStagedSds (HTTPS request) | yes | none |
| validatePublicationPage | yes | none |

`cleanupStagedPublication` is not a scheduled/internal endpoint: source requires Firebase identity and Administrator Membership. All other listed exports are callable or HTTPS client endpoints. The read-only audit script is `scripts/dev-invoker.cjs` in the acceptance worktree; it is not needed for normal application operation.

## Native real-cloud publication

The signed-in native Windows app selected synthetic Company `smoke-19c0423b-64d3-4138-9cf8-89fc162d1f54`, Manager, active Pro coverage. The four identical selector labels are four **different** active synthetic Company IDs with separate Manager Memberships; no selector deduplication or cloud deletion was appropriate.

The selected Company's fixture has 2 Work Areas, 3 Chemical Products, 1 Worker, 2 Work Area Products, 2 Work Area Assignments, 3 SDS Verifications, 2 Training Events, 2 HazCom Reviews, and 3 SDS PDFs. A temporary rename of one hash-verified synthetic SDS caused `Readiness: BLOCKING` and disabled Publish; restoration gave `READY` with 17 records/3 SDS. The first native schema-2 publication staged 9 chunks and 3 PDFs and committed revision 2 `c17fea81-8c4d-45e8-88ea-12ca4ea54c96` at `2026-09-26T11:41:10.584Z`. The native UI initially reported a false post-finalization confirmation error, then reconciled the journal and showed the matching cloud revision. The Windows workflow now retries the current-pointer read after finalization.

An ordinary native Work Area description edit displayed “Local changes have not yet been published.” The second native publication completed with the normal success message, committing revision 3 `006f6e79-5646-403b-bf5c-715c8dcf8872` at `2026-09-26T11:54:29.162Z`. Its parent is revision 2. Both revision documents remain `status=published`, `schemaVersion=2`, `validationCursor=chunkCount=9`, and `validatedManifestHash=manifestHash`. The Company pointer is revision 3; each revision reports 17 records and 3 attachments.

Independent Firestore reads found all eight entity collections with expected counts and three verified attachment documents. A separate read-only development-cloud receiver downloaded the 3 actual GCS SDS objects for each sync, checked their metadata for absent `firebaseStorageDownloadTokens`, verified each byte size/SHA-256 and the revision manifest, and imported revision 2 into a fresh SQLite database. An injected corrupted revision-3 SDS download preserved revision 2; a clean retry atomically activated revision 3, with correct entity counts and a no-op repeat sync. This transport used privileged Firebase CLI OAuth for read-only cloud access, so it proves cloud payload/replica integrity **but does not prove client Firestore/Storage Rules authorization**. Separately, the signed-in native Firebase Storage SDK downloaded a revision-2 SDS with expected 632-byte size and SHA-256 `507dc54dbb5b38d0dae6505893f1faab1f869ab19edc5b888ba8972ff5187403`; unauthenticated Firebase Storage and public GCS URLs both returned 403. The temporary native read probe was removed after the test.

## Validation and remaining acceptance boundary

After the Windows journal and pointer-confirmation fixes: `npm test` passed; `npm run test:firebase` passed 16/16; `npm run test:windows:publication` passed 6/6; `npm run build` and the Functions build passed. `HAZCOM_SCALE_SIZES=small npm run test:scale` passed its schema-2 security/recovery tests and the 140-record/20-SDS emulator publication to a clean replica. The 5,000-SDS stress test was not rerun. No backend source changed after deployment.

Live authenticated **nonmember** SDS denial, live Member publication denial, live Demo publication denial, and live direct privileged-field write denial remain unverified. Their security behavior is covered in emulator tests. A proposed real-cloud write probe was rejected by automatic approval review because it could alter the Company revision pointer or Membership role. Do not describe those as live-cloud passes. Do not create `frozen/firebase-schema2-live-dev-2026-09-25` until the remaining live acceptance gates are satisfied with an approved safe test identity/workflow. No frozen branch has been modified.
