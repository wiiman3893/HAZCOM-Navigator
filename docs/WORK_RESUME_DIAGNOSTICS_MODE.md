# In-application Diagnostics Mode — completed and integrated

Validated implementation `661b28d779a5b12a7ff119a06ecc803aa8934335` was fast-forwarded to GitHub main and fetched back successfully. The task branch points to the same implementation. A documentation-only closeout follows it. No implementation work remains in this milestone.

Final broad report: `diagnostics/output/20260928T021454` — all six validation groups PASS. It executed test:diagnostics (16), npm test including core/SQLite/sync/test:authoring (14 authoring tests), test:firebase (24), test:windows:publication (12), build (Windows/mobile) and Functions build. Separately: test:authoring:ui 12 PASS, cargo test 17 PASS, native publication emulator proof PASS, native ZIP accepted by both Python and the read-only Node validator, git diff --check PASS. Overall diagnostic WARN reflects unresolved live acceptance/status evidence, not a failed test group. Informational warnings remain the existing Vite chunk size, existing native test-helper dead code, and Node's experimental TypeScript test transformer.

Final built-executable runtime repeat PASS: clean `diag_d8a987d11d7036dec5f596704194703d`; interrupted `diag_08d2da840ff81368d9c99ce479242433`. Startup event, clean shutdown event/end timestamp, forced termination recovery and inactive normal restart verified without signing in. Evidence: `diagnostics/output/diagnostics-runtime-final.json`.

Completion report:

| Requested area | Result |
|---|---|
| Starting main/task SHA | `635cfd1e721835765d4417edc52332c705afc734` |
| Task branch | `work/in-app-diagnostics-mode-2026-09-27`; implementation SHA above, followed by documentation-only closeout |
| Interrupted work | Contract and resume note recovered intact; diagnostics.rs was wholly unexecuted when approval review exhausted usage, not partially applied |
| Existing infrastructure | CLI health collectors, redactor, schema-1 report and store-only ZIP convention preserved; complementary read-only session validator added |
| Central architecture | One native writer/thread per process, bounded frontend/native queues, session-owned app-data artifacts, no workspace coupling |
| Semantic architecture/types | Shared vocabulary/allowlists; timed service observers and current UI state boundaries; domain CRUD/events, SDS/Bulk, backup, publication, workspace, auth/access, navigation, validation/errors |
| Privacy/redaction | No arbitrary objects, error messages/stacks, names/emails, file paths, documents or credentials; pseudonymous IDs; export revalidation; shared sentinel corpus passes |
| Manual panel/Start/Stop | Exact entry shortcut opens without starting; one session; Start/Stop/selection/export/folder actions; visible degraded status |
| Indicator/Mark Moment | Persistent elapsed indicator; exact active-only marker shortcut; previous 64-event sequence reference; repeat/composition ignored |
| Runtime/restart | Runtime flags verified with real executable; hashed bounded correlation label; startup captured; clean exit and interrupted prefix recovery; live-session lock |
| Screenshots | Explicitly unsupported/deferred; no capture dependency or false consent control; metadata-only release |
| Storage/buffering/bounds | Managed diagnostics sessions/exports, 256 frontend events, 64-event batches, 16 native messages, 4 MiB stream, 32 sessions, no automatic evidence deletion |
| Failure isolation | Native queue/write/export/retention/corruption tests plus frontend failed-transport business-save test pass; bounded control wait; dropped events surfaced |
| Portable package | Fixed manifest/events/summary ZIP; CRCs plus event SHA-256; IDs/sequence validated; no databases or SDS files |
| Existing bundle relationship | CLI bundle is health snapshot; new session ZIP is reproduction timeline; neither embeds all sessions/screenshots automatically |
| Future runner | Session ID, timestamp, sequence, hashed caller label only; no remote control/listener/telemetry/upload |
| Tauri permissions | Seven narrow native commands: status/start/events/mark/stop/export/open_exports; existing opener reused; capability and Cargo dependency files unchanged |
| Focused/privacy/regression tests | Results and evidence listed above; no skipped test reported as PASS |
| Files changed | Native diagnostics/build/lifecycle; frontend diagnostics contract/client/panel plus existing boundary hooks/styles; runtime/browser and toolbox tests/validator/corpus; three docs. No Firebase, SQLite migration, workspace native authority, capability or dependency changes |
| Documentation | Extended DIAGNOSTIC_TOOLBOX.md; updated IMPLEMENTATION_STATUS.md and this milestone report |
| Authorization/business behavior | Existing auth, capabilities, lease checks, read/export enforcement and trusted publication untouched; diagnostics grants zero privileges |
| Cloud/frozen/user files | No deployment or real Firebase mutation; all frozen/archive SHAs unchanged; older canonical checkout preserved; personal setup SHA-256 remains BEA03E4ECB61044DD9B1A426B03E3B434A202C78AE1C950B560C332790EC7112 |
| Integration | Validated source integrated to main with normal fast-forward push; remote fetched and verified |
| Deliberate deferrals | Screenshots; external AI/UI runner; telemetry/automatic uploads; generic profiling; mobile diagnostics |
| DO NOT CLAIM YET | No newly authenticated native interaction through every instrumented workflow; browser UI uses synthetic transport; no screenshot proof; four existing live-security probes remain pending; no deployment |
| Recommended next step | Use this metadata-only Diagnostics panel for the next real native issue reproduction and export its session package; design any external runner as a separately authorized milestone |

