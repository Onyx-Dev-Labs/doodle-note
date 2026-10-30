# Mac security update 0.4.35.1

Public release label: **0.4.35.1**. Desktop package, app About version, artifact
filenames and updater manifest: **0.4.36**. This mapping was explicitly approved
by the release owner. Existing electron-updater clients reject four-component
versions; the updater must continue receiving the valid, increasing 0.4.36.

## Merged source and production web

- [PR250](https://github.com/Onyx-Dev-Labs/doodle-note/pull/250) approved by
  `alectribble` at `fe1d6492f096ea8fcb624b3d3f4022fbcde1a6a0` and merged as
  `3c08e2c809b8294b85f9236af84ae6cba6b6f578`.
- [CI](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/41086172700),
  CodeQL and Vercel all passed. The production web deployment is
  `dpl_DzJaE4HjBTMioCUsEYmfCMR7uB6D` at the merge commit.
- Post-merge authenticated Dependabot inventory: **0 open alerts; all 36
  baseline alerts fixed**. The production changelog initially labels the
  security update pending; publication remains a separate state.

## Retained Mac candidate

- [Signing run](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/41085161139)
  succeeded at source `a1d1f8369e599ec1c8ddcaa0ccd728bf5a1fe183`, an ancestor of
  the reviewed merge. Subsequent changes only affect a test fixture, changelog
  and QA documentation; shipped desktop source/dependencies are identical.
- Artifact ID `12992356884`; GitHub archive SHA-256
  `118036255550a56ccaffd3eb671a2381c149aafd8cc61bd133860e8547b52d85`.
- [Exact-artifact macOS 14 verification](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/41093087610)
  passed on macOS 14.8.9 arm64 using harness `fe1d649`. It validates receipt,
  signatures, stapled tickets, Gatekeeper, manifest, ZIP/DMG equality, native
  audio import/merge, SQLite/llama addon loading, emitted worker and MCP stdio
  behavior, and unchanged original data. It does not perform GUI/capture,
  permission, VoiceOver, model-inference or installed-updater acceptance tests.

| Payload | SHA-256 |
| --- | --- |
| DoodleNote-0.4.36-arm64-mac.zip | `d94ca2adf5a0357cd251152b599617fc9969c329d15f26e46c41a2025e1df74f` |
| DoodleNote-0.4.36-arm64.dmg | `7cf23869c562cf06b557ad3885ed324b676dae2e23cabe5141a15e601136df14` |
| latest-mac.yml | `1748f6919592f278ab12829de4f15ea0d46b8756c0912912bb9b020e236b4856` |

Publish these exact retained bytes with the receipt source SHA above. Do not
rebuild or rename files to the public label. Update the website release date
and feed only as part of verified publication.

Local receipt-bound publisher dry run passed with the downloaded files and
reported no network or feed changes. The exact ZIP app opened its setup wizard,
home and Settings GUI with an isolated `--user-data-dir` profile. Settings
reported 0.4.36 and the isolated library path. The app quit normally and its
deep/strict code-signature verification passed afterward. This establishes GUI
launch/navigation, not recording, inference or installed-updater acceptance.

## Windows readiness

The approved CI built `DoodleNote-0.4.36-setup.exe`, its blockmap and `latest.yml`.
Artifact ID `12992036778` is named
`doodlenote-windows-6897dc393e132287d49ff9e1d694fef69ff7837e` because pull-request
CI checks out GitHub's synthetic merge ref. Its archive SHA-256 is
`1b97709d62ceaea614890e18d79012ce1c00604af37e2f556cb11a3cd2749043`.
Packaged recorder, single-instance launch and native-module checks passed.
Authenticode is **NotSigned**. No Windows feed or installer is published by
this rollout; official publication requires the approved certificate, a freshly
signed build and signature verification.

## Production acceptance still required

After Mac publication, verify the deployed manifest and both payload hashes,
email-gated download, clean install, prior-version update/relaunch, preserved
library, recording, transcription, notes generation and local MCP client flow.
Keep explicit evidence of which checks used the signed artifact. Automated
artifact validation is not a claim that these manual production checks passed.
