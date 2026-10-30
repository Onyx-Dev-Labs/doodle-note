# System-wide dictation: DoodleNote Dev build

Development-only. Dictation is compiled in only when the app is built with `DOODLENOTE_CHANNEL=dev`; production builds report it as "not part of this release" and never start the engine, shortcut or helper for it.

## What it does

Press a shortcut in any macOS app, speak, and the recognized text is typed into the field you were using.

- **Recognition is always local** (the existing FluidAudio engine, microphone only). No audio is retained, no meeting is created, nothing is synced.
- **Triggers:** a configurable global toggle (default `Control+Alt+D`) and optional hold-to-talk on a lone modifier (Right Option / Right Control / Right Command / Fn). `Esc` cancels while a session is live and is held only for that time.
- **Overlay:** a non-activating panel shows state, the live partial text, a level meter, and Stop / Cancel. Partials stay in the overlay; the final text is inserted once.
- **Delivery:** a native helper snapshots the focused app and control at start, re-validates immediately before inserting, and inserts through Accessibility, falling back to a clipboard paste that preserves every pasteboard representation and never overwrites a clipboard change you made meanwhile. It never presses Return.
- **Recovery:** if focus moved, the field is secure or unsupported, Accessibility is off, or the insertion cannot be confirmed, the text is kept (overlay + Settings → Dictation) for you to copy. It is never retried blindly and the old app is never re-activated.
- **Cleanup (optional, separate from recognition):** Raw (default), Local cleanup (the installed notes model) or Your provider (BYOK, text only, after explicit consent bound to that provider+model). Busy, failing, timed-out or doubtful cleanup falls back to the raw text and says so.

## Isolation from the production app

| Concern | Dev build |
|---|---|
| Identity | `com.doodlenote.desktop.dev`, "DoodleNote Dev" (separate TCC permissions, Keychain item, login item) |
| Profile / library | `~/Library/Application Support/DoodleNote Dev`, chosen at build time. `DOODLE_USER_DATA` is ignored, as it cannot isolate a packaged app |
| Logs | `~/Library/Logs/DoodleNote Dev` |
| Single-instance lock | Lives in the dev profile; coexists with production and with legacy `desktop` dev runs |
| Updates | None: no feed, no `app-update.yml`, `supported:false` |
| Legacy adoption | `migrateDevUserData()` is disabled; nothing is copied from `DoodleNote` or `desktop` |
| Sync | Defaults to an unroutable local address (set `DOODLE_SYNC_URL` deliberately to test sync) |
| Agent access / MCP | Writes into a sandbox home inside the dev profile, never `~/.doodlenote` or other apps' configs |
| Models | Read-only discovery across existing model folders (unchanged); downloads go only to the dev profile. The FluidAudio speech cache (`~/Library/Application Support/FluidAudio`) is shared and managed by FluidAudio |
| Publishing | `package-dev.sh` never calls the release scripts, never notarizes, refuses a Developer ID certificate |

## Build, install, run

```sh
cd apps/desktop
pnpm package:dev          # swift build + app build + ad-hoc sign + isolation checks
pnpm verify:dev-app       # re-run the isolation checks on the built app
open "release-dev/mac-arm64/DoodleNote Dev.app"
```

Output: `apps/desktop/release-dev/mac-arm64/DoodleNote Dev.app` (git-ignored). Nothing is installed into `/Applications`; copy it there yourself if you want it. It will not replace the production app.

**Signing and Keychain.** The default is an ad-hoc signature, which needs no certificate. Because macOS ties permission grants and Keychain access to the code signature, **an ad-hoc rebuild resets Microphone/Accessibility grants and makes macOS ask once for Keychain access ("DoodleNote Dev Safe Storage")**. For grants that survive rebuilds, sign with a local development certificate:

```sh
DOODLENOTE_DEV_IDENTITY="Apple Development: Your Name (TEAMID)" pnpm package:dev
```

The first signing may ask for Keychain access to that key. The script refuses a Developer ID certificate.

For an unpackaged run from source: `pnpm dev:dictation` (also the dev lineage and profile). Whisper batch transcription is not bundled in the dev app (it needs a whisper.cpp build); Parakeet, the default, is.

## Permissions (you grant these once; the app never changes them)

1. **Microphone:** macOS asks on the first dictation.
2. **Accessibility:** System Settings → Privacy & Security → Accessibility → add DoodleNote Dev. Needed to see the focused field and type. Without it dictation still works and the text is kept for copying.
3. **Input Monitoring:** only for hold-to-talk.

Settings → Dictation shows each state and opens the right System Settings pane.

## Manual test runbook (needs a human at the Mac)

Use only synthetic phrases and scratch destinations. Do not send or submit anything.

