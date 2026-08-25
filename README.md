<div align="center">
  <a href="https://www.doodlenote.ai">
    <img src="apps/desktop/resources/doodlenote-logo.png" alt="DoodleNote — Think it. Doodle it. Done." width="420">
  </a>

  <p><strong>Private, local-first meeting capture and AI notes. No meeting bot required.</strong></p>

  <p>
    <a href="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ios.yml"><img alt="iOS" src="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ios.yml/badge.svg"></a>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-506941.svg"></a>
    <a href="https://www.doodlenote.ai"><img alt="Website" src="https://img.shields.io/badge/doodlenote.ai-506941"></a>
  </p>
</div>

DoodleNote captures your microphone and the other side of a call on your computer, transcribes the conversation on-device, and combines the transcript with your rough notes into a useful meeting record. Audio stays on your device unless you explicitly choose to sync or share.

## Why DoodleNote

- **No bot in the call.** Capture works from your side with any meeting app.
- **On-device transcription.** Apple Silicon uses the Swift/FluidAudio engine; Windows uses a packaged local speech engine.
- **Local or bring-your-own AI.** Generate notes with a downloaded local model or your own provider key.
- **Notes that stay useful.** Edit rich notes, organize meetings into folders, search history, and ask questions across prior meetings.
- **Capture at the right moment.** Calendar and microphone-aware prompts help you start and stop recordings without stacking notifications.
- **Optional cloud features.** Sync across devices, share selected meetings, and collaborate in workspaces when you opt in.
- **Agent access under your control.** An opt-in, read-only MCP server lets compatible AI tools search local notes and transcripts.

## Project status

| Surface         | Status         | Notes                                                                                                                 |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| macOS desktop   | Supported      | Apple Silicon, macOS 14 or later; signed releases are distributed through [doodlenote.ai](https://www.doodlenote.ai). |
| Windows desktop | Beta           | Windows 10/11, 64-bit; packaging and native-module smoke checks run in CI.                                            |
| iPhone          | In development | Native SwiftUI app targeting iOS 26; full recording verification requires a physical device.                          |
| Web workspace   | In development | Next.js app for account linking, sync, sharing, workspaces, and hosted agent access.                                  |

Signed desktop downloads are published at [doodlenote.ai](https://www.doodlenote.ai). Versioned release checklists in this repository (`RELEASE-v*.md`) record what shipped.

## Repository map

```text
apps/
  desktop/                Electron + React desktop application
  ios/                    Native SwiftUI iPhone application
  web/                    Next.js cloud workspace and public site
engine/                   Swift audio capture and on-device ASR sidecar
packages/
  ai/                     Local and cloud note-generation engines
  agent-contract/         Shared MCP tool schemas
  connectors/             Optional export connectors
  db/                     Drizzle schema, migrations, Neon/PGlite clients
  doodle-note-mcp/        Opt-in read-only local MCP server
  meetings-store/         Shared meeting persistence contracts
```

## Development

### Prerequisites

- Node.js 22 or later
- pnpm 10.33.2 (Corepack is recommended)
- macOS 14+ on Apple Silicon and Xcode/Swift for the native transcription engine
- XcodeGen and Xcode 26 for iOS work

### Start the workspace

```sh
corepack enable
pnpm install --frozen-lockfile

# Desktop app (build the Mac engine first)
pnpm engine:build
pnpm --filter desktop dev

# Web workspace on http://localhost:4040
pnpm --filter web dev
```

The web app works locally without cloud credentials by using PGlite and a development-only auth secret. Optional integrations are disabled until their environment variables are configured; see [apps/web/README.md](apps/web/README.md).

For native iPhone setup, see [apps/ios/README.md](apps/ios/README.md). For the engine protocol and commands, see [engine/README.md](engine/README.md).

## Verification

Run the checks relevant to your change before opening a pull request:

```sh
pnpm --filter desktop typecheck
pnpm --filter desktop test
pnpm --filter doodle-note-mcp test
pnpm --filter @repo/ai test
pnpm --filter web typecheck
pnpm --filter web test
pnpm engine:build
```

CI also builds the Windows installer and smoke-tests its packaged native speech and local-model modules.

## Privacy and responsible recording

DoodleNote is designed so local capture, transcription, storage, and AI generation can run without sending meeting audio to DoodleNote servers. Cloud sync, shared links, hosted agent access, external AI providers, calendars, and connectors are opt-in features with their own data flows.

Recording and consent laws vary by location and organization. You are responsible for obtaining any required permission before recording or transcribing a conversation.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Brand assets and usage notes live in [docs/BRAND.md](docs/BRAND.md).
The DoodleNote name and mascot are reserved; see [TRADEMARK.md](TRADEMARK.md).

## License

DoodleNote is available under the [MIT License](LICENSE). The local
apps are free forever. Official cloud Sync at
[doodlenote.ai](https://www.doodlenote.ai) is an optional paid backup
and multi-device service ($10 / user / month). See
[docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md).
