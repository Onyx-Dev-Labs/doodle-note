# DoodleNote — Project Handoff / Status

_Last updated: 2026-07-05_

## What this is
**DoodleNote** — a Granola-style, **local-first** AI meeting notepad (macOS desktop + web dashboard).
A no-bot desktop app captures mic + system audio locally, transcribes on-device, and merges your
rough notes with the transcript into polished meeting notes using a **local AI model** (downloaded
in-app) by default, or your own cloud API key. Nothing leaves the Mac unless the user opts into cloud sync.

- **One word:** "DoodleNote" (logo = doodle-dog mascot; "Doodle" ink + "Note" sage green).
- **Repo folder:** `~/Documents/granola-dupe` (NOT renamed — paths depend on it).
- **GitHub:** https://github.com/spinman-ITS/doodle-note
- **Active branch:** `feat/doodlenote-ui-redesign` — **contains the entire modern app.**
  **PR #1 is open and NOT yet merged to `main`.** Merging is the standing next action.

## Stack / layout (Turborepo + pnpm monorepo, Node 22, pnpm 10.33.2)
- `engine/` — **Swift** transcription sidecar. FluidAudio 0.15.4, NVIDIA Parakeet CoreML models.
  Commands: `transcribe` (batch, ~120x realtime), `stream`, `live` (two-channel), `preflight`
  (warm models + permissions at launch), `info`. Speaks **NDJSON on stdout** (see `engine/README.md`).
  Mic channel = "You", ScreenCaptureKit system audio = "Them". Build: `pnpm engine:build`.
- `apps/desktop/` — **Electron 43 + React + TipTap**. The product UI. Light cream/sage theme.
- `apps/web/` — **Next.js 16 App Router**, runs on **port 4040**. Better Auth + organizations.
  The future cloud dashboard / landing page. PGlite for local dev, Neon for prod.
- `packages/db/` — **Drizzle ORM** schema + migrations (meetings, transcript_segments, notes,
  workspaces + Better Auth tables). Neon serverless driver when `DATABASE_URL` set, else PGlite.
- `packages/ai/` — **local-first notes engine.** node-llama-cpp (GGUF, Metal) + cloud (AI SDK v7).
  Prompts: `prompt.ts` (merge), `ask-prompt.ts` (per-meeting chat), `global-ask-prompt.ts` (cross-meeting).

## Local model catalog (packages/ai/src/catalog.ts, HF URIs verified)
- **Fast:** Qwen3-4B-Instruct Q4_K_M (~2.4GB, 8GB RAM)
- **Balanced:** Llama-3.1-8B-Instruct Q4_K_M (~4.9GB, 16GB RAM)
- **Quality:** Gemma-3-12B-it Q4_K_M (~7.3GB, 24GB RAM) — Sean's Mac (24GB) defaults here

## Features shipped & verified
- Two-channel local live transcription (mic=You / system=Them), echo dedup, per-token timings
- Notes editor (TipTap) + **AI note generation** ("Generate notes", local model ~8s, verified)
- **Per-meeting chat** ("Ask anything" in editor) + **global cross-meeting chat** (Home ask bar,
  "List recent todos"), both grounded/cited, persisted, with **Copy response**
- **Auto-record** on "+ New meeting"; stop = pause + Resume; "Generate notes" CTA
- **Folders + Trash** (sidebar, row ⋯ menu, folder picker, restore/delete-forever/empty)
- **Microsoft 365 calendar**: one-click "Sign in with Microsoft" (built-in app reg, `common`
  authority — any work/school/personal account), Coming-up card (per-calendar colors, day rail,
  paging), **menu-bar countdown** ("◷ Team Meeting in 12m"), **meeting-start prompts** (notification
  + banner → auto-titled meeting + auto-record), Settings (visible-calendars picker, display toggles)
- **Packaged app**: `/Applications/DoodleNote.app` (native dock icon, unsigned local build)
- Google sign-in button present but **greyed "coming soon"**

