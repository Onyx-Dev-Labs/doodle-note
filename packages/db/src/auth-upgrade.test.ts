import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createInMemoryDb } from "./testing";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
const forward = migrations[17]!;

async function legacyDatabase() {
  const fixture = await createInMemoryDb({ throughMigration: 16 });
  const client = fixture.db.$client;
  await client.exec(`INSERT INTO "user" (id,name,email,updated_at) VALUES ('owner-a','Synthetic A','a@example.test',now()),('owner-b','Synthetic B','b@example.test',now());
    INSERT INTO account(id,account_id,provider_id,user_id,issuer,password,access_token,refresh_token,id_token,scope,updated_at) VALUES ('a','subject','microsoft','owner-a','issuer-a','synthetic-hash','synthetic-access','synthetic-refresh','synthetic-id','openid',now());`);
  return fixture;
}

// Real Neon HTTP Drizzle driver + migrator, with ONLY its transport replaced by
// local PGlite queries. Each call is autocommitted, as in the HTTP runner.
// This deliberately does NOT use PGlite's enclosing migration transaction.
function httpRunner(client: Awaited<ReturnType<typeof legacyDatabase>>["db"]["$client"], failJournal = false) {
  const statements: string[] = [];
  const query = async (statement: string, params: unknown[] = []) => {
    statements.push(statement);
    if (failJournal && /insert into.*__drizzle_migrations/i.test(statement)) throw new Error("synthetic journal transport interruption");
    return client.query(statement, params);
  };
  const db = drizzle({ query } as unknown as NeonQueryFunction<false, false>);
  return { run: () => migrate(db, { migrationsFolder }), statements };
}

async function constraints(client: Awaited<ReturnType<typeof legacyDatabase>>["db"]["$client"]) {
  return {
    column: (await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='account' AND column_name='issuer'")).rows,
    index: (await client.query("SELECT indexname FROM pg_indexes WHERE indexname='account_issuer_accountId_uidx'")).rows,
    journal: (await client.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows,
  };
}

test("duplicate provider/account groups stop the actual HTTP migration before DDL or journaling", async () => {
  const fixture = await legacyDatabase();
  try {
    const client = fixture.db.$client;
    await client.exec(`INSERT INTO account(id,account_id,provider_id,user_id,issuer,updated_at) VALUES ('b','subject','microsoft','owner-b','issuer-b',now())`);
    const before = await constraints(client);
    const rows = (await client.query("SELECT * FROM account ORDER BY id")).rows;
    const runner = httpRunner(client);
    await assert.rejects(runner.run(), error => {
      const cause = (error as Error & { cause?: Error }).cause ?? error;
      assert.equal((cause as Error).message, "Better Auth upgrade blocked: 1 duplicate provider/account group(s)");
      return true;
    });
    assert.deepEqual(await constraints(client), before);
    assert.deepEqual((await client.query("SELECT * FROM account ORDER BY id")).rows, rows);
    assert.equal(runner.statements.some(s => /insert into.*__drizzle_migrations/i.test(s)), false);
  } finally { await fixture.close(); }
});

test("forward DDL is one loaded statement, preserves every account byte, and retries after journal failure", async () => {
  assert.equal(forward.sql.length, 1, "guard and DDL must not be split by the migration loader");
  const fixture = await legacyDatabase();
  try {
    const client = fixture.db.$client;
    const rows = (await client.query("SELECT row_to_json(account)::text AS bytes FROM account ORDER BY id")).rows;
    const interrupted = httpRunner(client, true);
    await assert.rejects(interrupted.run(), error => {
      assert.match(String((error as Error & { cause?: Error }).cause), /synthetic journal transport interruption/);
      return true;
    });
    assert.deepEqual((await client.query("SELECT row_to_json(account)::text AS bytes FROM account ORDER BY id")).rows, rows);
    const gap = await constraints(client);
    assert.deepEqual(gap.column, [{ is_nullable: "YES" }]);
    assert.deepEqual(gap.index, []);
    assert.equal(gap.journal.length, 17);
    assert.equal(interrupted.statements.filter(s => s === forward.sql[0]).length, 1);
    assert.equal(interrupted.statements.some(s => /^\s*(BEGIN|COMMIT)\b/i.test(s)), false);
    const retry = httpRunner(client);
    await retry.run();
    assert.equal(retry.statements.filter(s => s === forward.sql[0]).length, 1);
    const complete = await constraints(client);
    assert.equal(complete.journal.length, 18);
    assert.deepEqual(complete.journal[17], { hash: forward.hash, created_at: forward.folderMillis });
    const noop = httpRunner(client);
    await noop.run();
    assert.equal(noop.statements.includes(forward.sql[0]!), false);
    assert.deepEqual((await client.query("SELECT row_to_json(account)::text AS bytes FROM account ORDER BY id")).rows, rows);
  } finally { await fixture.close(); }
});


test("historical issuer backfill refuses upgraded schema before provider calls or writes", async () => {
  const { backfillAccountIdentities } = await import("../scripts/backfill-account-identities");
  const fixture = await createInMemoryDb();
  const originalFetch = globalThis.fetch;
  let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error("Unexpected outbound denied"); };
  try {
    await assert.rejects(backfillAccountIdentities(fixture.db), /Historical issuer backfill is disabled/);
    assert.equal(outbound, 0);
    assert.deepEqual((await fixture.db.$client.query("SELECT * FROM account")).rows, []);
  } finally { globalThis.fetch = originalFetch; await fixture.close(); }
});
