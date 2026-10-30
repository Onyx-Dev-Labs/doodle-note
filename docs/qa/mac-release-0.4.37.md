# Mac release 0.4.37

Public release label, desktop package, app About version, artifact filenames and
updater manifest are all **0.4.37**. Source preparation is recorded in
`docs/qa/app-redesign-0.4.37.md`.

## Merged source

- [PR254](https://github.com/Onyx-Dev-Labs/doodle-note/pull/254) merged as
  `314ac2064e57db471d11e83ea8cc8475ddc53942`. Its tree is identical to the
  candidate source `f4df16bea4744599b38a4b6fb0bef773e8534530`.
- Relative to the 0.4.35.1 candidate source `a1d1f83`, shipped desktop changes
  are renderer UI (`App.tsx`, `HomeView.tsx`, `main.tsx`, redesign CSS), bundled
  fonts and their OFL licenses, the version bump, and one publisher test fixture.
  No dependency, lockfile, native, engine, main-process or preload changes.

## Retained Mac candidate

- [Signing run](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/41112670975)
  succeeded at source `f4df16bea4744599b38a4b6fb0bef773e8534530`.
- Artifact ID `13004219041`; GitHub archive SHA-256
  `86516ac3d7bd4c303092062182db1e37bbdddf252fc04758cc5cd0071cf43386`.
- **Exact-artifact macOS 14 verification has not passed.** Runs
  `41114643425`, `41120432083` and `41121235049` were cancelled before a runner
  was assigned: "scheduled macOS 14 runner image brownout. macOS 14 runner
  images will be retired on November 2, 2026."

| Payload | SHA-256 |
| --- | --- |
| DoodleNote-0.4.37-arm64-mac.zip | `df780b5a89f72474120642d426fd5dd5a0345c3655c0d49f46442dbde448ae76` |
| DoodleNote-0.4.37-arm64.dmg | `5e6184ee1da0284b9a96b00eb29ec13ac7990c5d47c18c694abe895bb1ab5ea7` |
| latest-mac.yml | `ec9c26b9bf2fa790ac8c945d96b835061b5e37edfff7b64317e6725b08fa17cb` |

Local checks on the downloaded candidate (macOS 26, arm64): deep/strict
`codesign` passed, Team ID `VTZW6K32K4`; `spctl` accepted the app and DMG as
Notarized Developer ID; `stapler validate` passed for both. Local
receipt-bound publisher dry run passed with no network or feed changes. The
exact ZIP app launched with an isolated `--user-data-dir` profile, rendered its
setup wizard, reported 0.4.37 and read the then-current 0.4.36 feed without
offering a downgrade. It quit normally and passed deep/strict code-signature
verification afterward. This establishes launch only, not recording,
inference, or installed-updater acceptance.

## Publication evidence

The payloads were first uploaded at 19:32–19:33 UTC. The receipt-bound
publisher reused them after verifying complete sizes and SHA-256 hashes through
the raw Blob URLs and the installed client routes on `www.doodlenote.ai`.

The first activation wrote the Blob feed but failed read-back with `Payload
hash/size conflict: latest-mac.yml`, before creating a static proposal.
Independent inspection then returned the exact 510-byte 0.4.37 candidate feed
from Blob, ETag `"8d0acca123fc89b6a967f1369839720c"`, while the website still
served the 0.4.36 feed. Activation was deliberately retried and completed with
`activated: true`. This PR copies that exact verified proposal to the static web
feed; its SHA-256 matches the receipt above.

The prior Blob/static feed SHA-256 is
`1748f6919592f278ab12829de4f15ea0d46b8756c0912912bb9b020e236b4856`, prior Blob ETag
`"5b94abba839761d6bcdfa80583efe6f8"`. Rollback evidence, receipts and the launch
log are retained locally under
`~/.local/share/doodlenote-release-evidence/mac-0.4.37/`. Rollback requires
reading the current ETag and coordinating both feed surfaces; it cannot undo
already-installed updates.

## Windows

`DoodleNote-0.4.37-beta-setup.exe` was published to the beta channel
(`beta.yml`, `latest-beta.yml`) separately and is unsigned (no Authenticode
security directory). The production `latest.yml` remains 0.3.4. This PR does
not change any Windows feed.

## Production acceptance still required

After merge and deployment, verify the deployed manifest and both payload
hashes, email-gated download, clean install, prior-version update/relaunch,
preserved library, recording, transcription, notes generation and local MCP
client flow.
