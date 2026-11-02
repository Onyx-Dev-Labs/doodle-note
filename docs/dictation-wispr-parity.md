# Dictation parity study: Wispr Flow vs DoodleNote Dev

Planning document. It records what Wispr Flow offers, what DoodleNote Dev has today, and what to build or discuss. It is written in our own words. No Wispr code, text tables, images or animations are copied or shipped, and the raw evidence stays outside the repository.

## How this was gathered

- **Subject:** Wispr Flow 1.6.1337 (Electron 43.8.3, arm64) installed on this Mac, opened in REA as a static target. Wispr was left running; I did not dictate through it, sign in to anything, read history or touch account data.
- **Live observation:** window inventory of the running app, plus screenshots of the Flow Bar window (resting) and the Hub sidebar.
- **Static reading:** the English UI-string table in the Hub renderer bundle, which is keyed by screen (`settings_system_*`, `settings_hotkey_*`, `hub_status_*`, `hub_notetaker_*`…). Keys reveal what options and states exist. Strings are not behavior, so anything marked *inferred* needs a live check.
- **Public docs:** a separate docs pass (hands-free, Flow Bar docking, Command Mode, Dictionary, Snippets).
- **Native helper:** decompiled and string-read in Hopper (see Native helper findings).
- **Not captured:** the Flow Bar while recording or processing, and the content pane of the Hub (the window did not render while off-screen). REA's `observe_native_ui` refused the Wispr windows ("window-mismatch"), so screenshots came from `screencapture`. Recording-state visuals need a live session; see the open questions.
- **Reference data location:** `/tmp/dn-dict-wispr/` (outside the repo, not committed).

## What Wispr runs

| Window | Purpose |
|---|---|
| Status (512×614, layer 1000, mostly transparent) | The Flow Bar. At rest it is a small pill at the bottom centre of this window. |
| Wispr Flow (1350×850) | The Hub: Dictation, Notetaker, Insights, Dictionary, Snippets, Style, Transforms, Scratchpad; bottom: Invite, Referral, Settings, Help. |
| Scratchpad (500×420) | A floating note window. |
| Meeting Recorder (500×884) | The Notetaker side panel ("Notepad"). |
| Context Menu (full screen, layer 1000) | Hosts the Flow Bar's right-click menu. |
| Three 33 px full-width strips | Menu-bar-height helper windows. |

A separate Swift helper app handles native input, as in the first REA pass.

## Flow Bar: what exists

**States and surface** (from keys and docs; visuals of the active states are not yet captured):
- Resting pill; recording; processing; a short "Cleaned up!" confirmation; error and notice cards.
- Two buttons while recording: **Cancel** and **Finish and paste**. A separate stop control for Notetaker.
- A "typing reminder" coach that shows hints such as "hold [key] to dictate" depending on the app type you are typing in. It is configurable by app category (AI apps, documents/notes, email, personal and work messengers, specific apps), can be disabled, and can be muted for 12 hours.
- A "fetch links" action and a transform-ready notice with a "see changes" shortcut.
- App-level block: dictation can be disabled in chosen apps and URLs; the bar says so when it is blocked.

**Right-click menu on the bar:** Hide for 1 hour; Microphone (with "show other devices"); Languages; Formatting options; Paste last transcript; Transcript history; Settings; Configure reminder; Mute reminder for 12 hours.

**Placement:** draggable to bottom, left or right of the screen; remembers the edge; follows the cursor's display; clicks pass through when hidden.

## Settings surface

