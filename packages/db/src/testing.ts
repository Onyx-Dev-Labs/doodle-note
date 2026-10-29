import path from "node:path";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  /** Apply pending real journal migrations after seeding a historical fixture. */
  migrate: () => Promise<void>;
}

/**
 * Creates a fresh in-memory PGlite database and applies every migration in
 * packages/db/drizzle. Data stays in memory; historical fixtures use a temporary
 * migration-file directory that is removed after the real loader completes.
 */
export async function createInMemoryDb(options: {throughMigration?: number} = {}): Promise<InMemoryDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema: fullSchema });
  const applyMigrations = () => migrate(db, { migrationsFolder: path.join(packageRoot, "drizzle") });
  if (options.throughMigration === undefined) {
    await applyMigrations();
  } else {
    // Use the real loader/journal even for historical fixtures, so advancing
    // them exercises the same pending-migration boundary as an existing DB.
    const folder = await mkdtemp(path.join(tmpdir(), "doodlenote-migrations-"));
    try {
      const journal = JSON.parse(await readFile(path.join(packageRoot, "drizzle/meta/_journal.json"), "utf8")) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      journal.entries = journal.entries.filter(entry => entry.idx <= options.throughMigration!);
      await mkdir(path.join(folder, "meta"));
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        await copyFile(path.join(packageRoot, "drizzle", entry.tag + ".sql"), path.join(folder, entry.tag + ".sql"));
      }
      await migrate(db, { migrationsFolder: folder });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  return { db, close: () => client.close(), migrate: applyMigrations };
}
