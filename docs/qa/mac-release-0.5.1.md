# DoodleNote 0.5.1 release preparation

Status: prepared for review; not merged, signed, notarized, or published.

## Scope

- **Only my voice** for Bark, off by default. A switch under Settings → Bark → Pill and microphone. Turning it on for the first time asks for a twenty-second reading; after that dictation silences speech that is not the recorded voice before it reaches the recognizer. Speech too short or too close to call is settled by loudness, and kept when nothing can tell. A model failure passes audio through and the pill says so.
- What is stored is a 256-number voice embedding and a speech level in `dictation-voiceprint.json` in the app's profile, readable only by the user. Audio is never written. The speaker models (about 13 MB) download on first use next to the speech models.
- Bark keyboard shortcut recorder from `alec-temp-0.5.1`: single keys, modifier-plus-key combinations, and standalone left/right modifiers including Right Option, with explicit Save and Cancel, conflict messages, and Input Monitoring handling.
- 1024px pine and white Bark logos in Settings and the pill.
- Dependencies: Electron 44.10.2, FluidAudio 0.18.2 in the Swift engine, Next.js 16.4.5, better-auth 1.7.18.
- Desktop version 0.5.1. Website changelog remains explicitly Unreleased until publication.

## Security review

A review of the branch before release found no high or medium issues. Four low findings in the new voice code were fixed: the voiceprint is validated on load in both the engine and the app, it is always written with owner-only permissions, a damaged embedding reads as "not this voice" rather than as a match, and the engine's dropped-event log prints field names only.

Left open for a maintainer decision, not changed here:

- A single ordinary key with no modifier can be saved as the global Bark shortcut.
- Electron fuses are at their defaults (`RunAsNode` is needed by the bundled MCP server). Hardening the others is proposed for a later release.

## Signing

The production signing identity remains **SEAN INMAN (VTZW6K32K4)**; the macOS updater requires signing continuity. After merge, dispatch **Mac release candidate** on `main` and retain the exact signed, notarized, verified artifacts and receipt. Follow [RELEASING](../RELEASING.md) and the [receipt-bound publisher](mac-publisher.md); do not rebuild during promotion.

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