Historical checkpoint notes follow; the completion state above supersedes earlier pending steps.

Base verified: origin/main `635cfd1e721835765d4417edc52332c705afc734`.
Branch: `work/in-app-diagnostics-mode-2026-09-27`.

The existing Node toolbox remains the read-only health snapshot (schema 1). The new native session writer will produce a separate reproduction timeline, with shared documented privacy/package conventions. There is no existing session writer, runtime diagnostics argument, capture provider, or diagnostic keyboard shortcut. Existing semantic boundaries are authoring service methods, workspace activation, backup, authentication, and publication. Existing console publication output is not suitable for wholesale collection. Native managed app-data and narrow commands are the established storage convention; capabilities currently grant only core:default.

Plan: bounded native writer and sanitized export/recovery; frontend control panel and exact hotkeys; semantic service instrumentation; selective WebView2-only capture investigation; privacy/failure/acceptance tests; full existing validation; review and integrate only when healthy. No cloud deployment or mutation. Frozen branches and the older canonical checkout remain untouched.

Recovered interruption: diagnostics.rs did not exist; the entire prior edit was unexecuted when approval review hit the usage limit. Contract and this note were the only saved files. Reconstructed the writer in smaller edits.

Native layer implemented: bounded background writer, session-scoped identity hashes, strict shared vocabulary, lifecycle, partial-tail interrupted recovery, fixed-member ZIP with hashes, managed folder reveal, runtime --diagnostics/--diagnostic-session and clean exit hook. Four native tests pass (privacy sentinel corpus, independent Python ZIP/CRC validation, lifecycle, restart, corruption, bounds and queue failures). 15,000 attempted events took 266 ms; event cap held at 4,194,250 bytes with 3,417 dropped. Native commands remain narrow; capabilities unchanged.

Frontend client/panel now wired, including exact hotkeys, manual start/stop, indicator, marker, export/folder reveal, authentication, access, workspace, authoring, SDS/Bulk, backup and publication observations. All 16 diagnostic tests, 12 browser UI tests, 15 Rust tests and Windows build pass. Browser acceptance uses production UI with synthetic transport; it is not a claim of authenticated native UI verification. Read-only ZIP validator added to the existing toolbox. A test-only Tauri runtime flag omission was fixed; no app defect was involved.

Final hardening: live-session lock prevents a second process marking another process interrupted; exact dropped-event accounting; failed-transport drop reporting; strict ZIP central-directory verification; unknown export IDs cannot create session directories; Member context included. Write/export/retention failures preserve business-file sentinel bytes. Native suite now 17 tests, all pass; diagnostics 16 and browser UI 12 pass. Native-produced ZIP also passed the read-only Node toolbox validator. No Tauri capability, Cargo dependency or cloud contract changes.

Initial executable runtime acceptance passed (without sign-in): `diag_fa92ae624712129fd6336fd3dabbc0a0` clean; `diag_ab2905b5844313349a8418f8700a452d` forced termination then interrupted recovery; ordinary restart inactive. Evidence: `diagnostics/output/diagnostics-runtime-result.json`. The final repeat is recorded above.

Initial broad `diagnostics:full` report `diagnostics/output/20260928T020500` passed all six validation groups. Native publication emulator proof also passed (`diagnostics/output/diagnostics-mode-native-publication.log`). Final repeat is recorded above.

Screenshot support explicitly unsupported; WebView2 CapturePreview needs COM callback/stream lifetime and bounded allocation work, so optional capture is deferred. No cloud deployment/mutation. Existing frozen/archive SHAs and personal Setup-HazComNavigator.ps1 hash match the prior checkpoint. The older canonical checkout was not changed.
