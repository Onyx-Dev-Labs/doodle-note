import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { fullSchema } from "./client";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface InMemoryDb {
  /** Drizzle client over a fresh in-memory PGlite with all migrations applied. */
  db: ReturnType<typeof drizzle<typeof fullSchema>>;
  close: () => Promise<void>;
}

/**
 * Creates a fresh in-memory PGlite database and applies every migration in
 * packages/db/drizzle. Nothing touches disk — intended for smoke tests.
 */
export async function createInMemoryDb(): Promise<InMemoryDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema: fullSchema });
  await migrate(db, { migrationsFolder: path.join(packageRoot, "drizzle") });
  return { db, close: () => client.close() };
}
