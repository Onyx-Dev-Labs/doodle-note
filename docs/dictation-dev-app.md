# System-wide dictation: DoodleNote Dev build

Development-only. Dictation is compiled in only when the app is built with `DOODLENOTE_CHANNEL=dev`; production builds report it as "not part of this release" and never start the engine, shortcut or helper for it.

## What it does

Press a shortcut in any macOS app, speak, and the recognized text is typed into the field you were using.

- **Recognition is always local** (the existing FluidAudio engine, microphone only). No audio is retained, no meeting is created, nothing is synced.
- **Triggers:** a configurable global toggle (default `Control+Alt+D`), optional hold-to-talk on a lone modifier (Right Option / Right Control / Right Command / Fn), a double tap of that same key (hands-free), and a click on the pill. `Esc` cancels while a session is live and is held only for that time.
- **The pill:** a small paper-toned doodle pill that stays at a screen edge while dictation is on, and grows into the live pill (Cancel, a squiggle that follows your voice, Finish) during a session. See "The pill" below. Partial text stays in the overlay; the final text is inserted once.
- **Delivery:** a native helper snapshots the focused app and control at start, re-validates immediately before inserting, and inserts through Accessibility, falling back to a clipboard paste that preserves every pasteboard representation and never overwrites a clipboard change you made meanwhile. It never presses Return.
- **Recovery:** if focus moved, the field is secure or unsupported, Accessibility is off, or the insertion cannot be confirmed, the text is kept (overlay + Settings → Dictation) for you to copy. It is never retried blindly and the old app is never re-activated.
- **Cleanup (optional, separate from recognition):** Raw (default), Local cleanup (the installed notes model) or Your provider (BYOK, text only, after explicit consent bound to that provider+model). Busy, failing, timed-out or doubtful cleanup falls back to the raw text and says so.

## The pill

The look is DoodleNote's own: a paper-toned pill with an offset ink outline, a hand-drawn squiggle that rises with the microphone level, and hand-drawn Cancel and Finish marks. It follows the system light or dark appearance and honours "reduce motion" (the squiggle stops drifting and only changes height).

| Behaviour | How it works |
|---|---|
| Always visible | Setting "Show the pill at all times" (default on). The overlay window is cut to the pill's own size (about 92x40), so clicks anywhere else reach the apps underneath; the panel is non-activating and never takes focus. With the setting off the pill appears only during a session. |
| Click to start | A click on the resting pill starts a hands-free session. Click Finish, or the squiggle, to stop and insert. A second click within 0.4 s of the start is ignored so a double click does not end the session it just began. Cancel discards. |
| Double tap of the hold key | Two quick taps within `DOUBLE_TAP_WINDOW_MS` (450 ms) latch recording on; one more tap (or a press) of the hold key, the toggle shortcut or Finish ends it. Needs a hold key to be chosen; works with Fn (see "Fn / Globe key" below). Setting "Keep recording with a double tap" (default on). |
| Hold-to-talk | Unchanged: hold, speak, release. A hold shorter than 0.35 s is still discarded. |
| Limits | Hands-free sessions (shortcut, pill click, double tap) stop and insert after 20 minutes; the pill warns at 19 ("One minute left. Then it finishes."). Hold-to-talk keeps its 3-minute backstop for a lost key-up. |
| Right-click menu | Native menu: Hide the pill for an hour, Microphone (System default and each input), Paste the last transcript, Copy the last transcript, Open dictation settings, Keep the pill on screen. |
| Edge and display | Drag the pill (5 px threshold separates a drag from a click) and drop it near the bottom, left or right edge; it snaps there and the edge is saved. It sits on the display the pointer is on (checked once a second). On the left and right edges the resting pill is vertical. |
| Hide for an hour | The expiry time is saved in `dictation.json`, so it survives a restart. The pill returns at the expiry, or as soon as dictation starts from the shortcut or hold key, or from "Show it now" in Settings. |
| Microphone | The choice is a CoreAudio UID saved in `dictation.json` and passed to the recorder. Inputs come from the engine's `devices` command (the same list the meeting recorder uses), re-read at most every 3 s and whenever the menu opens. If the saved device is missing from the list the session records from the system default and the pill says so; the saved choice is kept so it returns with the device. If the list is unavailable the choice is passed through and the engine's own fallback applies, which also raises the notice. |
| Sounds | A two-note rising chime on start and a falling one on stop, synthesized by the overlay page from sine tones (nothing sampled, no files). A hold plays the start tone only once recording really begins, so an accidental tap is silent; cancel is silent. Setting "Start and stop tones". |
| Copy the last transcript | Global shortcut (default `Control+Alt+Shift+C`, configurable, can be cleared) and menu item. It puts the last transcript on the clipboard (plain text, nothing else is typed) and says "Copied.". Ignored while a dictation is running. Same memory-only rules as paste-last, which it shares: the text is never written to disk or logs and is forgotten on quit. |
| Paste the last transcript | Global shortcut (default `Control+Alt+Shift+V`, configurable, can be cleared) and menu item. It re-types the last transcript into the focused field through the same snapshot, validation and insertion path as a dictation, and refuses secure fields. The text is held in the main process only: never written to disk, never in logs, never sent to the settings page (which only learns that one exists), forgotten on quit. |
| Microphone muted | While recording, the helper reads the chosen input's mute switch and volume (CoreAudio, read-only) every 2 s; muted or zero volume shows "Your microphone looks muted." on the pill. Devices that expose neither never warn. |