## How to run / build
- Desktop dev: `pnpm --filter desktop dev` (or run the installed `/Applications/DoodleNote.app`)
- Web dev: `pnpm --filter web dev` → http://localhost:4040
- Rebuild + reinstall the packaged app: `pnpm --filter desktop package` then
  `ditto apps/desktop/release/mac-arm64/DoodleNote.app /Applications/DoodleNote.app`
- Gate checks (must stay green): `pnpm --filter desktop typecheck | build | test` (28 tests),
  `pnpm --filter @repo/ai typecheck`, `pnpm --filter web build | typecheck | auth-smoke`,
  `pnpm --filter @repo/db smoke`

## IN PROGRESS: cloud setup (Sean is doing the console steps)
- **Vercel project**: import `spinman-ITS/doodle-note`, **Root Directory = `apps/web`** (preset →
  Next.js). Env: import `apps/web/.env` (gitignored; already created with a fresh
  `BETTER_AUTH_SECRET` + `MICROSOFT_CLIENT_ID`).
- **Database = Neon** (decided over Supabase/Convex — stack is already wired for it). **Neon Auth OFF**
  (Better Auth owns auth). Add via Vercel Marketplace so `DATABASE_URL` auto-injects, OR paste the
  connection string into Vercel env as `DATABASE_URL`.
- **Microsoft app registration** (id `d270c2a7-6e58-424b-baed-6fd33c56c606`): add a **Web** platform
  with redirect `https://<prod-domain>/api/auth/callback/microsoft` and
  `http://localhost:4040/api/auth/callback/microsoft`; create a **client secret** →
  `MICROSOFT_CLIENT_SECRET` in Vercel. One Microsoft SSO = cloud account + Calendars.Read.

## NEXT MILESTONES (rough order)
1. **Merge PR #1** to main
2. Run DB migrations against Neon; wire **Microsoft SSO** into the web login (Better Auth
   `microsoft` provider, `tenant: 'common'`) with the official-logo button
3. **Cloud sync**: desktop signs in, pushes meetings/segments/notes to Neon, web dashboard shows
   the library, real Share / Copy-link buttons, transcript-link footer in generated notes
4. Google Calendar integration (button already stubbed)
5. Note templates + "recipes" gallery (prompt library)
6. Code signing + notarization + auto-update (needs Apple Developer account)
7. Persistent engine (load models once at launch — kills per-session warm-up)

## Gotchas / hard-won lessons (do not relearn these)
- **Unsigned build** → macOS Keychain secrets (calendar tokens, AI keys via `safeStorage`) can
  invalidate across rebuilds (ad-hoc signature changes). Users re-sign-in after an update. Fixed by
  real code signing later.
- Packaged app and dev **share** userData dir `~/Library/Application Support/desktop` (Electron
  derives it from the internal package name "desktop"). Data carries over automatically.
- **Engine event log**: `~/Library/Application Support/desktop/engine-events.log` — read it to
  diagnose failed capture sessions instead of reproducing.
- CoreML prints non-JSON noise to stdout; NDJSON parsers must skip unparseable lines.
- `meetings-service.normalizeRecord()` rebuilds records field-by-field — **every new MeetingRecord
  field needs explicit validated passthrough** or it's silently dropped.
- `node-llama-cpp` is ESM-only w/ top-level await → must be **lazy `import()`**ed (CJS main bundle
  can't `require()` it); keep it external in electron-vite main build; `@repo/ai` bundled.
- Live capture: **AEC is opt-in** (`--aec on`); Apple VPIO fails to init on macOS 26, dedup covers
  echo. Signal handlers must arm before model warm-up or an early Stop kills the session silently.

## What needs Sean (blockers for the assistant)
- Merge decision on PR #1
- Vercel MCP auth (`/mcp` in an interactive session) to let the assistant drive Vercel directly
- Neon `DATABASE_URL` (to run migrations)
- Microsoft **client secret** (for web SSO)
- Later: Google OAuth client (Google calendar), Apple Developer account (signing)
