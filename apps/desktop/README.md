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

## Record from the macOS menu bar

After setup and the welcome tour, the dog icon offers **Record now** even with
no calendar account or upcoming meeting. It opens the normal meeting editor and
starts capture with the existing microphone, audio persistence and system-audio
settings. The menu disables new starts during preparation, recording and finalization.
Closing the main window during capture hides it to preserve the active document;
closing an idle window destroys it, and the next tray action recreates it.

The optional calendar countdown retains its own menu and preference. Contributor
PR #119's capture-only timer is independent and is not included here. The dog menu
adds no duplicate Stop action or timer. Windows has no new tray or close-to-tray
behavior. The start coordinator also serializes calendar/banner and normal new
meeting actions, and the optional CalendarService callback is the integration
point for ONY-269's desktop prompt.

Native wiring QA can run after `pnpm --filter desktop build` using a separately
installed Playwright runtime:

```sh
DOODLE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
  node apps/desktop/scripts/test-recording-tray.cjs
```

This harness loads the real main/preload/renderer with a synthetic engine in an
isolated temporary profile. It never captures audio or downloads models. It checks
setup eligibility, one-click capture routing, remembered input, repeated starts,
visible/minimized/closed windows, failure recovery and both native icon resolutions.
It reports the screenshot directory. Native menu activation is scheduled outside
inspector evaluation to avoid a macOS Electron 44 inspector crash during window
creation. This does not prove real microphone/system-audio capture, transcription,
OS permission recovery, native menu keyboard access or light/dark menu-bar contrast.

Human QA: run `pnpm engine:build` then `pnpm --filter desktop dev` with a dedicated
`DOODLE_USER_DATA` profile. Complete setup, select a non-default available mic, and
use safe test speech. With no calendar, activate the dog menu and Record now with
the window visible, minimized, then closed while the app runs. Expect one new
recording per idle activation; rapid clicks and clicks while finishing must not
create another. Stop and reopen each meeting: confirm the saved audio/transcript.
Check permission denial/unavailable engine recovery, both menu-bar appearances,
scaled/Retina displays, keyboard menu operation, calendar countdown coexistence,
and quitting during capture. Packaging, release and installed-version evidence
remain separate approval gates under `docs/RELEASING.md`.
