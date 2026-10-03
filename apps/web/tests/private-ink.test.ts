import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createInMemoryDb } from "@repo/db/testing";
import {
  applySync,
  sql,
  inkRows,
  reserveInk,
  downloadMetadata,
  type SyncOperation,
  type InkManifest,
} from "@repo/db";
import { handlePrivateInk } from "../lib/private-ink";
import { cleanupPrivateInk } from "../lib/private-ink-cleanup";
import {
  inkPath,
  privateInkStore,
  type PrivateInkStore,
} from "../lib/private-ink-store";
class Store implements PrivateInkStore {
  objects = new Map<string, Uint8Array>();
  gets = 0;
  failDelete = false;
  latePut: (() => Promise<void>) | undefined;
  async put(path: string, bytes: Uint8Array) {
    if (this.latePut) await this.latePut();
    if (this.objects.has(path)) throw new Error("already_exists");
    this.objects.set(path, bytes);
  }
  async get(path: string) {
    this.gets++;
    return this.objects.get(path) ?? null;
  }
  async delete(path: string) {
    if (this.failDelete) throw new Error("provider secret must not escape");
    this.objects.delete(path);
  }
}
const ink = new Uint8Array([1, 2, 3, 4]); // Opaque synthetic bytes, NOT a physical PencilKit roundtrip.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
function descriptor(bytes: Uint8Array, contentType: string) {
  return {
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
  };
}
async function fixture() {
  const instance = await createInMemoryDb();
  const { db } = instance;
  await db.execute(
    sql`insert into organization(id,name,slug,created_at) values ('a','A','a',now()),('b','B','b',now())`,
  );
  const sourceId = randomUUID();
  const op: SyncOperation = {
    protocolVersion: 2,
    libraryId: randomUUID(),
    noteId: randomUUID(),
    operationId: randomUUID(),
    kind: "upsert",
    expectedRevision: null,
    expectedLifecycleGeneration: null,
    snapshot: {
      title: "Ink fixture",
      kind: "note",
      createdAt: "2026-09-06T00:00:00Z",
      language: "en-US",
      text: "",
      passages: [],
      speakers: [],
      summaries: [],
      inkAttachments: [],
      selectedSummaryId: null,
      sourceRevisionId: sourceId,
      sourceVersions: [
        {
          id: sourceId,
          title: "Ink fixture",
          text: "",
          passages: [],
          speakers: [],
        },
      ],
    },
  };
  const receipt = (await applySync(db, "a", op)) as {
    headRevision: string;
    lifecycleGeneration: string;
  };
  const manifest: InkManifest = {
    libraryId: op.libraryId,
    noteId: op.noteId,
    attachmentId: randomUUID(),
    versionId: randomUUID(),
    generation: receipt.lifecycleGeneration,
    expectedRevision: receipt.headRevision,
    ink: descriptor(ink, "application/x-apple-pencilkit"),
    preview: descriptor(png, "image/png"),
  };
  const store = new Store();
  const request = (
    method: string,
    part = "ink",
    bytes?: Uint8Array,
    revision = receipt.headRevision,
  ) =>
    new Request(
      `http://localhost/api/sync/ink?versionId=${manifest.versionId}&part=${part}&libraryId=${op.libraryId}&noteId=${op.noteId}&revisionId=${revision}`,
      {
        method,
        headers: {
          "content-type":
            part === "ink" ? "application/x-apple-pencilkit" : "image/png",
        },
        ...(bytes ? { body: Buffer.from(bytes) } : {}),
      },
    );
  const upload = async () => {
    assert.equal(await reserveInk(db, "a", manifest), "pending");
    for (const [part, bytes] of [
      ["ink", ink],
      ["preview", png],
    ] as const)
      assert.equal(
        (await handlePrivateInk(request("PUT", part, bytes), db, "a", store))
          .status,
        200,
      );
  };
  const commit = async () =>
    (await applySync(db, "a", {
      ...op,
      operationId: randomUUID(),
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
      snapshot: {
        ...op.snapshot!,
        inkAttachments: [
          { id: manifest.attachmentId, versionId: manifest.versionId },
        ],
      },
    })) as {
      revision: string;
      headRevision: string;
      lifecycleGeneration: string;
    };
  return { ...instance, op, receipt, manifest, store, request, upload, commit };
}
test("private immutable bundle: reserve/replay, hashes, complete revision access and cross-tenant denial", async () => {
  const f = await fixture();
  try {
    const { db, manifest, store, request } = f;
    assert.equal(await reserveInk(db, "b", manifest), "not_found");
    assert.equal(await reserveInk(db, "a", manifest), "pending");
    assert.equal(
      (
        await handlePrivateInk(
          request("PUT", "ink", new Uint8Array([9])),
          db,
          "a",
          store,
        )
      ).status,
      400,
    );
    assert.equal(store.objects.size, 0);
    await f.upload();
    assert.equal(await reserveInk(db, "a", manifest), "ready");
    assert.equal(
      (await handlePrivateInk(request("GET"), db, "a", store)).status,
      404,
    );
    assert.equal(store.gets, 0);
    const committed = await f.commit();
    const response = await handlePrivateInk(
      request("GET", "ink", undefined, committed.revision),
      db,
      "a",
      store,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), ink);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("vary"), "Authorization");
    assert.equal(response.headers.get("location"), null);
    const gets = store.gets;
    assert.equal(
      (
        await handlePrivateInk(
          request("GET", "ink", undefined, committed.revision),
          db,
          "b",
          store,
        )
      ).status,
      404,
    );
    assert.equal(store.gets, gets);
    assert.equal(
      (
        await handlePrivateInk(
          request("GET", "preview", undefined, randomUUID()),
          db,
          "a",
          store,
        )
      ).status,
      404,
    );
    assert.equal(
      (await handlePrivateInk(request("PUT", "ink", ink), db, "a", store))
        .status,
      200,
    ); // provider exists -> verified replay
    assert.equal(
      await reserveInk(db, "a", {
        ...manifest,
        ink: { ...manifest.ink, sha256: "0".repeat(64) },
      }),
      "version_reused",
    );
    assert.equal(
      (
        await handlePrivateInk(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ ...manifest, audio: "forbidden" }),
          }),
          db,
          "a",
          store,
        )
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("invalid and foreign asset references roll back sync revision and initial adoption", async () => {
  const f = await fixture();
  try {
    const { db, op, manifest } = f;
    await assert.rejects(
      f.commit(),
      (e: unknown) =>
        (e as { cause?: Error }).cause?.message === "invalid_ink_reference",
    );
    assert.equal(
      inkRows(
        await db.execute(
          sql`select count(*) as n from sync_revisions where note_id=${op.noteId}::uuid`,
        ),
      )[0]!.n,
      1,
    );
    await f.upload();
    const other = {
      ...op,
      noteId: randomUUID(),
      operationId: randomUUID(),
      snapshot: {
        ...op.snapshot!,
        inkAttachments: [
          { id: manifest.attachmentId, versionId: manifest.versionId },
        ],
      },
    };
    await assert.rejects(
      applySync(db, "a", other),
      (e: unknown) =>
        (e as { cause?: Error }).cause?.message === "invalid_ink_reference",
    );
    assert.equal(
      inkRows(
        await db.execute(
          sql`select id from sync_notes where id=${other.noteId}::uuid`,
        ),
      ).length,
      0,
    );
    await f.commit();
  } finally {
    await f.close();
  }
});
test("Trash retains historical/conflict assets; purge denies reads and retries deletion", async () => {
  const f = await fixture();
  try {
    await f.upload();
    const commit = await f.commit();
    const { db, op, store, manifest } = f;
    const trash = (await applySync(db, "a", {
      ...op,
      operationId: randomUUID(),
      kind: "trash",
      snapshot: undefined,
      expectedRevision: commit.headRevision,
      expectedLifecycleGeneration: commit.lifecycleGeneration,
    })) as {
      headRevision: string;
      lifecycleGeneration: string;
      deletionId: string;
    };
    assert.ok(
      await downloadMetadata(
        db,
        "a",
        op.libraryId,
        op.noteId,
        commit.revision,
        manifest.versionId,
      ),
    );
    assert.equal(
      (await handlePrivateInk(f.request("PUT", "ink", ink), db, "a", store))
        .status,
      404,
    );
    await applySync(db, "a", {
      ...op,
      operationId: randomUUID(),
      kind: "purge",
      snapshot: undefined,
      expectedRevision: trash.headRevision,
      expectedLifecycleGeneration: trash.lifecycleGeneration,
      deletionId: trash.deletionId,
    });
    assert.equal(
      await downloadMetadata(
        db,
        "a",
        op.libraryId,
        op.noteId,
        commit.revision,
        manifest.versionId,
      ),
      null,
    );
    store.failDelete = true;
    assert.equal((await cleanupPrivateInk(db, "a", store)).failed, 2);
    assert.equal(store.objects.size, 2);
    store.failDelete = false;
    await db.execute(sql`update ink_cleanup set next_attempt_at=now()`);
    assert.equal((await cleanupPrivateInk(db, "a", store)).deleted, 2);
    assert.equal(store.objects.size, 0);
    assert.equal(await reserveInk(db, "a", manifest), "lifecycle_conflict");
  } finally {
    await f.close();
  }
});
test("late upload after purge remains unreachable and resets durable cleanup", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt, store, manifest } = f;
    await reserveInk(db, "a", manifest);
    store.latePut = async () => {
      store.latePut = undefined;
      const trash = (await applySync(db, "a", {
        ...op,
        operationId: randomUUID(),
        kind: "trash",
        snapshot: undefined,
        expectedRevision: receipt.headRevision,
        expectedLifecycleGeneration: receipt.lifecycleGeneration,
      })) as {
        headRevision: string;
        lifecycleGeneration: string;
        deletionId: string;
      };
      await applySync(db, "a", {
        ...op,
        operationId: randomUUID(),
        kind: "purge",
        snapshot: undefined,
        expectedRevision: trash.headRevision,
        expectedLifecycleGeneration: trash.lifecycleGeneration,
        deletionId: trash.deletionId,
      });
      await cleanupPrivateInk(db, "a", store);
    };
    assert.equal(
      (await handlePrivateInk(f.request("PUT", "ink", ink), db, "a", store))
        .status,
      409,
    );
    assert.equal(store.objects.size, 1);
    await cleanupPrivateInk(db, "a", store);
    assert.equal(store.objects.size, 0);
  } finally {
    await f.close();
  }
});
test("retained versions cannot starve orphan cleanup; org cascade keeps cleanup receipts", async () => {
  const f = await fixture();
  try {
    const { db, manifest, op, store } = f;
    await f.upload();
    const commit = await f.commit();
    // 101 retained versions precede a new orphan. Shared fixture only contains synthetic data.
    for (let i = 0; i < 101; i++) {
      const id = randomUUID();
      await db.execute(sql`insert into ink_versions(id,attachment_id,note_id,organization_id,library_id,generation,manifest,uploaded,state,created_at)
    select ${id}::uuid,attachment_id,note_id,organization_id,library_id,generation,manifest,uploaded,state,now()-interval '3 days' from ink_versions where id=${manifest.versionId}::uuid`);
      await db.execute(
        sql`update sync_revisions set snapshot=jsonb_set(snapshot,'{inkAttachments}',(snapshot->'inkAttachments')||jsonb_build_array(jsonb_build_object('id',${manifest.attachmentId}::text,'versionId',${id}::text))) where id=${commit.revision}::uuid`,
      );
    }
    const orphan = {
      ...manifest,
      versionId: randomUUID(),
      expectedRevision: commit.headRevision,
    };
    await reserveInk(db, "a", orphan);
    store.objects.set(inkPath(orphan.versionId, "ink"), ink);
    await db.execute(
      sql`update ink_versions set created_at=now()-interval '2 days' where id=${orphan.versionId}::uuid`,
    );
    await cleanupPrivateInk(db, "a", store);
    assert.equal(store.objects.has(inkPath(orphan.versionId, "ink")), false);
    assert.equal(
      inkRows(await db.execute(sql`select count(*) as n from ink_versions`))[0]!
        .n,
      102,
    );
    await db.execute(sql`delete from organization where id='a'`);
    assert.equal(
      inkRows(
        await db.execute(
          sql`select id from ink_versions where note_id=${op.noteId}::uuid`,
        ),
      ).length,
      0,
    );
    await cleanupPrivateInk(db, undefined, store);
    await cleanupPrivateInk(db, undefined, store);
    await cleanupPrivateInk(db, undefined, store);
    assert.equal(store.objects.size, 0);
  } finally {
    await f.close();
  }
});
test("flag-off old schema and no private credentials are safe", async () => {
  const { db, close } = await createInMemoryDb({ throughMigration: 13 });
  try {
    assert.deepEqual(await cleanupPrivateInk(db), {
      deleted: 0,
      failed: 0,
      pending: 0,
    });
  } finally {
    await close();
  }
  delete process.env.DOODLENOTE_PRIVATE_INK_TOKEN;
  assert.throws(privateInkStore, /unconfigured/);
  const { GET } = await import("../app/api/sync/ink/route");
  delete process.env.DOODLENOTE_PRIVATE_INK_ENABLED;
  const response = await GET(new Request("http://localhost/api/sync/ink"));
  assert.equal(response.status, 404);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  process.env.DOODLENOTE_PRIVATE_INK_ENABLED = "true";
  assert.equal(
    (await GET(new Request("http://localhost/api/sync/ink"))).status,
    401,
  );
  delete process.env.DOODLENOTE_PRIVATE_INK_ENABLED;
});

