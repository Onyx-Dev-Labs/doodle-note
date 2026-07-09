import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Pin the monorepo root so Turbopack doesn't mis-infer it when this repo
   * is checked out inside another (git worktrees under .claude/worktrees) —
   * a wrong root breaks next/font resolution.
   */
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  /**
   * Next allows one dev server per dist dir; a second session (agent preview)
   * can set NEXT_DIST_DIR to run alongside the primary `pnpm dev` server.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /** @repo/db ships raw TypeScript — let Next transpile it. */
  transpilePackages: ["@repo/db", "@repo/agent-contract"],
  /**
   * PGlite loads its WASM/data payloads relative to the module on disk, so it
   * must stay a native `require` instead of being bundled into the server
   * build. Only used as the local dev fallback when DATABASE_URL is unset.
   */
  serverExternalPackages: ["@electric-sql/pglite"],
  /**
   * Old links (pre-doodlenote.ai builds, minted share links, the What's-new
   * link in installed apps) land on the vercel.app alias — bounce PAGE
   * routes to the branded domain. /api and /updates are excluded on
   * purpose: installed desktop apps call them with bearer tokens, and
   * fetch strips Authorization headers on cross-origin redirects.
   */
  async redirects() {
    return [
      {
        source: "/:path((?!api/|updates/).*)",
        has: [{ type: "host" as const, value: "doodle-note.vercel.app" }],
        destination: "https://www.doodlenote.ai/:path",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
