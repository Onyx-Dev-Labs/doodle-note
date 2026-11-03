# System-wide dictation: DoodleNote Dev build

Development-only. Dictation is compiled in only when the app is built with `DOODLENOTE_CHANNEL=dev`; production builds report it as "not part of this release" and never start the engine, shortcut or helper for it.

> **Name.** In the interface the dictation feature is called **Bark** (the Settings tab, the page title, the pill's tooltip and menu, and its notices). "Dictation" stays the plain-English word for what it does. The name lives in one place, `FEATURE_NAME` in `src/shared/dictation-brand.ts`. File names, settings keys, IPC channels and the macOS permission texts are unchanged.

## What it does

Press a shortcut in any macOS app, speak, and the recognized text is typed into the field you were using.

- **Recognition is always local** (the existing FluidAudio engine, microphone only). No audio is retained, no meeting is created, nothing is synced.
- **Triggers:** a configurable global toggle (default `Control+Alt+D`), optional hold-to-talk on a lone modifier (Right Option / Right Control / Right Command / Fn), a double tap of that same key (hands-free), and a click on the pill. `Esc` cancels while a session is live and is held only for that time.
- **The pill:** a small paper-toned doodle pill that stays at a screen edge while dictation is on, and grows into the live pill (Cancel, a squiggle that follows your voice, Finish) during a session. See "The pill" below. Partial text stays in the overlay; the final text is inserted once.
- **Delivery:** a native helper snapshots the focused app and control at start, re-validates immediately before inserting, and inserts through Accessibility, falling back to a clipboard paste that preserves every pasteboard representation and never overwrites a clipboard change you made meanwhile. It never presses Return.
- **Recovery:** if focus moved, the field is secure or unsupported, Accessibility is off, or the insertion cannot be confirmed, the text is kept (overlay + Settings → Dictation) for you to copy. It is never retried blindly and the old app is never re-activated.
- **Tidy-up, styles and transforms (separate from recognition):** Off, Light (default) or Full tidy-up, a tone per kind of app, and optional rewrite transforms. See "Tidy-up, styles and transforms" below. Busy, failing, timed-out or doubtful model output falls back to the words as you said them and says so.

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

### Mouse button trigger

An optional second trigger. Settings, Dictation, Shortcuts: "Mouse button" (default None), a "Press a mouse button..." capture control, a Clear button and a "Mouse button behaviour" choice. The keyboard hold key is unchanged and both can be set at once; either one works.

**Behaviour (default: Click to start, click to stop).**

| Mode | What the button does |
|---|---|
| Click to start, click to stop (default) | The first press starts a hands-free session at once, with no waiting for a second tap. The next press (the button going down, not up) stops and inserts. Releasing a button, however long it was held, never ends anything. Esc or Cancel still cancels. The 20-minute limit and the warning at 19 minutes apply. |
| Hold to talk | As before: hold past 150 ms and speak, let go to insert; two quick clicks latch hands-free and one more finishes. |

In click mode a click stops any hands-free session, including one started from the pill or the shortcut, but never a key hold. A second click within 0.4 s of the start (a double click or a bounce) is ignored, so it cannot start a session and stop it instantly. The helper reports click mode as one `click` event per press; the decision to start or stop lives in the pure reducer (`click` event, `STRAY_CLICK_MS`) and in `HoldMachine` (click mode), both unit tested.

- **Which buttons.** Buttons are numbered from 0. Middle (2), back (3), forward (4) and any higher extra button are allowed. Left and right click (0 and 1) are never allowed: the capture refuses them with "Left and right click cannot be used..." and settings validation refuses them whatever is sent. The capture is a listen-only tap that waits up to about 10 seconds for the next press.
- **Hold mode matches the key.** In hold mode the button goes through the same pure `HoldMachine` as the keyboard key: press and hold past 150 ms is a hold, a quicker click is a tap, two quick clicks within 450 ms latch hands-free, a hold under 0.35 s is discarded, and the 3-minute and 20-minute limits apply as before. There are no chord rules for a button (other keys and buttons do not spoil it).
- **Key and mouse stay independent.** Each has its own event tap and machine. They share one hold counter and one owner: whichever is announced first owns the session, and the other is ignored (its hold, its release and its taps) until the owner is released.
- **A lost release ends the hold.** While the button is held the helper reads the live button state every 250 ms; a button that reads as up ends the hold as if released. A paused event tap also ends it, as for the key.
- **Permission.** Like the key: Input Monitoring, shown in Settings as "needs permission".
- **Swallowing: implemented, default on.** "Don't send this button to other apps" uses an active (non-listen-only) event tap limited to the other-mouse-button events. It needs the Accessibility permission the helper already holds for inserting text; when macOS refuses an active tap the helper falls back to a listen-only tap, events pass through, and Settings says "macOS did not allow it, so the app under the pointer still sees the button". Only the configured button is ever consumed (its press, its release and its drags, as a pair; a press that was not consumed never has its release consumed); every other button, including other extra buttons, passes through untouched. Turning the option off gives listen-only pass-through (a back button will still go back). The tap is only created while a button is set, and torn down when it is cleared or dictation is turned off.
- **Mouse software.** Logitech Options+ and similar tools can remap a button before macOS sees it. The capture control, the Settings row and the pill's right-click menu (as the line under "Mouse button to hold and talk") all say: set the button to its default or generic action in that software if it does nothing.
- **Double tap** (hold mode) works with the mouse button too, with or without a hold key.
- **Why a button can seem not to work, and what the helper does about it.** (1) Before this change a single click in the only mode (hold) did nothing useful; click mode is now the default. (2) Input Monitoring was granted after the helper tried to create its event tap: creation failed once and was never retried. Now, whenever the helper reports the permission and a trigger is still waiting for it, the service re-arms it, and replaces the helper process once if macOS says yes but the old process still cannot create its tap. (3) macOS can switch a tap off without telling the callback: a watchdog now re-enables a quiet tap every 3 seconds (except while a new button is being captured). (4) Mouse software remapping, or a driver that sends a side button as a keyboard shortcut or a system-defined event instead of an ordinary extra-button event: no tap on the mouse events can see it. Those need the button set to its default or generic action in the vendor software, as the Settings row says. (5) The captured number and the tap use the same event field, so what Press a mouse button records is what the tap compares against; macOS numbers the buttons (middle 2, back 3, forward 4), and the page names them the way people count (Button 4 is number 3).

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

### Where the text will go

The live pill shows the icon of the app the text will be typed into (Chrome's icon for Chrome, and so on), after a small drawn arrow, so you can see at a glance that the focused app is the one you meant. Setting: Settings, Dictation, Pill and microphone, **Show where the text will go** (default on).

- The app is the one that was frontmost when the session began, the same snapshot the delivery uses. The helper reports its bundle path with the snapshot and draws the icon itself (`app-icon` request, `NSWorkspace`, 64 px PNG), only for an absolute path ending in `.app`. Nothing about the app's contents is read.
- Icons are cached by bundle id in memory (up to 64) and sent to the overlay page once per change, not with every level frame. The pill appears with the icon once it is loaded, so it never flashes a placeholder. If the icon cannot be drawn, the pill shows the app's first letter instead; if the helper cannot place the app on disk it does the same without asking for an icon.
- Off: no icon request is made and the pill is unchanged. The setting is read once per session, with the rest, so it cannot flip halfway.
- The icon is also announced to screen readers ("Typing into Google Chrome") and is the tooltip on the icon.
- Live pill only: the resting pill, message cards and panels do not carry it.

### Settings added

Settings, Dictation: Show the pill at all times (with "Show it now" while hidden); Pill position (bottom, left, right); Microphone; Start and stop tones; Keep recording with a double tap; Type the last transcript again and Copy the last transcript (shortcuts: change or turn off). All are saved in `dictation.json`: booleans, the edge, the hide expiry time, a device UID and an accelerator string. No audio, text or history.

## Tidy-up, styles and transforms

Speech recognition is always local. What happens to the words afterwards is three separate, independent steps, in this order: **tidy-up**, then the **style** for the app you are typing into, then an optional auto-applied **transform**. Settings, Dictation has a section for each.

### Tidy-up

| Level | What it does | Where it runs |
|---|---|---|
| Off | Types the words exactly as recognised. Styles are skipped too. | nowhere |
| Light (default for new installs) | Removes um, uh and similar, "you know" and "like" when set off by commas, stutters and repeated words ("the the", "I think I think"); applies spoken corrections ("meet at three, no, I mean four" becomes "meet at four"; "send it to John, I mean Jane"; "scratch that" drops the sentence before it); turns "first, milk. second, eggs." or "one, ... two, ..." into a bulleted list; capitalises sentences and "I"; adds the closing full stop. Pure functions, instant, on this Mac, no model, no network. | `src/shared/dictation-tidy.ts` |
| Full | A model rewrites a rambling brain dump into clear sentences, paragraphs or bullets, resolving false starts and self-corrections, keeping your meaning, voice and language, adding no facts, names or numbers. The result must pass the existing checks (numbers, negations and names preserved, no added text, not an answer instead of an edit) or the words as you said them are typed. | the notes model on this Mac if one is installed, otherwise your provider after you allowed sending text to that provider and model |

Light is deliberately cautious. A correction is only applied when a number replaces a number or a name replaces a name; anything else (for example "it was great, I mean really great") is left as spoken. "like" is only removed when commas frame it, so "I like pizza" and "looks like rain" are untouched. URLs, e-mail addresses, file names and code identifiers (`main.swift`, `getUserName`, `max_retries`, text in backticks) are never recapitalised or altered. Text that does not look English (non-Latin scripts, accented words with no English in them, clear function words of Spanish, French, German, Portuguese or Italian) passes through with only its spacing normalised. Language detection is a heuristic: very short text with no evidence either way is treated as English.

If Full is chosen but no model is available (nothing installed, or a provider without consent), Light is used and the Settings page says so; nothing is sent anywhere. Old settings files keep their meaning: a stored model cleanup mode becomes Full, the old default becomes Light.

### Style

Four categories (Personal messages, Work messages, Email, Everything else), each with a tone and a card showing a live before and after:

- **Proper**: capitals and full punctuation.
- **Relaxed**: capitals, no closing full stop; question and exclamation marks stay.
- **Lowercase quick**: no capitals except "I", acronyms and words with capitals inside (iPhone), and no closing full stop. URLs, e-mail and code are left as spoken. A personal dictionary will plug in here (`knownTerms` in `applyStyle`); none exists yet, so names are lowercased too.

The category comes from the focused app's bundle id, read by the helper when the session starts. A built-in list covers Messages, WhatsApp, Telegram, Discord and Signal (personal), Slack, Teams, Zoom and Webex (work), and Mail, Outlook, Spark, MailMate, Airmail and Superhuman (email). Everything else, including Notes and every browser, is Everything else: Gmail in a browser cannot be told from any other page, so it is not pretended. The page lets you move any app between categories, add one from the apps you dictated into lately or by bundle id, and remove your additions; your choice beats the built-in list. Defaults: Relaxed for personal, Proper elsewhere. Styles only change capitals and punctuation, apply to English only, and need tidy-up to be Light or Full.

A "Cheerful" tone was not built: it would mean swapping a full stop for an exclamation mark or adding emoji, which turns "my dog died." into "my dog died!". A tone shift needs understanding of meaning, so it belongs in a transform (see Friendly email), not in a deterministic rule.

### App names and icons on the Style list

Each app in a category shows its real icon and name instead of its bundle identifier ("Built in" or "Added by you" under it; the identifier is the hover tooltip). The page asks the helper once per list change (`app-info`: `NSWorkspace` finds the app from its bundle id; the name is its display name, the icon a 64 px PNG), and the app remembers answers for ten minutes. An app that is not installed on this Mac gets a dimmed letter tile and the name from a small built-in table (`src/shared/dictation-app-names.ts`, which a test keeps complete for every built-in app). Only the app bundle's own name and icon are read.

### Transforms

Named rewrite prompts, opt-in (Settings, Dictation, Transforms, "Turn on transforms"). Built in, with our own prompts: Polish, Make it shorter, Friendly email, Bullet summary, and Turn it into a prompt for an AI assistant. You can edit any of them, delete them, create your own (a name and your own prompt, up to 20 transforms), give each an optional global shortcut, and reset to the defaults. Your prompts and shortcuts are stored in `dictation.json`, which never holds dictated text.

- **Running one** (its shortcut, the pill's menu "Rewrite the selection or last dictation", or Try on its card): it takes the text selected in the focused app if the helper can read it, otherwise your last dictation (held in memory only), sends it to the model as data inside tags with our safety rules ahead of your prompt, checks the answer, and puts the result in. For a selection, the helper replaces exactly that selection, and it is told what the selection was: if the selection changed while the model worked, the insertion is refused and the result waits on the kept-text card. For the last dictation the result is typed at the cursor.
- **Checks on the result:** not empty, not an answer or a refusal instead of a rewrite, not wildly longer than the text; Polish additionally has to keep every number, negation and name. A doubtful result changes nothing and the pill says why.
- **Secure fields:** the selection is never read from a password or other secure field.
- **Auto apply after dictation:** pick one transform and turn the toggle on. It runs after tidy-up and style on every dictation. If it fails or looks doubtful, the text before it is typed and the pill says so. Its time is counted in the timing metrics (`transformMs`), next to the model tidy-up (`tidyMs`).
- **View changes and Undo:** after a transform changed the text the pill shows "Changed by Polish. View, Undo" for 8 seconds, and View and Undo stay in the pill's menu and Settings. View opens a word-level before and after (removed words struck through, added words highlighted). Undo asks the helper to find the one copy of the new text in the focused field, select it and put the old text back through the same verified insertion. If the field no longer holds it exactly once, nothing is forced: the old text waits on the kept-text card. The text before a transform is held in memory only and forgotten on quit.
- **Model access:** the notes model on this Mac if one is installed, otherwise your provider with the existing consent (bound to provider and model; the Tidy-up section holds the toggle, and a transform run without consent tells you where to give it). With neither, the page says so plainly; Light and styles keep working.
- **Quiet mode:** "Changed by..." and the "working" caption are suppressible by "Show status messages". Errors, kept text and warnings never are. Undo and View remain in the menu.

### Privacy and limits

- No dictated text or selection is written to disk or logged; metrics hold durations only.
- Only the model steps send anything off the audio path, and only to the notes model on this Mac or to your consented provider: the text being tidied or rewritten, never audio. Consent covers dictated text and text you ask a transform to rewrite.
- A selection longer than 6,000 characters is refused, and a model call longer than 40 seconds (local) or 25 (provider) is cut off with nothing changed.
- Bullets use real newlines, which some single-line fields and chat apps treat as "send" or as a line break; turn tidy-up to Off or relaxed to avoid them there.
- Transforms in apps whose accessibility tree does not expose the selection (some web views) fall back to the last dictation, and Undo there may keep the text on the card instead of replacing it.
- A local model is not installed on the development Mac: the model path was tested with stubs only.

## Dictionary and learning from your corrections

Settings, Dictation, **Dictionary**. Two things: a list of words the recognizer gets wrong, and a watcher that adds to the list when you fix one.

### The list

- An entry is **heard, written**: "Alec" is written "Alex". It matches whole words in any case ("Alec's" becomes "Alex's"; "alecs" is left alone), up to four words ("doodle note" is written "DoodleNote"). An entry with nothing in "When it hears" is a spelling: whenever those letters appear, they are written exactly like this ("macos" becomes "macOS").
- It applies to every dictation **after** tidy-up and style, at every tidy-up level including Off, in one pass: an entry's output is never matched by another entry, a style such as Lowercase quick cannot change how a dictionary word is written, and a transform's result is passed through it too (View and Undo compare against what was typed). If the written word is all lower case, it follows the capitalisation of what was heard.
- Up to 500 entries, each at most 60 characters on one line. Hand-made entries show "Added" or "Spelling"; learned ones show "Learned". Adding an entry for words that already have one replaces it. **Remove** removes one; **Remove all learned** keeps the hand-made ones.
- Stored in `dictation.json` with the other preferences (words only, mode 0600). A settings update from the page cannot replace the list; it changes only through the add, remove and clear calls, so a stale page cannot erase what was learned.
- The recognizer itself is not told about the words (the speech engine has no vocabulary biasing); the fix happens in the text. Full tidy-up sees the raw words, and the dictionary is applied to its answer.

### Learning from corrections

On by default (**Learn from my corrections**). After a dictation is **confirmed typed** into a field (not kept for copying, not a transform, not paste-last):

1. The helper keeps a handle on that one field (for at most 5 minutes; one field at a time; never a secure field).
2. The app reads the field back about once a second. Each time the text changes it aligns the words it typed against the best-matching stretch of the field (the field may hold other text before and after).
3. When the typed words are gone (the message was sent and the field cleared or removed), you moved to another app for 15 seconds, 3 minutes passed, or the field becomes unreadable, whatever corrections were visible at the last reading are judged and the watch ends. A new dictation ends the previous watch first.
4. A changed stretch is learned only if it **looks like a misheard word**: one to three words replaced by one to three words, at least 60% alike letter by letter (Alec/Alex, Jonathon/Jonathan and "doodle note"/"DoodleNote" qualify; Thursday/Friday does not), not numbers, not a case-only change, and not when the heard side is made of everyday words or homophones (to/too, their/there), which would be replaced everywhere. Added or deleted words are edits, not corrections. If more than about 40% of the message changed, it was a rewrite and nothing is learned.
5. The pill says "Added to your dictionary: Alec → Alex" for 7 seconds (narration: hidden by "Show status messages" being off). Repeating the same correction raises its count; a newer learned spelling replaces an older learned one; a hand-made entry is never overwritten.

What it touches, in plain terms: the text of the field you dictated into is read into memory about once a second for a few minutes, compared with what was typed, and dropped. Only the changed words that pass the check are kept, in the dictionary, where you can see and remove them. The text is never logged (the log says how many corrections were learned, not what), never written to disk, never sent anywhere (no network, no model). It reads only that one field, never a password field, nothing longer than 20,000 characters, and nothing after the watch ends. Turn it off under Dictionary to stop it entirely: the helper is then not even asked to keep the field.

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

## Permissions

The app never changes a permission itself: it asks macOS, which shows its own dialog, and you answer. Settings, Dictation, Permissions has one row per permission:

| Permission | What "Allow..." does | Asked from |
|---|---|---|
| Microphone | `systemPreferences.askForMediaAccess('microphone')`, only while the state is "Not asked yet" | the app (main process) |
| Accessibility | `AXIsProcessTrustedWithOptions` with the prompt option: macOS's "would like to control this computer" dialog, which also adds the app to the Accessibility list | the dictation helper (op `request-accessibility`) |
| Input Monitoring | `CGRequestListenEventAccess`, only while the state is "Not asked yet" | the dictation helper (op `request-input-monitoring`) |

Once macOS has been answered (allowed or denied), it never prompts again for the microphone or Input Monitoring, so the button becomes "Open System Settings". Accessibility can be asked again, so its button stays "Allow..." until it is granted. A granted row keeps a small "Open System Settings" button. The rows are re-read from the helper after every request and whenever the window gains focus; if macOS still reports "Not allowed" after you turn it on, the row says to quit and reopen the app (Accessibility and Input Monitoring grants are often only seen by a freshly started process; the microphone applies at once).

The microphone is also requested automatically the first time a session starts while it is "Not asked yet": the macOS dialog appears from the pill, and the session you asked for then begins. A hold key that was released while the dialog was up does not record; the pill says to hold it again.

**Which process owns the Accessibility grant.** macOS attributes a permission request to the app that launched the asking process (its "responsible process"), not to the child itself. Checked here with `responsibility_get_pid_responsible_for_pid`: a process started from a Python child of a GUI app reports that GUI app, not its immediate parent or itself. So the dictation helper, a child of the Electron main process inside `DoodleNote Dev.app`, is attributed to **DoodleNote Dev** (`com.doodlenote.desktop.dev`) when the app is opened normally, and the helper's `AXIsProcessTrusted` answer is the one the Settings row shows. Asking from the helper rather than the main process puts the entry macOS lists next to the code that really needs it and makes the row reflect the helper's real answer. The same rule means that a dev run started from a terminal (`pnpm dev:dictation`) is attributed to that terminal instead; grant it there, or use the packaged app. The attribution under the packaged app was inferred from this rule, not exercised: doing so raises real prompts.

**Ad-hoc signing and resets.** The default build is signed ad-hoc, and macOS ties a grant to the code signature, so every rebuild is a new identity: grants disappear (the app may still be listed, switched off) and macOS asks again. A signing identity from `DOODLENOTE_DEV_IDENTITY` keeps grants across rebuilds. To start from nothing, for example when the app is missing from a list:

```sh
tccutil reset All com.doodlenote.desktop.dev
```

then quit DoodleNote Dev, reopen it, and use Allow... on each row (or start a dictation, which asks for the microphone itself). The app only appears under Privacy & Security after it has asked, which is what Allow... does.

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

Automated (all pass): 924 desktop tests (922 pass, 2 skipped) with typecheck and lint clean, plus 52 Swift tests for the hold-key and mouse logic, delivery helpers, the text locator and app icons (`cd engine && swift test`). The dictation suites: session state machine (42), pill rules (33), overlay view and panels (13), settings normalization and persistence (12), service orchestration (105: the earlier flows plus tidy-up, styles by app, Full with a stub model, auto-apply, transform hotkeys, selection and last-dictation runs, View, Undo and its recovery, shortcut clashes, quiet mode), helper client (16), Light tidy-up (13 tests over a table of about 85 phrases), styles and app categories (12), transforms, validation and the word diff (12), the plan and model steps with a stub model (16), permissions (6), model cleanup validation (7), plus capture ownership, NotesService model ownership and consent, profile isolation and packaging invariants.

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

- **Dictionary learning, needs a person:** the decisions are covered by tests (alignment, what counts as a misheard word, the watcher's timing, the service flow and the settings page), and the Dictionary section was viewed in a browser with sample entries. **Not run against a real app:** whether a given app exposes its field text to accessibility. Native text boxes (TextEdit, Notes, Mail's body) are expected to; Chrome, Slack and other Electron apps expose text fields and text areas but may not expose rich message boxes, in which case the field reads as "unreadable", the watch ends after three misses and nothing is learned. The helper's read-back, and how a sent message looks to it in Slack, Messages, Gmail and a browser textarea, still need trying. An attempt to drive TextEdit from this session was abandoned because the Mac was locked.
- **Learning only sees a correction that is still in the field.** A message sent in under a second after the fix, or an app that removes the box before the next reading, loses it: the last reading is what counts. Rewording a name inside a long paragraph is found; moving text around is not.

- **App icon on the pill, needs a person:** the helper's `app-icon` request was driven for real (Chrome's icon came back as a 64 px PNG, a missing app is refused) and the overlay page was rendered with that icon in a browser. Not seen in the real overlay window on a real display, and the icon appears only once the target snapshot has returned (up to about a second in a Chromium app while its accessibility tree wakes up).
- **Settings page layout, needs a person:** the refreshed Settings page was checked in a browser with stubbed app data (light and dark; General, Notes model, Dictation, Integrations). It was not opened in the packaged app, and Calendar and Cloud sync were not looked at.

- **Tidy-up, styles and transforms, needs a person and a model:** no notes model is installed on the development Mac and no provider key was used, so Full tidy-up and every transform were tested with stub models. Not exercised against real model output: the prompts' quality, the validators on real rewrites, timing of the local model. Not driven in a real app: reading a selection and replacing it through accessibility in TextEdit, Notes or a browser, Undo's search in real fields, the View and Undo pill on screen with a pointer, and the settings sections (they type-check and the components share the existing page patterns, but were not opened).

- **Mouse button, needs a physical multi-button mouse:** the packaged helper was driven with synthetic events on an unused button (number 7, which no app acts on) through the real event taps and the real service: in click mode a single click starts a session at once, a long press does not end it, a double click 80 ms apart does not end it, a click about a second later stops it and inserts, and swallowing neither eats the second click nor lets either through (turned off, both pass through); hold mode behaves as before; the capture records the same number the tap sees. Not checked with real hardware: back and forward in a real browser, a remapping tool in the way, the lost-release poll with a physical release, a key and a button held together (covered by the arbiter's unit tests only), the primary-button refusal (left and right clicks cannot be synthesised safely), and an active tap's behaviour if Accessibility is revoked while running.
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
