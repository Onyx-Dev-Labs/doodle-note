import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createInMemoryDb } from "@repo/db/testing";
import { sql, applySync } from "@repo/db";
import { handleMobileReader } from "../lib/mobile-reader";
import { encodeReaderCursor, decodeReaderCursor } from "../lib/reader-cursor";
test("reader cursor cannot cross workspace, note, or list scope", () => {
  process.env.DOODLENOTE_SYNC_CURSOR_SECRET =
    "synthetic-reader-key-with-at-least-32-chars";
  const note = randomUUID(),
    cursor = encodeReaderCursor("a", note, "42");
  assert.equal(decodeReaderCursor("a", note, cursor), "42");
  assert.throws(() => decodeReaderCursor("b", note, cursor));
  assert.throws(() => decodeReaderCursor("a", undefined, cursor));
  assert.throws(() => decodeReaderCursor("a", randomUUID(), cursor));
  assert.throws(() => decodeReaderCursor("a", note, cursor + "tampered"));
});
test("reader is old-schema safe, private, and denies unauthenticated bearer access", async () => {
  delete process.env.DOODLENOTE_SYNC_V2_ENABLED;
  const { GET } = await import("../app/api/sync/reader/route");
  const request = new Request("http://localhost/api/sync/reader");
  assert.equal((await GET(request)).status, 404);
  process.env.DOODLENOTE_SYNC_V2_ENABLED = "true";
  assert.equal((await GET(request)).status, 401);
  const old = await createInMemoryDb({ throughMigration: 14 });
  try {
    assert.equal((await handleMobileReader(request, "a", old.db)).status, 503);
  } finally {
    await old.close();
  }
});
test("reader known fields coexist with retained unknowns; cross-workspace detail and preview cannot leak", async () => {
  const f = await createInMemoryDb();
  try {
    process.env.DOODLENOTE_SYNC_V2_ENABLED = "true";
    const { db } = f;
    await db.execute(
      sql`insert into organization(id,name,slug,created_at) values('a','A','a',now()),('b','B','b',now())`,
    );
    const source = randomUUID(),
      note = randomUUID();
    const op = {
      protocolVersion: 2,
      libraryId: randomUUID(),
      noteId: note,
      operationId: randomUUID(),
      kind: "upsert",
      expectedRevision: null,
      expectedLifecycleGeneration: null,
      snapshot: {
        title: "Fixture",
        kind: "note",
        createdAt: "2026-09-06",
        language: "en-US",
        text: "Typed",
        sourceRevisionId: source,
        sourceVersions: [
          {
            id: source,
            title: "Fixture",
            text: "Typed",
            passages: [],
            speakers: [],
          },
        ],
        selectedSummaryId: null,
        passages: [],
        speakers: [],
        summaries: [],
        inkAttachments: [],
      },
    };
    await applySync(db, "a", op);
    const url = `http://localhost/api/sync/reader?noteId=${note}`;
    const response = await handleMobileReader(new Request(url), "a", db);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.match(response.headers.get("vary")!, /Cookie/);
    assert.equal((await response.json()).snapshot.text, "Typed");
    assert.equal(
      (await handleMobileReader(new Request(url), "b", db)).status,
      404,
    );
    const forged = await handleMobileReader(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({ ...op, snapshot: { text: "erase" } }),
      }),
      "a",
      db,
    );
    assert.equal(forged.status, 400);
    assert.doesNotMatch(await forged.text(), /select|organization|Typed/);
    delete process.env.DOODLENOTE_PRIVATE_INK_ENABLED;
    assert.equal(
      (
        await handleMobileReader(
          new Request(url + "&mode=preview&part=preview"),
          "a",
          db,
        )
      ).status,
      503,
    );
  } finally {
    await f.close();
  }
});

test("session reader checks authenticated membership and subscription before reading, with same-origin writes", async () => {
  const { handleSessionReader } = await import("../lib/reader-session");
  let reads = 0;
  const deps = {
    session: async () => ({
      userId: "trusted",
      activeOrganizationId: "a",
      organizationIds: ["a"],
    }),
    entitled: async (id: string) => {
      assert.equal(id, "trusted");
      return true;
    },
    read: async (org: string) => {
      reads++;
      assert.equal(org, "a");
      return Response.json({ ok: true });
    },
  };
  assert.equal(
    (
      await handleSessionReader(
        new Request("https://fixture.example/api?organizationId=b"),
        deps,
      )
    ).status,
    404,
  );
  assert.equal(reads, 0);
  assert.equal(
    (
      await handleSessionReader(new Request("https://fixture.example/api"), {
        ...deps,
        entitled: async () => false,
      })
    ).status,
    402,
  );
  assert.equal(reads, 0);
  assert.equal(
    (
      await handleSessionReader(new Request("https://fixture.example/api"), {
        ...deps,
        session: async () => null,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await handleSessionReader(
        new Request("https://fixture.example/api", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
        deps,
      )
    ).status,
    403,
  );
  assert.equal(reads, 0);
  assert.equal(
    (
      await handleSessionReader(
        new Request("https://fixture.example/api", {
          method: "POST",
          headers: { origin: "https://fixture.example" },
        }),
        deps,
      )
    ).status,
    200,
  );
  assert.equal(reads, 1);
});