test("PNG preview validation rejects truncated, corrupt, zero-sized and oversized decoded images", async () => {
  const { validateInkPreview } = await import("../lib/ink-preview");
  const { deflateSync } = await import("node:zlib");
  function chunk(name: string, data: Buffer) {
    const type = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, sum]);
  }
  function sized(width: number, height: number) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
      png.subarray(0, 8),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  validateInkPreview(png);
  assert.throws(
    () =>
      validateInkPreview(
        Buffer.concat([
          png.subarray(0, 33),
          chunk("acTL", Buffer.alloc(8)),
          png.subarray(33),
        ]),
      ),
    /invalid_content/,
  );
  for (const invalid of [
    png.subarray(0, 20),
    png.subarray(0, -1),
    sized(0, 1),
    sized(4096, 4096),
    sized(1, 2),
    Buffer.from("not png"),
  ])
    assert.throws(() => validateInkPreview(invalid), /invalid_content/);
});
test("actual SDK adapter requests private access, bypasses cache and never accepts public/conditional responses", async () => {
  const { createPrivateInkStore } = await import("../lib/private-ink-store");
  const calls: unknown[] = [];
  let mode = "private";
  const sdk = {
    async put(_path: string, _bytes: unknown, options: unknown) {
      calls.push(options);
      return { url: `https://fixture.${mode}.blob.vercel-storage.com/x` };
    },
    async get(_path: string, options: unknown) {
      calls.push(options);
      if (mode === "error")
        throw new Error("private store access denied synthetic");
      return {
        statusCode: mode === "conditional" ? 304 : 200,
        stream:
          mode === "conditional"
            ? null
            : new ReadableStream({
                start(c) {
                  c.enqueue(ink);
                  c.close();
                },
              }),
        blob: { url: `https://fixture.${mode}.blob.vercel-storage.com/x` },
      };
    },
    async del() {},
  } as unknown as Parameters<typeof createPrivateInkStore>[1];
  const adapter = createPrivateInkStore("synthetic-private-token", sdk);
  await adapter.put(
    "private-ink/example/ink",
    ink,
    "application/x-apple-pencilkit",
  );
  assert.deepEqual(await adapter.get("private-ink/example/ink"), ink);
  assert.ok(calls.every((c) => (c as { access: string }).access === "private"));
  assert.equal((calls[1] as { useCache: boolean }).useCache, false);
  mode = "public";
  await assert.rejects(
    adapter.get("private-ink/example/ink"),
    /private_store_required/,
  );
  mode = "conditional";
  await assert.rejects(
    adapter.get("private-ink/example/ink"),
    /private_store_required/,
  );
  mode = "error";
  await assert.rejects(adapter.get("private-ink/example/ink"), /denied/);
});
test("personal billing purge cleans private bundles but retains shared workspace objects", async () => {
  const f = await fixture();
  try {
    const { db, store, op } = f;
    await f.upload();
    await f.commit();
    await db.execute(
      sql`insert into "user"(id,name,email,created_at,updated_at) values('owner','Owner','fixture@example.test',now(),now())`,
    );
    await db.execute(
      sql`update organization set slug='personal-fixture' where id='a'`,
    );
    await db.execute(
      sql`insert into member(id,organization_id,user_id,role,created_at) values('p','a','owner','owner',now()),('s','b','owner','member',now())`,
    );
    const shared = {
      ...op,
      libraryId: randomUUID(),
      noteId: randomUUID(),
      operationId: randomUUID(),
    };
    const r = (await applySync(db, "b", shared)) as {
      headRevision: string;
      lifecycleGeneration: string;
    };
    const m = {
      ...f.manifest,
      libraryId: shared.libraryId,
      noteId: shared.noteId,
      versionId: randomUUID(),
      expectedRevision: r.headRevision,
      generation: r.lifecycleGeneration,
    };
    await reserveInk(db, "b", m);
    store.objects.set(inkPath(m.versionId, "ink"), ink);
    const { purgePersonalCloudData } = await import("../lib/cloud-data-purge");
    store.failDelete = true;
    await assert.rejects(
      purgePersonalCloudData({
        db,
        userId: "owner",
        deleteAttachmentPrefix: async () => {},
        privateInkProvider: store,
      }),
      /cleanup pending/,
    );
    store.failDelete = false;
    await db.execute(sql`update ink_cleanup set next_attempt_at=now()`);
    await purgePersonalCloudData({
      db,
      userId: "owner",
      deleteAttachmentPrefix: async () => {},
      privateInkProvider: store,
    });
    assert.deepEqual([...store.objects.keys()], [inkPath(m.versionId, "ink")]);
  } finally {
    await f.close();
  }
});

