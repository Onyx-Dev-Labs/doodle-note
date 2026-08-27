import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { neon } from "@neondatabase/serverless";
import {
  drizzle as drizzleNeon,
  type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import {
  drizzle as drizzlePglite,
  type PgliteDatabase,
} from "drizzle-orm/pglite";

import * as authSchema from "./auth-schema";
import * as schema from "./schema";

/** Product tables + Better Auth tables, as one schema object. */
export const fullSchema = { ...schema, ...authSchema };

export type FullSchema = typeof fullSchema;

export type Db = NeonHttpDatabase<FullSchema> | PgliteDatabase<FullSchema>;

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * The singleton lives on globalThis rather than module scope: bundlers (e.g.
 * Next.js) can include a separate copy of this module per server chunk, and
 * two PGlite instances over the same data directory do not see each other's
 * writes. globalThis is shared per process, so every copy gets the same client.
 */
const globalForDb = globalThis as typeof globalThis & { __repoDbClient?: Db };

type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * Local development may use PGlite, but a production server must use a
 * durable PostgreSQL database. Failing here prevents a misconfigured deploy
 * from silently serving an isolated, ephemeral local database.
 */
export function resolveDatabaseUrl(
  env: RuntimeEnvironment = process.env,
): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  // Next.js imports server modules while compiling route bundles. A build is
  // not a running production service, so use an in-memory client for that
  // process only. The deployed runtime still fails closed below.
  if (env.NEXT_PHASE === "phase-production-build") return null;
  if (env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }
  return null;
}

/**
 * Returns a lazily-created, memoized Drizzle client.
 *
 * - If DATABASE_URL is set, connects to PostgreSQL over the Neon HTTP driver.
 * - In non-production environments, otherwise falls back to PGlite persisted at
 *   PGLITE_DATA_DIR (or packages/db/.pglite/) so everything runs without Neon.
 */
export function getDb(): Db {
  if (!globalForDb.__repoDbClient) {
    const url = resolveDatabaseUrl();
    globalForDb.__repoDbClient = url
      ? drizzleNeon(neon(url), { schema: fullSchema })
      : drizzlePglite(
          process.env.NEXT_PHASE === "phase-production-build"
            ? new PGlite()
            : new PGlite(
                process.env.PGLITE_DATA_DIR ??
                  path.join(packageRoot, ".pglite"),
              ),
          { schema: fullSchema },
        );
  }
  return globalForDb.__repoDbClient;
}

export { schema, authSchema };
