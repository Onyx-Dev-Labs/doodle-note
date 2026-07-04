# desktop

Electron dev console for the Doodle Note transcription sidecar. Spawns
`engine/.build/release/engine` (build it with `pnpm engine:build` from the repo
root) and renders its live NDJSON transcript stream.

## Commands (run from repo root)

```bash
pnpm install                     # workspace install (also fetches the Electron binary)
pnpm --filter desktop dev       # electron-vite dev with HMR
pnpm --filter desktop build     # electron-vite build → out/
pnpm --filter desktop typecheck # tsc for node (main/preload) + web (renderer)
```

Packaging (electron-builder) is intentionally not wired up yet.