test("global cleanup skips 51 retained-only workspaces and reaches an orphan workspace", async () => {
  const f = await fixture();
  try {
    const { db, manifest, store } = f;
    await db.execute(
      sql`insert into organization(id,name,slug,created_at) select 'retained-'||i,'Synthetic','retained-'||i,now() from generate_series(1,51) i`,
    );
    await db.execute(
      sql`insert into sync_libraries(id,organization_id) select gen_random_uuid(),id from organization where id like 'retained-%'`,
    );
    await db.execute(
      sql`insert into sync_notes(id,library_id,organization_id) select gen_random_uuid(),id,organization_id from sync_libraries where organization_id like 'retained-%'`,
    );
    await db.execute(
      sql`insert into ink_versions(id,attachment_id,note_id,organization_id,library_id,generation,manifest,state,created_at) select gen_random_uuid(),gen_random_uuid(),id,organization_id,library_id,lifecycle_generation,'{}'::jsonb,'ready',now()-interval '3 days' from sync_notes where organization_id like 'retained-%'`,
    );
    await db.execute(
      sql`insert into sync_revisions(id,note_id,organization_id,sequence,kind,snapshot) select gen_random_uuid(),note_id,organization_id,1,'upsert',jsonb_build_object('inkAttachments',jsonb_build_array(jsonb_build_object('id',attachment_id,'versionId',id))) from ink_versions where organization_id like 'retained-%'`,
    );
    // Alphabetically later than retained-only organizations.
    await db.execute(sql`update organization set id='z-orphan' where id='b'`);
    const op = {
      ...f.op,
      libraryId: randomUUID(),
      noteId: randomUUID(),
      operationId: randomUUID(),
    };
    const receipt = (await applySync(db, "z-orphan", op)) as {
      headRevision: string;
      lifecycleGeneration: string;
    };
    const orphan = {
      ...manifest,
      versionId: randomUUID(),
      libraryId: op.libraryId,
      noteId: op.noteId,
      expectedRevision: receipt.headRevision,
      generation: receipt.lifecycleGeneration,
    };
    await reserveInk(db, "z-orphan", orphan);
    store.objects.set(inkPath(orphan.versionId, "ink"), ink);
    await db.execute(
      sql`update ink_versions set created_at=now()-interval '2 days' where id=${orphan.versionId}::uuid`,
    );
    await cleanupPrivateInk(db, undefined, store);
    assert.equal(store.objects.size, 0);
    assert.equal(
      inkRows(
        await db.execute(
          sql`select count(*) as n from ink_versions where organization_id like 'retained-%'`,
        ),
      )[0]!.n,
      51,
    );
  } finally {
    await f.close();
  }
});
test("cleanup prioritizes fresh deletion and stops within its work budget", async (t) => {
  const f = await fixture();
  try {
    const { db, store } = f;
    await db.execute(
      sql`insert into ink_cleanup(path,organization_id,deleted_at,next_attempt_at) select 'old/'||i,'a',now()-interval '1 day',now()-interval '1 day' from generate_series(1,100) i`,
    );
    await db.execute(
      sql`insert into ink_cleanup(path,organization_id) values('fresh','a')`,
    );
    store.objects.set("fresh", ink);
    let clock = Date.now();
    const visited: string[] = [];
    const timed: PrivateInkStore = {
      ...store,
      put: async () => {},
      get: async () => null,
      delete: async (path) => {
        visited.push(path);
        await store.delete(path);
        clock += 10001;
      },
    };
    t.mock.method(Date, "now", () => clock);
    const result = await cleanupPrivateInk(db, "a", timed, 20000);
    assert.deepEqual(visited, ["fresh"]);
    assert.equal(result.deleted, 1);
    assert.equal(store.objects.size, 0);
  } finally {
    t.mock.restoreAll();
    await f.close();
  }
});
test("conflict revisions keep ink through restore; authoritative expiry removes it", async () => {
  const f = await fixture();
  try {
    await f.upload();
    const current = await f.commit();
    const conflict = await f.commit();
    const { db, op, manifest, store } = f;
    assert.notEqual(current.revision, conflict.revision);
    const lifecycle = async (
      kind: "trash" | "restore",
      r: {
        headRevision: string;
        lifecycleGeneration: string;
        deletionId?: string;
      },
    ) =>
      (await applySync(db, "a", {
        ...op,
        kind,
        snapshot: undefined,
        operationId: randomUUID(),
        expectedRevision: r.headRevision,
        expectedLifecycleGeneration: r.lifecycleGeneration,
        ...(r.deletionId ? { deletionId: r.deletionId } : {}),
      })) as {
        headRevision: string;
        lifecycleGeneration: string;
        deletionId: string;
      };
    const trashed = await lifecycle("trash", current);
    const restored = await lifecycle("restore", trashed);
    assert.ok(
      await downloadMetadata(
        db,
        "a",
        op.libraryId,
        op.noteId,
        conflict.revision,
        manifest.versionId,
      ),
    );
    await lifecycle("trash", restored);
    await db.execute(
      sql`update sync_notes set expires_at=now()-interval '1 second' where id=${op.noteId}::uuid`,
    );
    assert.equal(
      await downloadMetadata(
        db,
        "a",
        op.libraryId,
        op.noteId,
        current.revision,
        manifest.versionId,
      ),
      null,
    );
    await cleanupPrivateInk(db, "a", store);
    assert.equal(store.objects.size, 0);
  } finally {
    await f.close();
  }
});