### Decisions made while building

- **Hands-free limit applies to every non-hold trigger,** including the existing toggle shortcut, not only to the new double-tap mode.
- **Double tap versus hold-to-talk.** The helper now also reports a press-and-release shorter than 150 ms as a `tap` event (holds are still reported only after 150 ms). The reducer remembers the last quick tap, or the last hold discarded as an accident; a press or tap that follows within the window latches hands-free. The cost: a hold-to-talk press that begins within 450 ms of a quick tap latches instead. Settings explains this, and the option can be turned off. With the option off, taps do nothing.
- **A double tap whose first press lasted past 150 ms** briefly opens and discards a session. The second tap then waits (up to 2 s) for the engine to let go of the microphone and starts as soon as it does.
- **Hotkey dictation clears a "hide for an hour".** Clicking the pill is not a hotkey and cannot happen while the pill is hidden.
- **The menu's Settings item** brings the main window forward and opens Settings, Dictation.
- **The idle overlay is only shown while dictation is enabled.** Turning dictation off removes the pill and releases every shortcut.

### Quiet mode

Two independent settings under "Pill and microphone", also in the pill's right-click menu:

- **Show what I'm saying** (default on): the words being recognised on the pill, including the raw words shown while cleanup runs. Off leaves the squiggle.
- **Show status messages** (default on): captions such as "Starting microphone", "Transcribing", "Cleaning up", "Inserting", and the "Inserted." / "Pasted." / "Copied." confirmations. Off leaves the pill with its squiggle, Cancel and Finish; after a successful insertion it goes straight back to the resting pill. The title is still announced to screen readers.

What may be switched off is decided in one place, `isMessageShown` in `src/shared/dictation-pill.ts`, where every kind of overlay text is classified. Only narration is suppressible (`live-text`, `status`, `cleanup-note`, `success`). These are **always shown**, whatever the settings: failures and refusals (`error`, `info`: microphone denied or lost, helper missing, engine errors, "no speech", "nothing to paste"), kept text with its Copy button (`recovery`), the Accessibility-is-off hint, "your microphone looks muted", the missing-microphone fallback, the one-minute limit warning, and shortcut conflicts (which show on the settings page). The overlay window shrinks to the bare pill when the words are hidden. Hidden words are never sent to the overlay page at all.

### Fn / Globe key

The Fn key reaches the helper as a flags-changed event (key code 63, the secondary-Fn flag), exactly like the other hold keys, so double tap works with it through the same path. Things specific to Fn:

