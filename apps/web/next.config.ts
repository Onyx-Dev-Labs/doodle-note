import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** @repo/db ships raw TypeScript — let Next transpile it. */
  transpilePackages: ["@repo/db"],
  /**
   * PGlite loads its WASM/data payloads relative to the module on disk, so it
   * must stay a native `require` instead of being bundled into the server
   * build. Only used as the local dev fallback when DATABASE_URL is unset.
   */
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