- **General:** microphone (dictation only; Notetaker uses auto), languages (multi-select for accuracy), shortcuts dialog, app language, email language, theme.
- **Shortcuts dialog:** Push to talk, Hands-free (also double-tap of the PTT key), Command Mode, Cancel, Paste last transcript, Copy last transcript, Open Scratchpad, Join meeting / start Notetaker (also triple-tap of the dictation key), Transform and "view changes", Focus Mode, Press Enter rebind, Instruct Mode, mouse side-button shortcuts, a recommendation prompt, and a warning when hands-free overlaps push-to-talk.
- **System:** show Flow Bar at all times; launch at login; show in dock; dictation sounds; mute or pause music while dictating; Smart Formatting; auto-add corrected words to the dictionary; email auto-signature; dictation reminder; hide Flow Bar and Notepad during screen share; Scratchpad open behavior (resume, last pinned, new tab); notifications by category; reset app; restart tutorial.
- **Style:** four tone cards (formal, casual, very casual, excited) applied per app category: email, personal messengers, work messengers, everything else.
- **Transforms:** polish and custom prompts with their own shortcuts, auto-apply after dictation, writing samples for a voice profile, a diff viewer.
- **Dictionary and Snippets,** with bulk import.
- **History and data:** transcript history with retry and report; local storage choices (store, auto-delete after 24 h, never store); cloud sync toggle; data-sharing toggle; context awareness; erase by category.
- **Experimental:** Command Mode; Focus Mode (blocked apps/URLs); learn-from-email style via Gmail; bulk import.
- **Insights:** words, streaks, speed, leaderboard. Out of scope here.

## Native helper findings (Hopper pass)

Source: the Swift helper (arm64, 29,580 procedures, Swift symbols stripped) opened in Hopper through REA, plus its string table. Behaviour below is read from class names, log strings and one decompiled provider. It is evidence of what the helper does, not a spec to copy.

**Text delivery**
- Tries a direct Accessibility value set first. If the value does not stick, falls back to a clipboard paste. If no element can be focused it activates the app and pastes anyway ("last resort").
- Clipboard path saves the user's pasteboard types, writes the text, posts the paste, then restores the clipboard about 500 ms later. A setting turns restore off.
- Uses *delayed rendering*: the pasteboard holds a promise and the text is supplied only when the target app asks for it. A timer detects "no app requested the data", which means the paste failed, and raises a failed-paste notice.
- Marks clipboard writes with the concealed-type flag so clipboard managers skip them.
- Special cases: Shift+Insert for some apps, a "remote viewer" path for remote-desktop windows, Slack rich-text handling, a block list that reports "paste blocked", and a check for held keys before pasting.
- After pasting it watches the field to learn from user edits (the "auto-add corrected words" feature).

**Mic and audio**
- Watches which processes hold the microphone (Core Audio process list), the default input device, mute state, and input volume dropping to zero or being restored. This feeds a "your mic is muted" warning and meeting detection.
- A volume manager lowers or mutes output while dictating and restores it afterwards, with a rule to decline if another device is owed a restore. A now-playing cache and media-transport control pause music.
- Bluetooth LE manager for a paired hardware "ring" device (pairing, scan, audio characteristic). Out of scope for us.
- Notes an external non-Apple keyboard means no Fn key.

**Meetings**
- Window and tab monitors for Zoom, Google Meet and Slack Huddle; a conference end-state reader and a "browser leave proof" that confirms the user really left the call before stopping.
- Active-speaker polling through Accessibility for Zoom and Meet, which drives live speaker names.
- A consent message posted into the meeting chat (Accessibility value set, clipboard fallback).
- A dictation gate that stops dictation colliding with a running Notetaker.

**Other**
- Focus Mode: blocks activating or cold-launching chosen apps and navigating to chosen URLs, checking the browser's address bar through Accessibility.
- Floating web panel host for in-app web content; secure-input monitor; keystroke tracing for edit capture.

**Ideas this gives us (not in the matrix above)**
1. Delayed-render clipboard with a failed-paste detector, concealed flag and 500 ms restore. Our paste fallback is simpler.
2. Mic-muted warning while recording.
3. Pause or lower music while dictating, restoring afterwards.
4. Meeting end detection by proving the user left, not just the window closing.
5. Posting a recording-consent line into the meeting chat (opt-in).

## Parity matrix: dictation

"Now" is the DoodleNote Dev build at commit `31b5c42`. Priority: **P1** next build, **P2** after, **Talk** needs a decision.

