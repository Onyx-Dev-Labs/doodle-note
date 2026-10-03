# Pencil and adaptive editing (ONY-247)

The fresh native editor retains an editable PencilKit canvas across content-pane and layout changes. The drawing remains in the existing versioned note document, with the same immutable source/revision and retry contracts. No ink format migration, cloud transport, OCR or automatic handwriting indexing is introduced.

## Input and layout

Drawing tools are docked above the canvas: pen, pencil, marker, vector eraser, lasso, color and width choices, plus finger-drawing selection, undo/redo and zoom. The drawing controls scroll horizontally at narrow widths instead of clipping. There is no floating Pencil palette that can cover recording actions. Pinch/pan and Fit page/100%/200% remain available; read-only drawings retain scrolling and zoom.

At regular widths of at least 740 points, personal notes/ink/summary and the transcript use separate columns. Narrow widths and accessibility text sizes use one content pane at a time. Personal notes remain the system TextEditor, supporting native keyboard editing, dictation and system Scribble where Apple enables it. Converted Scribble text is ordinary personal text. Switching to ink dismisses text focus; Done typing dismisses the keyboard. Command-1 through Command-4 choose personal notes, drawing, transcript and summary. Drawing undo/redo use Command-Z and Shift-Command-Z. Personal text keeps its system editing/undo behavior.

Title and recording controls remain outside the drawing surface. Note details (folder and spoken language) expand when needed; the recording timer and interruption warning remain visible. Recording continues while switching content panes or navigating away; navigation flushes queued notes, and does not silently stop capture. Destructive storage controls retain the existing capture/preparation guards.

## Preservation and undo

A retained InkEditingSession owns the canvas and per-note gesture history. A complete drawing gesture is one undo action. Pane disappearance finishes a pending gesture. Native UIKit drawing undo is disabled so it cannot diverge from the session history; explicit tools and keyboard commands use the same history. History is session-local, bounded to 20 prior changes and roughly 32 MiB, retaining one previous full drawing for a larger change. It is not an infinite durable edit history. Durable document revisions remain governed by the existing library storage contract.

The editor only assigns a decoded drawing after successful PencilKit decoding. Corrupt/unsupported bytes remain unchanged and display an unavailable state; editing text in the note does not replace those bytes. Read-only migration notes cannot mutate drawing content. Switching note identity clears session undo so one note cannot recover another note's drawing.

Drawing changes use the library's coalesced persistence queue. A failed write retains the original durable document and the newest in-memory drawing with a visible save error/retry path. Keep the app open when a save fails, free storage and retry. This does not promise recovery of changes that never reached storage after force termination. Serialization still encodes PencilKit data on the main actor, while durable JSON writes run through the repository actor; large real drawings and sustained sessions need device measurement before release qualification.

## Verification and Check this:

Automated unit fixtures use nonempty PencilKit strokes, edit/undo/redo/reopen, gesture grouping, repeated layout loads, corrupt/read-only preservation, cross-note history isolation, and a synthetic failed-write/retry/reopen path. UI fixtures use only the dedicated `--ui-testing` library. `--ink-fixture` exposes a DEBUG-only sample-drawing command and synthetic transcript; it never reads a user's drawing or sends network data.

Generate and run focused tests:

```sh
xcodegen generate --spec apps/mobile-native/project.yml
xcodebuild test -project apps/mobile-native/DoodleNoteNative.xcodeproj -scheme DoodleNoteNative -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' -derivedDataPath /tmp/ony247-derived CODE_SIGNING_ALLOWED=NO -only-testing:DoodleNoteNativeTests/InkEditingTests -only-testing:DoodleNoteNativeUITests/PencilEditingUITests
```

Check this on an authorized physical iPad/Pencil and keyboard, plus an iPhone:

1. Create a note, write personal text using the keyboard and system Scribble, then draw with pressure and palm contact. Expect editable strokes and personal text to remain separate, with no automatic OCR of saved ink.
2. Draw several strokes, erase/select/move a stroke, undo/redo, switch panes and rotate. Expect complete gestures to undo, original strokes to survive and recording controls to remain reachable. Relaunch after saved status and confirm ink remains editable.
3. Start an authorized test recording, switch notes/ink and navigate away. Expect recording to continue explicitly, live transcript to remain usable, and returning to the note to retain edits. Check recording-stop access with the keyboard visible.
4. Use Command-1/2/3/4 and drawing Command-Z/Shift-Command-Z. Expect correct focus, no drawing/text cross-undo and no unexpected recording command.
5. Increase Dynamic Type, enable VoiceOver and use iPad split-screen plus iPhone portrait/landscape. Expect reachable labeled tools, navigable content and scrollable drawing. Inspect large drawings, zoom extremes and save-failure retry on test data.

Physical Scribble, pressure, palm rejection, Pencil latency, keyboard/VoiceOver ergonomics and long-session memory/storage behavior are not established by simulator tests. Sean's exact iPad/Pencil generation remains unknown; magnetic charging does not establish hover or model-specific gesture support. No such capability is claimed or required by this implementation. The provisional iOS/iPadOS 26 development floor remains unchanged and ONY-241/ONY-265 continue to gate release device compatibility and qualification. Source development proceeds under Sean's explicit sequencing exception; no physical QA is marked complete.

Primary implementation references: [PencilKit canvas](https://developer.apple.com/documentation/pencilkit/pkcanvasview), [PencilKit drawing](https://developer.apple.com/documentation/pencilkit/pkdrawing), and installed iOS 26 SDK UIScribbleInteraction/PKCanvasView declarations. System Scribble is an input capability of supported system text controls, not an ink-to-text conversion service in DoodleNote.