- **macOS may act on the key itself.** Under System Settings, Keyboard, "Press Globe key to", a tap can change input source, open Emoji and Symbols, or start macOS dictation. The helper only listens, so it cannot stop that. It reads the setting (`AppleFnUsageType`) and Settings shows what applies, with the instruction to set it to Do Nothing; when the value cannot be read, a general hint is shown. Pressing Globe twice is also macOS's own dictation shortcut by default, so Fn double tap and macOS dictation will both react unless that is turned off.
- **External keyboards often have no Fn key.** The helper cannot tell; hold-to-talk with Fn simply never fires. Settings says so.
- **Chords:** Fn with an arrow or function key is a chord (a key is struck while Fn is down) and never counts as a tap or a hold.
- **A lost release.** If Fn's key-up is lost, the next modifier event from another key that no longer carries the Fn flag ends the hold, as for every hold key; the macOS event tap being paused ends it too. A hold also has the 3-minute backstop.
- **Not verified without a physical keyboard:** that a real Globe key delivers the flags-changed sequence the tests model (including on Apple keyboards with a dedicated Globe key), and how it interacts with the macOS setting above. The decision logic was split into `HoldMachine` and is covered by 17 Swift tests that feed it the same event sequences; the event tap itself is unchanged.

### Settings added

Settings, Dictation: Show the pill at all times (with "Show it now" while hidden); Pill position (bottom, left, right); Microphone; Start and stop tones; Keep recording with a double tap; Type the last transcript again and Copy the last transcript (shortcuts: change or turn off). All are saved in `dictation.json`: booleans, the edge, the hide expiry time, a device UID and an accelerator string. No audio, text or history.

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
3. **Input Monitoring:** only for hold-to-talk and its double tap.

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
14. The pill: it sits at the bottom centre; click it, say a phrase, click Finish. Drag it to the left and right edges and back; relaunch and check the edge is remembered. Move the pointer to a second display and wait a second: the pill follows.
15. Right-click the pill: hide for an hour (it disappears; press the toggle shortcut and it comes back), choose another microphone, "Paste the last transcript" into TextEdit, "Open dictation settings", and the on-screen toggle.
16. Choose a hold key, then double-tap it: recording starts and keeps going with the key up; tap once more to finish. Hold-to-talk still works after a pause. Try a slow double tap (over half a second apart): nothing starts.
17. Unplug a chosen USB microphone, then start: the pill says it is using the default. Mute the input in System Settings, Sound, Input while recording: "Your microphone looks muted."
18. Turn on Reduce motion in System Settings, Accessibility, Display: the squiggle changes height but no longer drifts. Turn off "Start and stop tones": silence.
19. Leave a hands-free session running for 19 minutes: the warning appears; at 20 minutes the text is finished and inserted.

## Verification performed on this Mac

Automated (all pass): 734 desktop tests (732 pass, 2 skipped) with typecheck and lint clean, plus 22 Swift tests for the hold-key logic and delivery helpers (`cd engine && swift test`). The dictation suites: session state machine (32, including double-tap timing, the 20-minute limit and the 19-minute warning), pill rules (22: hide expiry, edge snapping, docking, microphone fallback, menu, tones, shortcut collision, mute detection), overlay view (5), settings normalization and persistence (4), service orchestration (56: stale events, cancellation, cleanup and recovery, pill clicks, double tap with a draining engine, limits with fake timers, hide for an hour, microphone selection and fallback, paste last and copy last, shortcut collisions, Fn double tap, mute polling), helper client (7), plus capture ownership, cleanup validation, NotesService model ownership and consent, profile isolation and packaging invariants.

