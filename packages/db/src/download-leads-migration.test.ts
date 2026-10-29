import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { createInMemoryDb } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
test("download lead tables are one statement that survives a retry without its journal row", async () => {
  const sql = readFileSync(`${migrationsFolder}/0018_download_leads.sql`, "utf8");
  const [migration] = readMigrationFiles({ migrationsFolder }).filter((entry) => entry.sql.join("").includes("download_lead_events"));
  assert.equal(migration?.sql.length, 1, "the loader must not split this migration");

  const fixture = await createInMemoryDb({ throughMigration: 17 });
  try {
    await fixture.db.$client.exec(sql);
    await fixture.db.$client.exec(`INSERT INTO download_leads (email, first_platform, latest_platform, first_requested_at, latest_requested_at)
      VALUES ('kept@example.test', 'mac', 'mac', now(), now())`);
    await fixture.db.$client.exec(sql);
    const rows = (await fixture.db.$client.query("SELECT email FROM download_leads")).rows;
    assert.deepEqual(rows, [{ email: "kept@example.test" }]);
  } finally {
    await fixture.close();
  }
});

test("download lead links are one statement that survives a retry without its journal row", async () => {
  const sql = readFileSync(`${migrationsFolder}/0019_download_lead_links.sql`, "utf8");
  const [migration] = readMigrationFiles({ migrationsFolder }).filter((entry) => entry.sql.join("").includes("download_lead_links"));
  assert.equal(migration?.sql.length, 1, "the loader must not split this migration");

  const fixture = await createInMemoryDb({ throughMigration: 18 });
  try {
    await fixture.db.$client.exec(sql);
    await fixture.db.$client.exec(`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('u1', 'Kept', 'account@example.test', true, now(), now())`);
    await fixture.db.$client.exec(`INSERT INTO download_leads (id, email, first_platform, latest_platform, first_requested_at, latest_requested_at)
      VALUES ('00000000-0000-4000-8000-000000000001', 'kept@example.test', 'mac', 'mac', now(), now())`);
    await fixture.db.$client.exec(`INSERT INTO download_lead_links (lead_id, user_id, method, verified_at)
      VALUES ('00000000-0000-4000-8000-000000000001', 'u1', 'email_confirmation', now())`);
    await fixture.db.$client.exec(`INSERT INTO download_lead_events (dedupe_key, lead_id, event_type)
      VALUES ('download_lead_linked:kept', '00000000-0000-4000-8000-000000000001', 'download_lead_linked')`);
    await fixture.db.$client.exec(sql);
    const links = (await fixture.db.$client.query("SELECT user_id FROM download_lead_links")).rows;
    assert.deepEqual(links, [{ user_id: "u1" }]);
  } finally {
    await fixture.close();
  }
});
