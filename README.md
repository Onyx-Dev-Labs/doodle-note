# Doodle Note

A Granola-style AI meeting notepad — no bot joins your calls. A macOS desktop app
captures mic + system audio locally, transcribes on-device (Parakeet/Whisper),
and merges your rough notes with the transcript into polished meeting notes
using your own AI key or a fully-local model.

## Layout

- `engine/` — Swift sidecar: audio capture + on-device ASR. Emits NDJSON events on stdout.
- `apps/desktop/` — Electron app (React + TipTap). Spawns the engine, owns the notes UX.
- `apps/web/` — Next.js SaaS shell: workspaces, shared notes, chat. Deploys to Vercel.
- `packages/db/` — Drizzle ORM schema (Neon Postgres + pgvector; PGlite for local dev).

## Dev

```sh
pnpm install
pnpm dev              # web + desktop via turbo
pnpm engine:build     # swift build -c release --package-path engine
```

Engine requires Apple Silicon + macOS 14+. ASR models download to the user
cache on first run (~440MB for Parakeet TDT v2).
