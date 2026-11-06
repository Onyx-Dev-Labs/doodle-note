# DoodleNote 0.5.1 release preparation

Status: merged, signed, notarized, uploaded, and the Blob feed activated. This change publishes the static web feed. Not yet installed or manually verified from the signed build; see Production acceptance.

## Scope

- **Only my voice** for Bark, off by default. A switch under Settings → Bark → Pill and microphone. Turning it on for the first time asks for a twenty-second reading; after that dictation silences speech that is not the recorded voice before it reaches the recognizer. Speech too short or too close to call is settled by loudness, and kept when nothing can tell. A model failure passes audio through and the pill says so.
- What is stored is a 256-number voice embedding and a speech level in `dictation-voiceprint.json` in the app's profile, readable only by the user. Audio is never written. The speaker models (about 13 MB) download on first use next to the speech models.
- Bark keyboard shortcut recorder from `alec-temp-0.5.1`: single keys, modifier-plus-key combinations, and standalone left/right modifiers including Right Option, with explicit Save and Cancel, conflict messages, and Input Monitoring handling.
- 1024px pine and white Bark logos in Settings and the pill.
- Dependencies: Electron 44.10.2, FluidAudio 0.18.2 in the Swift engine, Next.js 16.4.5, better-auth 1.7.18.
- Desktop version 0.5.1.

## Security review

A review of the branch before release found no high or medium issues. Four low findings in the new voice code were fixed: the voiceprint is validated on load in both the engine and the app, it is always written with owner-only permissions, a damaged embedding reads as "not this voice" rather than as a match, and the engine's dropped-event log prints field names only.

Left open for a maintainer decision, not changed here:

- A single ordinary key with no modifier can be saved as the global Bark shortcut.
- Electron fuses are at their defaults (`RunAsNode` is needed by the bundled MCP server). Hardening the others is proposed for a later release.

## Signing

The production signing identity remains **SEAN INMAN (VTZW6K32K4)**; the macOS updater requires signing continuity. The candidate was built by **Mac release candidate** on `main` and promoted without rebuilding, following [RELEASING](../RELEASING.md) and the [receipt-bound publisher](mac-publisher.md).

## Retained Mac candidate

