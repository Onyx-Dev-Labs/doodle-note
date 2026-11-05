# Mac release 0.4.38

Public release label, desktop package, app About version, artifact filenames and
updater manifest are all **0.4.38**. Bark and Settings preparation is recorded in
`docs/qa/bark-dictation-0.4.38.md`.

## Merged source

- Bark dictation and the Settings redesign ([PR263](https://github.com/Onyx-Dev-Labs/doodle-note/pull/263)),
  the note page redesign with the Fetches tab ([PR259](https://github.com/Onyx-Dev-Labs/doodle-note/pull/259)),
  the fetch context wording fix ([PR258](https://github.com/Onyx-Dev-Labs/doodle-note/pull/258)) and
  new Google Calendar connections ([PR265](https://github.com/Onyx-Dev-Labs/doodle-note/pull/265)).
- Candidate source is `main` at `5da1753ddfe5b97175787d5ab4c67f4e8df04da5`.
- An earlier signed candidate at `5dcf9b6` (run `41903529857`) predates PR265 and
  still gated Google connections. It was never uploaded and is superseded.

## Google Calendar

Google approved `https://www.googleapis.com/auth/calendar.readonly` for project
`doodle-note`. The Verification Center shows branding and data access as verified,
publishing status In production, with Desktop and Web OAuth clients. PR265 removes
the app's pending-verification gate from Settings and the first-run tour.

## Retained Mac candidate

- [Signing run](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/42073109135)
  succeeded at source `5da1753ddfe5b97175787d5ab4c67f4e8df04da5`.
- Artifact ID `13437683222`; GitHub archive digest
  `sha256:53325ad82772cae7e870c8bc91690d4283986b7141222646bcc5ce4e08fc8955`.
- **Exact-artifact macOS 14 verification has not run.** `verify-existing` is
  refused on `main` and its macOS 14 runner image was due to retire on
  November 2, 2026. This gap is the same as 0.4.37.

| Payload | SHA-256 |
| --- | --- |
| DoodleNote-0.4.38-arm64-mac.zip | `553a49111419312b2986ef93fc0402f0be79b56213ae37e22f88e3bb2fd54650` |
| DoodleNote-0.4.38-arm64.dmg | `c38ef61dbfac0a74fe8f678886e3d819ca70cddf5d3208bf9573615c06980bf2` |
| latest-mac.yml | `1916f1c0134e33d8fa33ec2bda9e6d8ec6d491f40ebd2447be3ce17e75ddda32` |

Local checks on the downloaded candidate (macOS 26, arm64): hashes match the
receipt; deep/strict `codesign` passed, Team ID `VTZW6K32K4`; `spctl` accepted
the app and DMG as Notarized Developer ID; `stapler validate` passed. The
receipt-bound publisher dry run passed. The packaged app contains no
pending-verification gate text and includes `engine/dictation-helper`.

## Installed candidate checks

Installed from the exact DMG on macOS 26:

- A profile previously connected by a demo build kept its Google connection and
  cached event after upgrading to this candidate.
- On a fresh profile, the first-run tour's **Connect Google** opened Google's
  consent screen. Consent with a test account returned "Calendar connected", and the
  test event appeared in Coming up. Settings showed **Add Google account** enabled.
- After quit and relaunch, the connection and event remained.
- 63 minutes after consent, with the access token expired, Sync reported
  "Connected, synced just now" with no error, so token refresh works.
- With the 0.4.37 feed live, the updater reported up to date without offering a
  downgrade.

**Not performed on this candidate:** Bark dictation, a recording with note
generation, Microsoft and Google connected together (the `RELEASING.md` isolation
check), and the owner's hands-on test of an existing library. The release owner
chose to publish without the hands-on test.

## Publication evidence

Payload upload first exceeded the publisher's five-minute per-upload deadline on
the DMG, after the ZIP had uploaded, leaving the feeds unchanged. A deliberate
rerun verified the existing ZIP by hash and size and uploaded the DMG.

The first activation wrote the Blob feed, then failed read-back with
`Payload hash/size conflict: latest-mac.yml` before staging a static proposal, as
with 0.4.37. Independent inspection returned the exact 510-byte 0.4.38 candidate
feed from Blob, ETag `"b2677fbcfcd6281a89270160ade903e5"`, while the website still
served 0.4.37. Activation was deliberately retried and completed with
`activated: true`. This PR copies that exact verified proposal to the static web
feed; its SHA-256 matches the receipt above.

The prior Blob/static feed SHA-256 is
`ec9c26b9bf2fa790ac8c945d96b835061b5e37edfff7b64317e6725b08fa17cb` (0.4.37),
prior Blob ETag `"8d0acca123fc89b6a967f1369839720c"`. Rollback records and logs
are retained locally under `~/.local/share/doodlenote-release-evidence/mac-0.4.38/`.
Rollback cannot undo already-installed updates.

## Windows

This PR does not change any Windows feed.

## Production acceptance still required

After merge and deployment, verify the deployed manifest and both payload hashes,
then confirm a 0.4.37 Mac offers, installs and relaunches into 0.4.38 with its
library preserved.
