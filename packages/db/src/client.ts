import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";

import * as authSchema from "./auth-schema";
import * as schema from "./schema";

/** Product tables + Better Auth tables, as one schema object. */
export const fullSchema = { ...schema, ...authSchema };

export type FullSchema = typeof fullSchema;

export type Db = NeonHttpDatabase<FullSchema> | PgliteDatabase<FullSchema>;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The singleton lives on globalThis rather than module scope: bundlers (e.g.
 * Next.js) can include a separate copy of this module per server chunk, and
 * two PGlite instances over the same data directory do not see each other's
 * writes. globalThis is shared per process, so every copy gets the same client.
 */
const globalForDb = globalThis as typeof globalThis & { __repoDbClient?: Db };

/**
 * Returns a lazily-created, memoized Drizzle client.
 *
 * - If DATABASE_URL is set, connects to Neon over HTTP (@neondatabase/serverless).
 * - Otherwise falls back to a local PGlite instance persisted at
 *   packages/db/.pglite/ so everything runs without a Neon database.
 */
export function getDb(): Db {
  if (!globalForDb.__repoDbClient) {
    const url = process.env.DATABASE_URL;
    globalForDb.__repoDbClient = url
      ? drizzleNeon(neon(url), { schema: fullSchema })
      : drizzlePglite(new PGlite(path.join(packageRoot, ".pglite")), { schema: fullSchema });
  }
  return globalForDb.__repoDbClient;
}

export { schema, authSchema };
