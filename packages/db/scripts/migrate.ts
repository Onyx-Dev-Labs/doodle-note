/** Apply drizzle/ migrations to the DATABASE_URL Neon instance. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

if (!process.env.DATABASE_URL) {
  const envLocal = readFileSync(
    join(__dirname, "..", "..", "..", ".env.local"),
    "utf8",
  );
  const m = envLocal.match(/^DATABASE_URL="?([^"\n]+)"?$/m);
  if (m) process.env.DATABASE_URL = m[1];
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

const db = drizzle(neon(process.env.DATABASE_URL));
migrate(db, { migrationsFolder: join(__dirname, "..", "drizzle") })
  .then(() => console.log("migrations applied"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
