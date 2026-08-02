# DoodleNote iOS

Native SwiftUI app (iOS 26+, iPhone-first): record in-person meetings, transcribe
on-device, generate notes with on-device AI, and sync with your DoodleNote
workspace.

## Architecture

- **`DoodleNote/Models.swift`** — SwiftData store (`Meeting`, `Segment`). IDs are
  device-minted UUIDs shared with the cloud, same as desktop.
- **`Recording/`** — `RecordingController` (AVAudioEngine mic tap) feeding a
  `TranscriptionProvider`:
  - `AppleSpeechProvider` (default) — SpeechAnalyzer/SpeechTranscriber, iOS 26.
    System-managed language assets, no download UX.
  - `ParakeetProvider` — FluidAudio `StreamingUnifiedAsrManager`, the same
    Parakeet models as the Mac engine (~440 MB download on first use).
    Selectable in Settings.
- **`AI/`** — `NotePrompt` is a port of `packages/ai/src/prompt.ts` +
  `templates.ts` (single-speaker attribution rule for in-person recordings).
  Engines: `FoundationModelsEngine` (Apple on-device model, default) and
  `AnthropicEngine` (BYOK, key in Keychain).
- **`Sync/`** — `SyncAPI` (typed client for `/api/sync/*`, `dnsy_` Bearer token)
  and `SyncEngine` (push-then-pull cycle, local-edits-win conflict rule,
  `allIds` deletion reconciliation — a simplified port of
  `apps/desktop/src/main/sync-service.ts`). Linking uses
  system Safari → `/link-device?scheme=doodlenote` →
  `doodlenote://link?token=…` (web-side support in
  `apps/web/app/link-device`).

## Build

The Xcode project is generated — edit `project.yml`, not the `.xcodeproj`.

```sh
brew install xcodegen        # once
cd apps/ios
xcodegen generate
xcodebuild -project DoodleNote.xcodeproj -scheme DoodleNote \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build

# UI smoke test (launch → record → stop → notes)
xcodebuild -project DoodleNote.xcodeproj -scheme DoodleNote \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

Or open `DoodleNote.xcodeproj` in Xcode and run. Signing is automatic with the
team set in `project.yml`.

## Notes

- Point sync at a local web server with the `DOODLE_SYNC_URL` env var
  (Xcode scheme → Run → Environment Variables), mirroring the desktop app.
- Foundation Models requires Apple Intelligence to be enabled; the app falls
  back with a clear error directing users to BYOK otherwise.
- Simulator caveat: speech assets and Apple Intelligence are often unavailable
  in simulators — full recording/notes verification needs a physical device.