| Capability | Wispr | DoodleNote Dev now | Plan |
|---|---|---|---|
| Always-visible resting pill | yes, dockable | yes, setting "Show the pill at all times" (default on) | **P1** done |
| Recording state with live level | yes | yes, doodle pill with a squiggle driven by the level | **P1** done |
| Cancel / Finish buttons | yes | yes, hand-drawn glyphs, labelled Cancel and Finish | **P1** done |
| Click the bar to start | yes | yes (hands-free; click Finish or the squiggle to stop) | **P1** done |
| Hold-to-talk | yes (Fn default) | yes (chosen modifier) | done |
| Hands-free by double-tapping the hold key | yes | yes, setting on by default; needs a hold key | **P1** done |
| Hands-free limit | 20 min, warns at 19 | 20 min, visible warning at 19 (hold-to-talk keeps 3 min) | **P1** done |
| Esc to cancel; sub-0.5 s taps discarded | yes | yes (Esc; taps under 0.35 s ignored) | done |
| Start sound | a ping | generated two-note chime for start and stop, setting to turn off | **P1** done |
| Paste last / copy last transcript shortcuts | yes | paste-last and copy-last shortcuts and menu items (memory only) | **P1** done |
| Undo after cancel | yes | no | **P2** |
| Drag to left/right/bottom; remember edge | yes | yes, snaps and remembers; follows the display under the pointer | **P1** done |
| Hide for 1 hour; show at all times | yes | yes; expiry persisted | **P1** done |
| Right-click menu on the bar | yes (list above) | yes: hide, microphone, paste last, settings, keep on screen | **P1** done |
| Microphone picker | yes, with virtual-device filter | yes (menu and Settings); falls back to the default; no virtual-device filter yet | **P1** done |
| Languages picker | yes | engine default | **Talk** (depends on engines) |
| Mute or pause music while dictating | yes | no | **P2** |
| Dictation reminder coach | yes | no | **Talk** |
| Block dictation in chosen apps/URLs | yes | no | **P2** |
| Hide bar during screen share | yes | no | **P2** (content-protection flag) |
| Custom dictionary + auto-add | yes | no | **P2** |
| Snippets | yes | no | **P2** |
| Styles (tone per app type) | yes | cleanup modes Raw/Local/BYOK only | **Talk** |
| Transforms / Polish / voice profile | yes | no | **Talk** |
| Command Mode (edit selected text by voice) | yes, hosted | no | **Talk** |
| Instruct Mode (screen-context replies) | yes, hosted | no | **Talk**: needs screen reading, against our current privacy line |
| History with retry | yes, audio kept 14 days | none by design | **Talk** |
| Press Enter by voice | experimental | never, by design | keep out; revisit only as explicit opt-in |
| Mouse side-button triggers | yes | no | **P2** |
| Cloud speech | yes | local only by design | keep local |

### P1 status

Built on `feat/system-dictation` (see `docs/dictation-dev-app.md` for behaviour, settings and limits):

