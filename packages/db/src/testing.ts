import path from "node:path";
import {readFile} from "node:fs/promises";
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
export async function createInMemoryDb(options: {throughMigration?: number} = {}): Promise<InMemoryDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema: fullSchema });
  if(options.throughMigration===undefined) {
    await migrate(db, { migrationsFolder: path.join(packageRoot, "drizzle") });
  } else {
    const journal=JSON.parse(await readFile(path.join(packageRoot,'drizzle/meta/_journal.json'),'utf8')) as {entries:Array<{idx:number;tag:string}>};
    for(const entry of journal.entries.filter(e=>e.idx<=options.throughMigration!)) {
      await client.exec(await readFile(path.join(packageRoot,'drizzle',entry.tag+'.sql'),'utf8'));
    }
  }
  return { db, close: () => client.close() };
}
