# Dictation parity study: Wispr Flow vs DoodleNote Dev

Planning document. It records what Wispr Flow offers, what DoodleNote Dev has today, and what to build or discuss. It is written in our own words. No Wispr code, text tables, images or animations are copied or shipped, and the raw evidence stays outside the repository.

## How this was gathered

- **Subject:** Wispr Flow 1.6.1337 (Electron 43.8.3, arm64) installed on this Mac, opened in REA as a static target. Wispr was left running; I did not dictate through it, sign in to anything, read history or touch account data.
- **Live observation:** window inventory of the running app, plus screenshots of the Flow Bar window (resting) and the Hub sidebar.
- **Static reading:** the English UI-string table in the Hub renderer bundle, which is keyed by screen (`settings_system_*`, `settings_hotkey_*`, `hub_status_*`, `hub_notetaker_*`…). Keys reveal what options and states exist. Strings are not behavior, so anything marked *inferred* needs a live check.
- **Public docs:** a separate docs pass (hands-free, Flow Bar docking, Command Mode, Dictionary, Snippets).
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

## Parity matrix: dictation

"Now" is the DoodleNote Dev build at commit `31b5c42`. Priority: **P1** next build, **P2** after, **Talk** needs a decision.

| Capability | Wispr | DoodleNote Dev now | Plan |
|---|---|---|---|
| Always-visible resting pill | yes, dockable | no overlay until a session starts | **P1** |
| Recording state with live level | yes | yes (overlay with meter) | restyle, **P1** |
| Cancel / Finish buttons | yes | yes (Stop, Cancel) | rename and restyle, **P1** |
| Click the bar to start | yes | no | **P1** |
| Hold-to-talk | yes (Fn default) | yes (chosen modifier) | done |
| Hands-free by double-tapping the hold key | yes | no (toggle shortcut only) | **P1** |
| Hands-free limit | 20 min, warns at 19 | 3 min | **P1**, raise and add a warning |
| Esc to cancel; sub-0.5 s taps discarded | yes | yes (Esc; taps under 0.35 s ignored) | done |
| Start sound | a ping | none | **P1** |
| Paste last / copy last transcript shortcuts | yes | recovery text only | **P1** |
| Undo after cancel | yes | no | **P2** |
| Drag to left/right/bottom; remember edge | yes | fixed position | **P1** |
| Hide for 1 hour; show at all times | yes | no | **P1** |
| Right-click menu on the bar | yes (list above) | no | **P1** |
| Microphone picker | yes, with virtual-device filter | system default only | **P1** |
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