- [x] Always-visible resting pill, non-activating
- [x] Click to start, click Finish to stop
- [x] Double-tap of the hold key latches hands-free
- [x] 20-minute hands-free limit with a warning at 19 minutes
- [x] Right-click menu (hide for an hour, microphone, paste last, settings, keep on screen)
- [x] Drag to bottom, left or right; snaps and remembers the edge; follows the pointer's display
- [x] Hide for an hour, persisted, ends on the clock or on a hotkey start
- [x] Microphone picker through the engine's device list; falls back to the system default
- [x] Start and stop tones, own and generated, with a setting
- [x] Paste-last shortcut (default `Control+Alt+Shift+V`) and copy-last shortcut (`Control+Alt+Shift+C`), text kept in memory only
- [x] Double tap also works with Fn as the hold key (macOS Globe setting is read and explained; real keyboard still to be tried)
- [x] Doodle restyle of the overlay
- [x] Settings page controls for all of the above
- [x] Mic-muted warning (helper reads the input's mute switch and volume)

Still to see with a human at the Mac: the look on real displays, dragging with a real pointer, the native right-click menu, live dictation through every path, and the tones through speakers.

## Our own look

Match the structure and options, not the pixels or the brand. Proposed direction for the Flow Bar equivalent:
- A small ink-line "doodle" pill instead of a gray capsule, using the existing DoodleNote mascot and `DoodlingIndicator` vocabulary: a squiggle that animates with the voice level, hand-drawn stop and cancel glyphs, paper-toned surface with the app's accent.
- Our own sounds, our own words in menus, our own icons.
- Same placement logic (bottom, left, right), because that part is behavior and users expect it.

## Note-taking: what Wispr offers vs DoodleNote

Wispr's Notetaker is a large part of the product. Status in DoodleNote is from reading the current source and may be partial; items marked *verify* need a closer look before we plan.

| Wispr note-taking capability | DoodleNote today | Note |
|---|---|---|
| Meeting recording with live transcript | Have (live captions, local engines) | |
| Auto-detect a call and offer or auto-start; auto-stop when it ends | Partial: meeting detection exists | *verify* whether auto-start and auto-stop options match |
| Calendar notices, reminders before meetings (1 min, 2 min, 15 s), next meeting in the menu bar | Partial: Google and Microsoft calendar, prompts | menu-bar countdown *verify* |
| Speaker names from calendar attendees | Partial: speaker labels exist | auto-naming from attendees *verify* |
| Notepad beside the meeting, side-by-side split screen on join | Not found | **gap** |
| Floating Scratchpad with pinned notes, search, versions, hotkey, "Transform" chat | Not found | **gap** |
| AI summary, action items | Have (generated notes, action items in Home/Meeting) | |
| Custom summary recipes | Have (recipes: per-meeting prompts, markdown/checklist/email outputs, local-only or explicit cloud) | ours is stronger on privacy |
| Built-in skill library (follow-up email, decision log, CRM update, interview feedback, etc.) | Partial: recipes are user-created; no shipped library | **gap**, cheap win |
| Ask across meetings, chat history, "Ask anything" | Have (global Ask with budgets) | |
| Tasks view collecting action items | Partial: action items in views | dedicated Tasks surface *verify* |
| Folders and folder search | Have | |
| Share notes with people, visibility, auto-share to attendees | Partial: share links via sync | attendee auto-share **gap** |
| Consent notice posted into meeting chat; consent copy | Not found | **gap** |
| Hide recorder from screen share | Not found | **gap**, one flag |
| Max recording length with warning | Partial | *verify* |
| Import from Zoom, Granola, Otter, Fireflies | Not found (audio and text import exist) | **gap** |
| Connectors (Slack, Notion, Gmail, Linear, GitHub) feeding context | Not found as connectors | **Talk**: privacy review needed |
| Memory: cross-meeting contact and project memory, "curator" | Not found | **Talk**: big and privacy-sensitive |
| MCP server for AI tools | Have (local MCP, remote MCP) | |
| Export | Have (Markdown, PDF) | copy-as-Markdown shortcut *verify* |
| Insights, leaderboard, referrals | None | skip |

## Open questions for you

1. **Look and feel:** is "doodle pill with our mascot" the right direction, or do you want something closer to Wispr's capsule?
2. **Recording-state visuals:** I have not seen the bar while recording. I can start a hands-free recording in Wispr for a few seconds with a synthetic phrase and capture it. That sends a short clip to Wispr's servers. Do you want me to, or would you rather record your screen yourself?
3. **Scope of the first build (P1):** resting pill, click-to-start, double-tap hands-free, right-click menu, drag-to-edge, hide-for-an-hour, microphone picker, start sound, paste-last shortcut, 20-minute limit. Go ahead as one slice?
4. **Bigger items:** Dictionary and Snippets, Styles, Transforms, Command Mode. Which do you want, and in what order?
5. **Notetaker gaps:** Scratchpad/Notepad, the shipped recipe library, consent notice, import from other tools. Which belong in DoodleNote?
6. **Hands-free double-tap** changes the meaning of the hold key (a quick second press). Fine with you?
