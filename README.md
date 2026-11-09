<div align="center">
  <a href="https://www.doodlenote.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/images/brand/doodlenote-paper-horizontal.png">
      <img src="docs/images/brand/doodlenote-forest-horizontal.png" alt="DoodleNote" width="460">
    </picture>
  </a>

  <p><strong>Privacy-first, local-first meeting capture, AI notes, and built-in Bark dictation. No meeting bot required.</strong></p>

  <p>
    <a href="https://www.doodlenote.ai"><img alt="macOS: Apple Silicon" src="https://img.shields.io/badge/macOS-Apple%20Silicon-303E31?logo=apple&logoColor=white"></a>
    <a href="https://www.doodlenote.ai"><img alt="Windows 10 and 11: beta" src="https://img.shields.io/badge/Windows-10%20%2F%2011%20beta-303E31?logo=windows&logoColor=white"></a>
    <a href="https://www.doodlenote.ai"><img alt="iOS: beta" src="https://img.shields.io/badge/iOS-beta-303E31?logo=apple&logoColor=white"></a>
    <a href="https://discord.gg/2tjEBUcTr"><img alt="Community: Discord" src="https://img.shields.io/badge/community-Discord-303E31?logo=discord&logoColor=white"></a>
    <a href="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/mobile-native.yml"><img alt="iOS" src="https://github.com/Onyx-Dev-Labs/doodle-note/actions/workflows/mobile-native.yml/badge.svg"></a>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-40563C.svg"></a>
    <a href="https://www.doodlenote.ai"><img alt="Website" src="https://img.shields.io/badge/doodlenote.ai-40563C"></a>
  </p>

  <p>
    <img src="docs/images/screenshots/doodlenote-home.png" alt="The DoodleNote home screen: recent meetings, folders, calendar, and Ask anything" width="900">
  </p>
</div>

DoodleNote captures your microphone and the other side of a call on your computer, transcribes the conversation on-device, and combines the transcript with your rough notes into a useful meeting record. Audio stays on your device. Optional Sync uploads the meeting content you choose, but not the recording audio.

DoodleNote runs on **macOS** and **Windows**, and **Bark**, its built-in dictation, types what you say into any app on your Mac.

## On macOS and Windows

|                                                    | macOS                            | Windows                                              |
| -------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| Status                                             | Supported                        | Beta                                                 |
| Requires                                           | Apple Silicon, macOS 14 or later | Windows 10/11, 64-bit                                |
| Meeting capture, local transcription, and AI notes | Yes                              | Yes                                                  |
| Bark dictation                                     | Yes                              | Not available                                        |
| Installer                                          | Signed and notarized             | Unsigned beta; SmartScreen warns before installation |

The screenshots below show the macOS app.

## See DoodleNote in action

### Start private and local

The app introduces the local-first workflow before you record your first meeting. No bot joins the call, and cloud sync stays optional.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-welcome.png" alt="DoodleNote welcome screen: no bot joins your calls, transcription and notes run on-device, and no account is needed" width="560">
</p>

### Find every meeting and note

The overview keeps recent meetings, quick notes, folders, search, and upcoming calendar events in one place, with the light and dark themes that follow your system.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-home.png" alt="DoodleNote overview in the light theme with recent meetings, folders, and a next-steps sticky note" width="900">
</p>

<p align="center">
  <img src="docs/images/screenshots/doodlenote-home-dark.png" alt="DoodleNote overview in the dark theme" width="900">
</p>

### Turn the conversation into useful notes

Generate a polished summary with decisions, action items, owners, and the next meeting while keeping your original notes one tab away.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-enhanced-notes.png" alt="DoodleNote meeting notes with a summary, decisions, and action items" width="900">
</p>

### Review exactly what was said

DoodleNote transcribes both sides locally, keeps speaker labels editable, and preserves timestamps for quick review.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-transcript.png" alt="DoodleNote meeting notes beside a transcript with named speakers and timestamps" width="900">
</p>

### Ask anything about your meetings

Ask a question from the overview and get an answer grounded in your recent meetings' notes.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-ask-anything.png" alt="DoodleNote answering a question about the free-tier banner and the press kit using recent meetings" width="900">
</p>

### Bark: dictation anywhere on your Mac

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/brand/bark-white-horizontal.png">
    <img src="docs/images/brand/bark-pine-horizontal.png" alt="Bark" width="220">
  </picture>
</p>

Press a shortcut in any app, speak, and Bark types your words into the field you were using. Speech is recognized on your Mac, audio is never kept, and Bark stays off until you turn it on in Settings. Pick press-to-toggle or hold-to-talk, tidy dictated text with Light or Full cleanup, set a tone for each app, and keep a personal dictionary that learns from your corrections. Bark is available on macOS with Apple Silicon.

<p align="center">
  <img src="docs/images/screenshots/doodlenote-bark.png" alt="DoodleNote Settings, Bark page: the Bark switch and keyboard shortcut options" width="900">
</p>

## Why DoodleNote

