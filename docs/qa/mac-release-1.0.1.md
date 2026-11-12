# DoodleNote 1.0.1 release preparation

Status: prepared for review. No signed 1.0.1 candidate or public feed has been published.

## Scope

- Plain Bark dictation resolves the currently selected field at delivery. Selection rewrites and Undo keep their original target guards. Current password fields remain protected and uncertain insertions are never retried automatically.
- Focus resolution checks both system and application accessibility focus, follows explicit focused descendants, and briefly waits for a cold web accessibility tree. Global secure keyboard input has its own recovery message.
- Compact message cards have a ten-second countdown paused by hover or an outstanding copy. Successful Copy shows a centered checkmark and Copied for 450 ms, then fades for 120 ms. Failed copies remain retryable. Hover and press feedback respect reduced motion.
- Resting and active waveform pills follow the pointer's monitor every 150 ms. Message cards stay on their opening monitor so their controls stay reachable.
- Local Dev packaging reuses its previous Apple Development signer to preserve macOS permission grants. Production signing configuration is unchanged.
- Integrated onto current main without removing Only My Voice, shortcut customization, or 1.0.0 security hardening. The website changelog stays Unreleased until publication.

## Verification

- Frozen-lockfile installation passed.
- Desktop typechecks and suite: 1,012 passed, 8 skipped, zero failures.
- Native Swift suite: 95 passed, zero failures.
- Web typecheck and workspace lint passed.
- Electron popup QA confirmed compact layout, countdown hover pause, copy feedback, and successful-copy dismissal while hovered. Monitor transitions were checked in controller tests with two simulated displays, in both directions and on all three dock edges.
- The local Dev app was tested interactively during development, and its microphone, Accessibility, and Input Monitoring grants survived signed rebuilds. This is not a test of a production-signed 1.0.1 installer.
- An intermittent unconfirmed paste was observed during development but could not be reproduced. No additional speculative insertion retry was introduced.

![Synthetic copied popup](assets/bark-1.0.1-popup.png)

## Remaining release gates

The final PR head needs the repository's required independent code-owner approval and checks. After merge, build and verify the exact signed/notarized Mac release candidate through the existing workflow. Retain its immutable artifact and receipt, run native release smoke and upgrade checks, then promote those exact bytes through the receipt-bound publisher. Publish the release date, GitHub release, and updater feed only for that verified candidate. See [RELEASING](../RELEASING.md).
