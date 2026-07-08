/** Apply drizzle/ migrations to the local PGlite dev database.
 *  RUN WITH THE DEV SERVER STOPPED — PGlite is single-writer. */
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const here = import.meta.dirname;
const db = drizzle(new PGlite(join(here, "..", ".pglite")));
await migrate(db, { migrationsFolder: join(here, "..", "drizzle") });
console.log("pglite migrations applied");
await (db.$client as PGlite).close();
