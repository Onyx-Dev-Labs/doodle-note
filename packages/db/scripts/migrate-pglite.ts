/** Apply drizzle/ migrations to the local PGlite dev database.
 *  RUN WITH THE DEV SERVER STOPPED — PGlite is single-writer. */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const here = import.meta.dirname;
const dataDir = process.env.PGLITE_DATA_DIR ?? join(here, "..", ".pglite");
const db = drizzle(new PGlite(dataDir));
await migrate(db, { migrationsFolder: join(here, "..", "drizzle") });
console.log("pglite migrations applied");
await (db.$client as PGlite).close();