test("interrupted half bundle never replaces last revision, oversized bodies and provider errors are safe", async () => {
  const f = await fixture();
  try {
    const { db, manifest, store } = f;
    await reserveInk(db, "a", manifest);
    assert.equal(
      (await handlePrivateInk(f.request("PUT", "ink", ink), db, "a", store))
        .status,
      200,
    );
    await assert.rejects(
      f.commit(),
      (e: unknown) =>
        (e as { cause?: Error }).cause?.message === "invalid_ink_reference",
    );
    assert.equal(
      inkRows(
        await db.execute(
          sql`select head_revision from sync_notes where id=${f.op.noteId}::uuid`,
        ),
      )[0]!.head_revision,
      f.receipt.headRevision,
    );
    assert.equal(
      (
        await handlePrivateInk(
          f.request("PUT", "preview", new Uint8Array(3 * 1024 * 1024 + 1)),
          db,
          "a",
          store,
        )
      ).status,
      400,
    );
    const denied: PrivateInkStore = {
      put: async () => {
        throw new Error("provider secret");
      },
      get: async () => {
        throw new Error("provider secret");
      },
      delete: async () => {},
    };
    const response = await handlePrivateInk(
      f.request("PUT", "preview", png),
      db,
      "a",
      denied,
    );
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret/);
    assert.equal(
      (await handlePrivateInk(f.request("PUT", "preview", png), db, "a", store))
        .status,
      200,
    );
    await f.commit();
  } finally {
    await f.close();
  }
});