Real components (not mocks), synthetic text only:
- **Native helper vs TextEdit** (AX and forced paste): delivered once and verified; every clipboard representation (text, HTML, custom blob) hash-identical afterward; snapshots are single-use; a focus change is refused. Found and fixed a stale `NSWorkspace` focus check during this testing.
- **Native helper vs Chrome** (separate throwaway profile): `<textarea>` and `contenteditable` delivered via paste fallback and verified; password input classified secure and refused. Found and fixed a first-use gap (Chromium's accessibility tree is built on request; the snapshot now waits briefly).
- **Real service + overlay window + helper + TextEdit** (only the speech engine scripted): the real global shortcut and a real Esc key press, overlay non-focusable and not taking focus, Stop/Cancel/Copy/Dismiss, late results ignored after cancel, focus change to recovery without re-activating the old app, meeting-busy refusal.
- **Hold-to-talk** with OS-level modifier events: paired down/up with matching ids, tap and chord ignored.
- **Packaged app:** distinct profile and preferences, no production directories created, legacy `desktop` profile and production preferences byte-identical before and after, no updater activity, no network sockets beyond the debug port, second launch rejected while another Electron dev app ran, shortcut registered and released, clean quit with no orphans.

Pill slice, checked against real components:
- **`pnpm package:dev`** ran to completion on this Mac (ad-hoc signed, all isolation checks passed). The packaged app was built, not launched or driven.
- **Native helper, CoreAudio:** `input-state` answered for the default input (not muted, volume 0.5) and fell back to the default for an unknown UID. The new `tap` event is covered by the helper client test against a scripted helper; it was not driven with a physical key.
- **Overlay page in a real Electron window** (hidden, screenshots taken): rest, recording, busy, warning (dark) and message layouts render without console errors; every action (`pill`, `menu`, `drag-start`, `drag-end`, `stop`, `cancel`, `copy`, `dismiss`) reaches `will-navigate` from both anchor clicks and script navigation.
- **The real `DictationOverlay` class under Electron:** non-focusable, never focused, docks at 92x40 on the bottom, 40x92 on the left edge and 320x56 for a live session inside the display's work area, routes actions, hides, and a start-then-end drag reported the edge nearest the pointer.

Measured (single machine, no repeats, not a benchmark):

| Item | Result |
|---|---|
| Insertion, AX path (TextEdit) | 7–11 ms |
| Insertion, paste path (TextEdit) | 66–158 ms |
| Insertion, paste path (Chrome) | ~510 ms |
| Batch speech decode, 4.8 s phrase, models cached | 0.08–0.11 s (43–58x real time), whole process ~0.3 s |

The batch figure is **not** the live streaming path. The Settings panel and `dictation-metrics.jsonl` (numbers only, dev profile) record real start / stop-to-text / cleanup / insert timings once you dictate.

## Speed: where the time between Stop and text goes

The wait has three parts: the recogniser finishing (engine), our hand-off (main process), and the helper putting the text into the target. `Last dictation` in Settings now shows each stage, and `dictation-metrics.jsonl` records the same numbers (durations only, no text): `stopToFinalMs`, `engineDrainMs`, `engineFinishMs`, `finalToDeliverMs`, `targetWaitMs`, `helperRoundTripMs`, `helperValidateMs`, `helperInsertMs`, `helperConfirmMs`, `helperSettleMs`, `helperSkippedAx`, `stopToDoneMs`.

Measured on this Mac (single machine, a handful of runs, not a benchmark). Speech is a synthetic 4.75 s phrase from `say`; the helper and service ran for real against TextEdit and a Chrome textarea in a throwaway profile. Stop to done in the service, scripted engine:

| Stage | Before | After |
|---|---|---|
| Recogniser final flush (`engine stream`, warm models, 5 runs) | not separated | 28 to 49 ms; unchanged, it is the model's own flush |
| Microphone teardown and queued-audio drain, then the IPC hop | not measured | **not measurable here** (the engine has no microphone permission in this session); now reported as `engineDrainMs` and, with `finishMs`, the rest of `stopToFinalMs` |
| Main-process hand-off (final to request written, includes reducer, overlay render, status broadcast) | 0 to 1 ms | 0 to 1 ms (nothing to parallelise) |
| Target snapshot wait | 0 to 1 ms | 0 to 1 ms |
| Helper re-validation of the target | 1 to 4 ms (one 17 ms outlier) | same |
| TextEdit, accessibility insert and confirm, helper round trip | 4 to 10 ms | 7 to 9 ms |
| TextEdit, clipboard path, helper round trip | 43 to 112 ms | 18 to 57 ms |
| **Chrome textarea, whole stop to done, first dictation** | 526 to 601 ms | **24 to 73 ms** |
| **Chrome textarea, later dictations** | 526 to 601 ms | **43 to 46 ms** |

What took the time and what changed:

1. **Chromium and Electron apps accept accessibility insertion as a silent no-op.** The helper tried it, waited the full 400 ms confirmation window to learn that nothing changed, and only then pasted. It now recognises Chromium-based apps up front (an `icudtl.dat` inside a bundled framework: Chrome, Edge, Brave, Electron apps) and goes straight to the verified clipboard path, and it remembers any other app whose accessibility insertion did nothing for 30 minutes. This is where almost all of the wait was.
2. **Confirmation polling every 30 ms became every 8 ms.** Saves up to 22 ms on every verified insertion.
3. **The helper's Chromium wait in the target snapshot polls every 30 ms instead of 100 ms** (still bounded at 1.2 s), so a short dictation does not queue behind it, and the microphone-state poll runs on its own queue so it can never wait behind an accessibility call.
4. **Instrumentation:** stage timings in the helper's reply, in the service marks, in the Settings readout and in the engine's `final` event.

Kept on purpose (safety over speed):
- **Re-validation right before inserting** stays in the helper's `deliver`. Doing it in parallel with the recogniser's flush was considered and dropped: validation costs 1 to 4 ms, and a check made earlier would not be a check "right before inserting".
- **The 400 ms accessibility confirmation** stays for an app the helper has not classified. Shortening it risks a late accessibility insertion followed by a second, pasted copy.
- **Skipping the confirmation after an accessibility success** was not done: a reported success with no change is exactly the Chrome failure, and skipping would lose text silently.
- **The 0.6 s wait before restoring the clipboard** remains for targets whose content cannot be read. It delays only the helper's reply, not the text appearing, but it keeps a late paste from receiving your old clipboard.
- **Overlay animation** is not on the critical path: the request to the helper is queued before the overlay is touched, and the overlay never waits for or blocks insertion.
- **Cleanup (Local or Your provider)** is by far the largest cost when on; its time is `cleanupMs`. It cannot be shortened without changing what it does. Raw mode has none. No notes model is installed on this Mac, so cleanup latency was not measured.

Not measured: the live microphone path (microphone teardown, queued audio, and the IPC from the engine to the app). Open Settings, Dictation after one dictation and read the line under "Last dictation": `speech` is `stopToFinalMs` with its two engine parts, and the remainder is capture teardown plus the pipe.

## Not verified, and known gaps

- **Fn, needs a person:** see "Fn / Globe key" above.
- **Pill, needs a person:** dragging with a real pointer (the drag follows the cursor from the main process and ends on pointer release; a lost release ends by itself after 20 s), the native right-click menu popping from the non-activating panel, the look and the tones on real displays and speakers, following the pointer across displays, full-screen apps and Spaces (the window uses the same screen-saver level and all-workspaces flags as before), and a physical double tap of each hold key. The paste-last shortcut was tested with a scripted helper, not a real target app.
- **Double tap needs Input Monitoring**, like hold-to-talk. A double tap whose first press lasts past 150 ms starts and discards a session first; the pill may flicker and, with the start tone on, stay silent (a hold's tone waits for recording). This flicker is accepted as is.
- **Tones may be heard by the microphone.** A tone starts just before the microphone opens; if a speech model ever transcribes it, turn the tones off.
- **Device list** comes from `engine devices`, which has no virtual-device filter; aggregate and loopback devices appear if CoreAudio lists them.
- **Mic-muted check** reads the device's mute switch and input volume only. A microphone silenced inside another app, or a hardware switch the driver does not report, is not detected.

- **Live microphone dictation end to end** was not run: the microphone permission is undetermined for this session and a prompt is yours to answer. Live start latency, stop-to-text latency, streaming partials and accuracy are therefore unmeasured. One batch sample misheard "Priya" as "PRIA": raw mode inserts what the recognizer heard, and cleanup deliberately will not rewrite names.
- **Local and provider cleanup** were tested only with stubs. No local model is installed on this Mac and no provider key was used.
- **Wispr Flow** is not installed here, so shortcut overlap was not exercised (detection by process name is untested against the real app).
- **Electron-app target:** the scratch box inside the dev app itself was not driven by a real dictation; Chromium delivery was verified in Chrome.
- **Not tested:** microphone unplug, sleep/wake, a held key when the helper is killed on a real machine (covered by unit tests only), secure event input from a stuck app, Safari, Firefox, remote/virtual desktops, non-English input.
- **Engine:** `serve` still loads both the mic and system recognizers; a mic-only load would cut memory. The cold path (engine not yet warm) is unmeasured.
- **Not done by design:** no TipTap-specific insertion (the system-wide path covers the dev app's own editor), no history, no screen or surrounding-text capture, no cloud speech, no Windows adapter, no menu-bar item.
- Chromium and Electron targets are asked to expose their accessibility tree (`AXManualAccessibility`); that stays enabled in the target until it restarts.