1. Settings → Dictation → enable. Click the "Try it" scratch box, press `Control+Alt+D`, say "Testing one two three", press it again. The text appears once.
2. Repeat in TextEdit, a browser `<textarea>`, a `contenteditable` and the scratch box. Confirm the overlay never steals focus.
3. Silence: start, say nothing, stop: "No speech detected", nothing typed.
4. Esc and the Cancel button mid-dictation: nothing typed.
5. Start, switch to another app, stop: the overlay says you moved and keeps the text; Copy works.
6. Click into a password field and dictate: refused, text kept.
7. Turn Accessibility off and dictate: text kept, explained.
8. Hold-to-talk: choose Right Option, hold while speaking, release. A tap shorter than about a third of a second does nothing.
9. Unplug a USB microphone mid-dictation: a clear message, no insertion.
10. Start a meeting recording, then dictate: refused with an explanation, the meeting unaffected. Dictate, then start a meeting: refused.
11. With Wispr Flow running, pick shortcuts that do not overlap; Settings shows a warning.
12. Quit mid-dictation and relaunch: no stray microphone indicator, nothing inserted.
13. With a notes model installed: Local cleanup, then (with a key and explicit consent) Your provider. Dictate while notes are generating: cleanup is skipped and the raw text inserted.

## Verification performed on this Mac

Automated (all pass): 643 desktop tests (641 pass, 2 skipped), including new suites for the session state machine (25), capture ownership (5), service orchestration with stale events, cancellation, cleanup and recovery (23), helper client (5), cleanup validation (7), NotesService model ownership and consent (8), profile isolation (4) and packaging invariants (5); typecheck and lint clean.

Real components (not mocks), synthetic text only:
- **Native helper vs TextEdit** (AX and forced paste): delivered once and verified; every clipboard representation (text, HTML, custom blob) hash-identical afterward; snapshots are single-use; a focus change is refused. Found and fixed a stale `NSWorkspace` focus check during this testing.
- **Native helper vs Chrome** (separate throwaway profile): `<textarea>` and `contenteditable` delivered via paste fallback and verified; password input classified secure and refused. Found and fixed a first-use gap (Chromium's accessibility tree is built on request; the snapshot now waits briefly).
- **Real service + overlay window + helper + TextEdit** (only the speech engine scripted): the real global shortcut and a real Esc key press, overlay non-focusable and not taking focus, Stop/Cancel/Copy/Dismiss, late results ignored after cancel, focus change to recovery without re-activating the old app, meeting-busy refusal.
- **Hold-to-talk** with OS-level modifier events: paired down/up with matching ids, tap and chord ignored.
- **Packaged app:** distinct profile and preferences, no production directories created, legacy `desktop` profile and production preferences byte-identical before and after, no updater activity, no network sockets beyond the debug port, second launch rejected while another Electron dev app ran, shortcut registered and released, clean quit with no orphans.

Measured (single machine, no repeats, not a benchmark):

| Item | Result |
|---|---|
| Insertion, AX path (TextEdit) | 7–11 ms |
| Insertion, paste path (TextEdit) | 66–158 ms |
| Insertion, paste path (Chrome) | ~510 ms |
| Batch speech decode, 4.8 s phrase, models cached | 0.08–0.11 s (43–58x real time), whole process ~0.3 s |

The batch figure is **not** the live streaming path. The Settings panel and `dictation-metrics.jsonl` (numbers only, dev profile) record real start / stop-to-text / cleanup / insert timings once you dictate.

## Not verified, and known gaps

- **Live microphone dictation end to end** was not run: the microphone permission is undetermined for this session and a prompt is yours to answer. Live start latency, stop-to-text latency, streaming partials and accuracy are therefore unmeasured. One batch sample misheard "Priya" as "PRIA": raw mode inserts what the recognizer heard, and cleanup deliberately will not rewrite names.
- **Local and provider cleanup** were tested only with stubs. No local model is installed on this Mac and no provider key was used.
- **Wispr Flow** is not installed here, so shortcut overlap was not exercised (detection by process name is untested against the real app).
- **Electron-app target:** the scratch box inside the dev app itself was not driven by a real dictation; Chromium delivery was verified in Chrome.
- **Not tested:** microphone unplug, sleep/wake, a held key when the helper is killed on a real machine (covered by unit tests only), secure event input from a stuck app, Safari, Firefox, remote/virtual desktops, non-English input.
- **Engine:** `serve` still loads both the mic and system recognizers; a mic-only load would cut memory. The cold path (engine not yet warm) is unmeasured.
- **Not done by design:** no TipTap-specific insertion (the system-wide path covers the dev app's own editor), no history, no screen or surrounding-text capture, no cloud speech, no Windows adapter, no menu-bar item.
- Chromium and Electron targets are asked to expose their accessibility tree (`AXManualAccessibility`); that stays enabled in the target until it restarts.
