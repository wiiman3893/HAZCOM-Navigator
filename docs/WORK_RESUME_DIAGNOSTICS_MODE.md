# In-application Diagnostics Mode — work in progress

Base verified: origin/main `635cfd1e721835765d4417edc52332c705afc734`.
Branch: `work/in-app-diagnostics-mode-2026-09-27`.

The existing Node toolbox remains the read-only health snapshot (schema 1). The new native session writer will produce a separate reproduction timeline, with shared documented privacy/package conventions. There is no existing session writer, runtime diagnostics argument, capture provider, or diagnostic keyboard shortcut. Existing semantic boundaries are authoring service methods, workspace activation, backup, authentication, and publication. Existing console publication output is not suitable for wholesale collection. Native managed app-data and narrow commands are the established storage convention; capabilities currently grant only core:default.

Plan: bounded native writer and sanitized export/recovery; frontend control panel and exact hotkeys; semantic service instrumentation; selective WebView2-only capture investigation; privacy/failure/acceptance tests; full existing validation; review and integrate only when healthy. No cloud deployment or mutation. Frozen branches and the older canonical checkout remain untouched.

Recovered interruption: diagnostics.rs did not exist; the entire prior edit was unexecuted when approval review hit the usage limit. Contract and this note were the only saved files. Reconstructed the writer in smaller edits.

Native layer implemented: bounded background writer, session-scoped identity hashes, strict shared vocabulary, lifecycle, partial-tail interrupted recovery, fixed-member ZIP with hashes, managed folder reveal, runtime --diagnostics/--diagnostic-session and clean exit hook. Four native tests pass (privacy sentinel corpus, independent Python ZIP/CRC validation, lifecycle, restart, corruption, bounds and queue failures). 15,000 attempted events took 266 ms; event cap held at 4,194,250 bytes with 3,417 dropped. Native commands remain narrow; capabilities unchanged.

Frontend client/panel now wired, including exact hotkeys, manual start/stop, indicator, marker, export/folder reveal, authentication, access, workspace, authoring, SDS/Bulk, backup and publication observations. All 16 diagnostic tests, 12 browser UI tests, 15 Rust tests and Windows build pass. Browser acceptance uses production UI with synthetic transport; it is not a claim of authenticated native UI verification. Read-only ZIP validator added to the existing toolbox. A test-only Tauri runtime flag omission was fixed; no app defect was involved.

Next: native runtime launch/exit evidence, final hardening/review, full regression (running diagnostics:full in diagnostics/output/diagnostics-mode-full.log), documentation and main integration. Screenshot support explicitly unsupported; WebView2 CapturePreview is viable but requires COM callback/stream lifetime and bounded allocation work, so optional capture is deferred rather than blocking metadata-only diagnostics. No cloud deployment/mutation.
