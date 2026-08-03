# DoodleNote desktop

The Electron desktop app is DoodleNote's primary capture and notes experience. It combines a React/TipTap renderer with platform-native local transcription:

- macOS spawns the Swift engine in `engine/` for microphone and system-audio capture;
- Windows captures locally and transcribes with packaged sherpa-onnx models;
- both platforms store meetings locally, generate notes with local or bring-your-own AI, and can opt into sync and agent access.

## Run locally

From the repository root:

```sh
pnpm install --frozen-lockfile

# Required for macOS capture/transcription
pnpm engine:build

pnpm --filter desktop dev
```

The macOS engine requires Apple Silicon and macOS 14 or later. The first capture requests Microphone and Screen & System Audio Recording permissions and downloads the selected transcription model to the user cache.

## Commands

```sh
pnpm --filter desktop dev         # electron-vite with renderer HMR
pnpm --filter desktop typecheck   # main/preload and renderer TypeScript
pnpm --filter desktop test        # Node test suite
pnpm --filter desktop build       # production Electron bundles
pnpm --filter desktop package     # macOS app, ZIP, and DMG
pnpm --filter desktop package:win # Windows NSIS installer
pnpm --filter desktop brand:build # regenerate platform brand assets
```

Packaging requires the platform's native dependencies. Maintainer release commands additionally require the appropriate Apple or Windows signing credentials and publication token; contributors do not need them for normal development, typechecks, tests, or production bundle builds.

## Important boundaries

- Local meetings and settings live under Electron's per-user application-data directory. Use sanitized fixtures in tests and bug reports.
- The local MCP server is disabled until the user explicitly enables Agent access in Settings; it remains read-only.
- Cloud sync, external AI providers, calendars, connectors, and update publication are separate opt-in or maintainer-configured paths.
- Never commit generated release artifacts, local meeting stores, OAuth tokens, provider keys, or signing material.
