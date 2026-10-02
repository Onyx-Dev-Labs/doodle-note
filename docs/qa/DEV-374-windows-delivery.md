# DEV-374 Windows delivery candidate

This is an unpublished Windows x64 test candidate, proposed as **0.4.33 beta**.
It is not an approved release. An unsigned artifact must be described as an
unsigned test candidate. Do not publish or change updater feeds from this PR.

## Source and scope

- Main baseline: `596837bec001ab39ddcb065e622e5adea89cf498` (Mac v0.4.32).
- PR #200 is a dependency, still open at preparation time. Its commits are
  `64a126e817e095f8e8c84ce03e370139bb83ba74` and
  `ae80c570f70706cddc41d9bbd571453c41ad1abd`.
- Branch: `codex/DEV-374-windows-delivery`, based on that dependency's head.
  No PR is merged by preparing this candidate. Retarget to main after the
  dependency is independently reviewed and merged, then rerun final checks.
- Applicable shared features already exist: TXT import, docked/resizable notes
  and transcript, hidden-panel continuity, multipart recovery, import job
  progress/cancellation/retry. Test before adding product changes.
- Mac library relocation and native Whisper remain Mac-only. Windows storage,
  capture drain, Sherpa final transcription and privacy behavior are preserved.

## Evidence requirements

Record the final Git SHA, constituent commits, Node/pnpm versions, Windows build,
profile isolation, installer/blockmap/manifest SHA-256, manifest SHA-512 match,
packaged archive SHA-256, and Authenticode state in the candidate QA receipt.
Version alone never identifies the source. Keep synthetic and physical results
separate. Do not commit private audio, profiles, credentials, or customer content.

Run the shared commands in `docs/RELEASING.md`, desktop build, production audit,
CI and CodeQL. Package on Windows with `package:win` and publishing disabled.
Run `test-electron-runtime.cjs` against the resulting executable, the packaged
Sherpa/llama smoke from CI, and the single-instance regression. Verify the final
candidate again after any source change. Platform skips and failures stay visible.

Native Windows QA must cover:

- Plain TXT and standalone `[Speaker N]` labels: preview/cancel, empty/invalid
  input, import/reopen; no audio or inferred timestamps. Other labels are literal
  text, not a promise of speaker detection.
- Hidden transcript capture, Stop/Resume, ending text/audio, multipart recovery,
  duplicate IDs, Copy/export and playback.
- Both panes usable, actual pointer and keyboard resize, relaunch persistence.
- WAV/MP3/M4A/MP4 progress, cancellation, retry and neutral imported attribution.
  Source attribution is not diarization of people sharing a microphone.
- Mic/system capture, local model setup/reuse, refinement success/fallback,
  saved audio and local notes. Reconcile DEV-256's partial evidence; do not close
  its accuracy, independent-source or real-meeting gates by association.
- Clean install and 0.4.23-beta upgrade in a disposable Windows account/VM.
  Snapshot synthetic notes, recordings, attachments, settings, models and account
  fixtures with counts/hashes. Real authenticated-account retention is a separate
  authorized manual gate. Never downgrade the normal profile for a test.

The NSIS installer can stop/uninstall the existing application even when given a
different installation directory. Extracted-payload tests do not prove NSIS or
the updater lifecycle. Use a disposable OS/account boundary for those tests.

## Intended release and rollback proposal

Read-only channel check on October 2, 2026: `/download/win` resolves to
`DoodleNote-0.4.23-beta-setup.exe`; `beta.yml` and `latest-beta.yml` report 0.4.23;
production `latest.yml` reports 0.3.4. Windows update policy selects `beta` and
disables downgrades. Recheck these values immediately before approved rollout.

Propose 0.4.33 on the existing beta channel, after review, DEV-256 quality gates,
isolated installation/upgrade verification and explicit release approval. Keep
production `latest.yml` and all Mac artifacts/feeds unchanged. Production requires
valid Authenticode through the existing signature gate. Google-enabled official
packages additionally require the credential and account checks in RELEASING.md;
credential-free CI packaging is not evidence of those checks.

Prepare beta manifests locally with `buildWindowsBetaManifests`; verify both
reference the versioned beta installer and its measured size/SHA-512. Do not run
`publish:win-beta` or `release:win` without separate publication authorization.
The publisher uses stream uploads; a previous Mac retry failure is not proven
repaired by packaging or by a local multipart helper. Qualify retry semantics
without paid resources or production mutations before approved upload.

After approval: publish immutable qualified artifacts, then intended beta
manifests; read back and hash downloads; update an existing 0.4.23 beta client via
its real Check/download/Restart path; verify source identity, preserved data and
native smoke. Only then assess Done/Live. Keep the preceding qualified artifacts
and a private profile backup. Rollback requires explicit approval and normally a
higher-version corrected build; never overwrite newer user data or silently
switch channels. A stale lower-version feed is not a reliable installed rollback.
