# Windows first-run fixes — October 24, 2026

Based on upstream main `06ce16f189c421370993ac511289f28ef96ef5fc`.

- The system-browser relay attempts Google account selection immediately. Browsers that block automatic popups show an explicit Continue with Google retry. Credentials remain in memory and are sent only to the existing nonce-protected loopback POST endpoint.
- Demo account type is selectable before Company creation and from the active workspace sidebar. It calls the existing `switchDemoType` backend; paid subscriptions cannot be activated by this selector. Company Demo switching uses the selected Company. The backend must include the existing callable from current main.
- Untouched record forms, including date and relationship defaults, close on navigation or workspace/account switching. User input retains the existing save/cancel guard and close-window warning.
- SDS Batch Import is now in the main management navigation. Management Home also offers Import SDS PDF. One SDS or a scanned stack uses the existing review workflow and Windows OCR; attaching/replacing a PDF for an existing Product remains in its details.

## Validation

- Core, authoring, sync, and Windows TypeScript compilation passed.
- Windows Vite production build passed (existing large-chunk warning).
- 27 authoring, SDS import/OCR, and browser relay tests passed, including popup-blocked retry and invalid nonce rejection.
- Added Playwright regressions for untouched forms, import discovery, and Demo selection before/after Company creation. Five selected browser tests could not execute: sandboxed Edge exited during launch, and loopback connections are denied in this environment. No browser interaction or native Google login acceptance is claimed.
- Native Windows packaging and a real Google sign-in were not rerun. Retest with the latest source on the desktop, using a disposable Company.