- **No bot in the call.** Capture works from your side with any meeting app.
- **On-device transcription.** Apple Silicon uses the Swift/FluidAudio engine; Windows uses a packaged local speech engine.
- **Bark dictation on Mac.** Speak into any app and have the text typed for you, recognized on your Mac with no audio kept.
- **Local or bring-your-own AI.** Generate notes with a downloaded local model or your own provider key.
- **Notes that stay useful.** Edit rich notes, organize meetings into folders, search history, and ask questions across prior meetings.
- **Capture at the right moment.** Calendar and microphone-aware prompts help you start and stop recordings without stacking notifications.
- **Optional cloud features.** Sync across devices, share selected meetings, and collaborate in workspaces when you opt in.
- **Agent access under your control.** An opt-in, read-only MCP server lets compatible AI tools search local notes and transcripts.

## Get DoodleNote

Download the current desktop installers from
[doodlenote.ai](https://www.doodlenote.ai). Official macOS releases support
Apple Silicon on macOS 14 or later and are signed and notarized. The Windows
10/11 build is currently beta. Its checked-in packaging configuration is
unsigned, so Windows SmartScreen warns before installation.

The local app is free, requires no DoodleNote account, and does not impose
meeting limits. Hosted Sync is optional and costs $10 per user per month.

## Project status

| Surface         | Status         | Notes                                                                                                                                              |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS desktop   | Supported      | Apple Silicon, macOS 14 or later; official releases distributed through [doodlenote.ai](https://www.doodlenote.ai) are signed and notarized.       |
| Windows desktop | Beta           | Windows 10/11, 64-bit; packaging and native-module smoke checks run in CI. The current checked-in configuration is unsigned, so SmartScreen warns. |
| iPhone          | In development | Fresh iPhone/iPad app in apps/mobile-native; iOS 26 prototype, with physical-device and release gates open.                                        |
| Web workspace   | In development | Next.js app for account linking, sync, sharing, workspaces, and hosted agent access.                                                               |

Public release history is available in [GitHub Releases](https://github.com/Onyx-Dev-Labs/doodle-note/releases) and the [DoodleNote changelog](https://www.doodlenote.ai/changelog). Maintainer release procedures are documented in [docs/RELEASING.md](docs/RELEASING.md).

## Repository map

```text
.github/                 CI, CodeQL, iOS, and release workflows and community configuration
apps/
  desktop/                Electron + React desktop application
  mobile-native/          Fresh SwiftUI iPhone/iPad implementation
  ios/                    Historical iOS implementation; not used for fresh mobile work
  web/                    Next.js cloud workspace and public site
docs/                    Brand, open-source, release, and screenshot documentation
engine/                   Swift audio capture and on-device ASR sidecar
packages/
  agent-contract/         Shared MCP tool schemas
  ai/                     Local and cloud note-generation engines
  db/                     Drizzle schema, migrations, Neon/PGlite clients
  doodle-note-mcp/        Opt-in read-only local MCP server
  meetings-store/         Shared meeting persistence contracts
```

## Development

### Prerequisites

- Node.js 22.12.0 or later
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

For a durable production deployment of the Sync server, follow
[SELF-HOSTING.md](SELF-HOSTING.md). Production installations require an
explicit authentication secret and must either configure Stripe or declare
themselves self-hosted.

For fresh iPhone/iPad setup, see [apps/mobile-native/README.md](apps/mobile-native/README.md). For the engine protocol and commands, see [engine/README.md](engine/README.md).

## Verification

Run the checks relevant to your change before opening a pull request:

```sh
pnpm --filter desktop typecheck
pnpm --filter desktop test
pnpm --filter doodle-note-mcp test
pnpm --filter @repo/ai test
pnpm --filter @repo/db test
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm lint
pnpm audit --audit-level=low
pnpm engine:build
```

CI also builds the Windows installer and smoke-tests its packaged native speech and local-model modules.

## Privacy and responsible recording

DoodleNote is designed so local capture, transcription, storage, and AI generation can run without sending meeting audio to DoodleNote servers. Cloud sync, shared links, hosted agent access, external AI providers, calendars, and connectors are opt-in features with their own data flows.

Recording and consent laws vary by location and organization. You are responsible for obtaining any required permission before recording or transcribing a conversation.

## Community

Join the [DoodleNote community on Discord](https://discord.gg/2tjEBUcTr) for help, updates, and testing, or open **Join our community** in the app's sidebar. Community help is best-effort; [SUPPORT.md](SUPPORT.md) explains what the public repository does and does not cover.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

For product and community support boundaries, see [SUPPORT.md](SUPPORT.md).

Brand assets and usage notes live in [docs/BRAND.md](docs/BRAND.md).
The DoodleNote name and mascot are reserved; see [TRADEMARK.md](TRADEMARK.md).

## License

DoodleNote is available under the [MIT License](LICENSE). The local
apps are free forever. Official cloud Sync at
[doodlenote.ai](https://www.doodlenote.ai) is an optional paid backup
and multi-device service ($10 / user / month). See
[docs/OPEN-SOURCE.md](docs/OPEN-SOURCE.md).

Libraries, speech models, and optional local AI models retain their own
licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before
redistributing a build.