- PR #272 merged to `main` as `b6400d0bc6af247a371f9423df1afed3c6ed8b3e`.
- The first [signing run](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/42289363932) signed and notarized the app and DMG, then failed verification and retained no candidate. `stapler validate` on the app inside the mounted DMG lost its connection to Apple's ticket service (`NSURLErrorDomain -1005`) on all three attempts; the same check passed for the built app, the ZIP app, and the DMG. Nothing was published from that run.
- The second [signing run](https://github.com/Onyx-Dev-Labs/doodle-note/actions/runs/42301578955) succeeded at the same source. Artifact ID `13544903406`; GitHub archive digest `sha256:7c9e672fb2ae2a82e2723e44197b10e4db026a19873dc2390f78e84dae595f0d`.
- **Exact-artifact macOS 14 verification has not run.** `verify-existing` is refused on `main` and its macOS 14 runner image has retired. This gap is the same as 0.4.37, 0.4.38, and 0.5.0.

| Payload | SHA-256 |
| --- | --- |
| DoodleNote-0.5.1-arm64-mac.zip | `ab989e65a52f6d2dc0fe797c30710c09e26b436b071b87c2723826d6e38e8687` |
| DoodleNote-0.5.1-arm64.dmg | `7964c50eab625e107a5b837920fe074922098c7e3fe84c1ce5f79f6a2429b50b` |
| latest-mac.yml | `8a4f415bd455d3e6299c7615ea9fc855e750e59f796e23ac4b1a4c9c66d30ad4` |

Local checks on the downloaded candidate (macOS 26, arm64):

- Hashes match the receipt, and the receipt-bound publisher dry run passed.
- Deep/strict `codesign` passed for the ZIP app and the DMG app, Team ID `VTZW6K32K4`, identical CDHash; `spctl` accepted both apps and the DMG as Notarized Developer ID; `stapler validate` passed for all three.
- The ZIP app and the DMG app are identical.
- The packaged app reports 0.5.1, points at `https://www.doodlenote.ai/updates`, carries the microphone entitlement and usage text, and includes `engine/dictation-helper`, the speaker models' code in `engine/engine`, and the Only my voice settings.
- The verifier's runtime smoke, run against the ZIP app with an isolated home and no window, passed on Electron 44.10.2: the packaged llama addon and SQLite FTS5 load, and the search worker and MCP protocols. The bundle was byte-identical to a fresh extraction afterwards.

**Not performed on this candidate:** launching the signed app's window, Bark dictation, recording a voice, Only my voice with two people, the Microphone, Accessibility, and Input Monitoring prompts, a recording with note generation, and a hands-on test of an existing library. The release owner chose to publish and test Check for updates from 0.5.0 afterwards, as with 0.5.0.

## Validation

Run on the release branch head before the pull request:

- Frozen-lockfile installation passed.
- Desktop typecheck and suite: 997 tests, 995 passed, 2 skipped, 0 failures.
- MCP (12), notes engine (76), and database (35) tests passed.
- Web typecheck, 180 web tests, authentication smoke, and production build passed.
- Workspace lint and full dependency audit passed (no known vulnerabilities).
- Swift release engine built; 72 native helper tests and the voice gate tests passed.
- Not run locally: the pinned Whisper build, because CMake is not installed on the machine used. Nothing in this change touches it, and the candidate workflow builds it.
- On recordings of synthetic voices, a mixed two-voice recording transcribed only the enrolled voice, and transcripts, timings, and voice distances were identical between FluidAudio 0.15.6 and 0.18.2.

## Manual test notes

Sean installed ad-hoc signed Dev builds of this branch on his daily Mac and reported the testing looked good; one defect found there (Settings slow to show a recorded or removed voice) is fixed in this branch. Alec tested the shortcut recorder and logos on his own Dev build before the merge. Dev builds are not signing evidence. On the signed candidate, check:

- Only my voice with two people at one desk: the enrolled person's words appear, the other person's do not. `voice filter` lines in `~/Library/Logs/DoodleNote/dictation.log` record what was kept and dropped, for tuning.
- Permissions on the signed app: Microphone for recording a voice, Accessibility for text insertion, Input Monitoring for standalone modifier shortcuts.
- An existing 0.5.0 install discovers, downloads, restarts into, and reports 0.5.1 with its library, Bark settings, and shortcut intact.

Only my voice was measured against synthetic voices during development. It has not been tuned on a wide range of real voices or microphones; the accept and reject thresholds may need adjusting from real logs.

## Publication evidence

Payload upload completed for both files, then the publisher's immediate public
check of the DMG's raw Blob URL returned 404 before the object was readable; the
feeds were unchanged. A deliberate rerun verified both existing payloads by hash
and size at the raw Blob URL and at `https://www.doodlenote.ai/updates/<file>`.

The first activation wrote the Blob feed, then failed read-back with
`Payload hash/size conflict: latest-mac.yml` before staging a static proposal, as
with 0.4.37, 0.4.38, and 0.5.0. A direct Blob `head` returned the 510-byte feed
uploaded at 2026-11-06T22:32:02Z, ETag `"79a5df192fa2b96e58c61788c5034322"`, while
the public copy still served cached 0.5.0 within its 60-second TTL. Once the public
copy matched the candidate manifest, activation was deliberately retried and
completed with `activated: true`. This PR copies that exact verified proposal to
the static web feed; its SHA-256 matches the receipt above.

The prior Blob and static feed SHA-256 is
`db66bd7bbdf7f10bd6ef224ef782aba9e10a1991195856dc1d2e36abae5f482a` (0.5.0), prior
Blob ETag `"64a7b43bebda5c72a4beccb9fdf82049"`. Rollback records, both activation
directories, and the upload, activation, and local check logs are retained locally
under `~/.local/share/doodlenote-release-evidence/mac-0.5.1/`. Rollback cannot undo
already-installed updates.

## Windows

This release does not change any Windows feed.

## Production acceptance still required

After merge and deployment, verify the deployed manifest and both payload hashes,
then confirm a 0.5.0 Mac offers, installs, and relaunches into 0.5.1 with its
library, Bark settings, and shortcut preserved. Then run the manual test notes
above on the installed build, in particular Only my voice with two people and the
Microphone, Accessibility, and Input Monitoring prompts.

