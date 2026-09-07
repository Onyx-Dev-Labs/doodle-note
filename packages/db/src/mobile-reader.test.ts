import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import { createInMemoryDb } from "./testing";
import { applySync } from "./sync-service";
import { inkRows } from "./ink-assets";
import {
  readerAction,
  readerDetail,
  listReaderNotes,
  readerAvailable,
} from "./mobile-reader";
import type { SyncOperation } from "./sync-contract";
async function fixture() {
  const instance = await createInMemoryDb();
  await instance.db.execute(
    sql`insert into organization(id,name,slug,created_at) values('a','A','a',now()),('b','B','b',now())`,
  );
  const source = randomUUID();
  const op: SyncOperation = {
    protocolVersion: 2,
    libraryId: randomUUID(),
    noteId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: null,
    expectedLifecycleGeneration: null,
    kind: "upsert",
    snapshot: {
      title: "Synthetic mobile note",
      kind: "note",
      createdAt: "2026-09-06T00:00:00Z",
      language: "en-US",
      text: "Personal",
      sourceRevisionId: source,
      sourceVersions: [
        {
          id: source,
          title: "Synthetic mobile note",
          text: "Personal",
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
  const receipt = (await applySync(instance.db, "a", op)) as {
    headRevision: string;
    lifecycleGeneration: string;
  };
  return { ...instance, op, receipt };
}
test("reader preserves unknown snapshot fields and source history while explicitly choosing a version", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt } = f;
    const version = randomUUID(),
      attachment = randomUUID();
    await db.execute(
      sql`insert into ink_versions(id,attachment_id,note_id,organization_id,library_id,generation,manifest,state) values(${version}::uuid,${attachment}::uuid,${op.noteId}::uuid,'a',${op.libraryId}::uuid,${receipt.lifecycleGeneration}::uuid,'{}','ready')`,
    );
    await db.execute(
      sql`update sync_revisions set snapshot=jsonb_set(snapshot,'{inkAttachments}',jsonb_build_array(jsonb_build_object('id',${attachment}::text,'versionId',${version}::text))) where id=${receipt.headRevision}::uuid`,
    );
    await db.execute(
      sql`update sync_revisions set snapshot=snapshot||'{"future":{"opaque":[1,{"speakerCorrection":"kept"}]}}'::jsonb where id=${receipt.headRevision}::uuid`,
    );
    const base = await readerDetail(db, "a", op.noteId);
    assert.ok(base);
    const edit = (await applySync(db, "a", {
      ...op,
      operationId: randomUUID(),
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
    })) as { headRevision: string };
    const action = {
      kind: "choose",
      libraryId: op.libraryId,
      noteId: op.noteId,
      operationId: randomUUID(),
      expectedRevision: edit.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
      selectedRevision: receipt.headRevision,
    };
    const chosen = (await readerAction(db, "a", action)) as {
      status: string;
      headRevision: string;
    };
    assert.equal(chosen.status, "ok");
    assert.deepEqual(await readerAction(db, "a", action), chosen);
    const current = await readerDetail(db, "a", op.noteId);
    assert.deepEqual(current?.snapshot, base.snapshot);
    assert.equal(current?.versions.length, 3);
    assert.equal(
      (
        (await readerAction(db, "a", {
          ...action,
          operationId: randomUUID(),
        })) as { status: string }
      ).status,
      "changed",
    );
    assert.equal(
      ((await readerAction(db, "b", action)) as { status: string }).status,
      "not_found",
    );
    assert.equal(await readerDetail(db, "b", op.noteId), null);
    assert.deepEqual((await listReaderNotes(db, "b")).notes, []);
    await assert.rejects(
      readerAction(db, "a", { ...action, snapshot: { text: "flatten" } }),
      /invalid_action/,
    );
  } finally {
    await f.close();
  }
});
test("reader Trash/restore/purge and stale choices never resurrect snapshots", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt } = f;
    const base = {
      libraryId: op.libraryId,
      noteId: op.noteId,
      operationId: randomUUID(),
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
    };
    const trash = (await readerAction(db, "a", { ...base, kind: "trash" })) as {
      headRevision: string;
      lifecycleGeneration: string;
      deletionId: string;
    };
    assert.equal(
      (await readerDetail(db, "a", op.noteId))?.note.state,
      "trashed",
    );
    assert.equal(
      (
        (await readerAction(db, "a", {
          ...base,
          operationId: randomUUID(),
          kind: "choose",
          selectedRevision: receipt.headRevision,
        })) as { status: string }
      ).status,
      "changed",
    );
    const restore = (await readerAction(db, "a", {
      ...base,
      operationId: randomUUID(),
      kind: "restore",
      expectedRevision: trash.headRevision,
      expectedLifecycleGeneration: trash.lifecycleGeneration,
      deletionId: trash.deletionId,
    })) as { headRevision: string; lifecycleGeneration: string };
    assert.equal(
      (await readerDetail(db, "a", op.noteId))?.note.state,
      "active",
    );
    const again = (await readerAction(db, "a", {
      ...base,
      operationId: randomUUID(),
      kind: "trash",
      expectedRevision: restore.headRevision,
      expectedLifecycleGeneration: restore.lifecycleGeneration,
    })) as typeof trash;
    await readerAction(db, "a", {
      ...base,
      operationId: randomUUID(),
      kind: "purge",
      expectedRevision: again.headRevision,
      expectedLifecycleGeneration: again.lifecycleGeneration,
      deletionId: again.deletionId,
    });
    assert.equal(await readerDetail(db, "a", op.noteId), null);
    assert.equal((await listReaderNotes(db, "a")).notes.length, 0);
    assert.equal(
      (
        (await readerAction(db, "a", {
          ...base,
          kind: "choose",
          selectedRevision: receipt.headRevision,
        })) as { status: string }
      ).status,
      "purged",
    );
    assert.ok(
      inkRows(
        await db.execute(
          sql`select snapshot from sync_revisions where note_id=${op.noteId}::uuid`,
        ),
      ).every((r) => r.snapshot === null),
    );
  } finally {
    await f.close();
  }
});
test("reader migration capability is absent on the old schema", async () => {
  const f = await createInMemoryDb({ throughMigration: 14 });
  try {
    assert.equal(await readerAvailable(f.db), false);
  } finally {
    await f.close();
  }
});

test("reader history paginates every retained version and rejects foreign revision selection", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt } = f;
    await db.execute(
      sql`insert into sync_revisions(note_id,organization_id,sequence,kind,snapshot) select ${op.noteId}::uuid,'a',i,'conflict',${JSON.stringify(op.snapshot)}::jsonb from generate_series(2,56) i`,
    );
    const first = await readerDetail(db, "a", op.noteId);
    assert.equal(first?.versions.length, 50);
    assert.ok(first?.next);
    const second = await readerDetail(
      db,
      "a",
      op.noteId,
      undefined,
      first!.next!,
    );
    assert.equal(second?.versions.length, 6);
    assert.equal(
      new Set([...first!.versions, ...second!.versions].map((v) => v.id)).size,
      56,
    );
    const other = {
      ...op,
      libraryId: randomUUID(),
      noteId: randomUUID(),
      operationId: randomUUID(),
    };
    const foreign = (await applySync(db, "b", other)) as {
      headRevision: string;
    };
    const result = (await readerAction(db, "a", {
      kind: "choose",
      libraryId: op.libraryId,
      noteId: op.noteId,
      operationId: randomUUID(),
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
      selectedRevision: foreign.headRevision,
    })) as { status: string };
    assert.equal(result.status, "not_found");
  } finally {
    await f.close();
  }
});

test("Trash and restore display the selected head lineage, never a newer unresolved conflict", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt } = f;
    const edit = {
      ...op,
      operationId: randomUUID(),
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
    };
    const current = (await applySync(db, "a", edit)) as {
      headRevision: string;
    };
    const conflict = (await applySync(db, "a", {
      ...edit,
      operationId: randomUUID(),
    })) as { revision: string };
    assert.notEqual(current.headRevision, conflict.revision);
    const base = {
      libraryId: op.libraryId,
      noteId: op.noteId,
      expectedRevision: current.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
    };
    const trashed = (await readerAction(db, "a", {
      ...base,
      kind: "trash",
      operationId: randomUUID(),
    })) as {
      headRevision: string;
      lifecycleGeneration: string;
      deletionId: string;
    };
    assert.equal(
      (await readerDetail(db, "a", op.noteId))?.selectedRevision,
      current.headRevision,
    );
    await readerAction(db, "a", {
      ...base,
      kind: "restore",
      operationId: randomUUID(),
      expectedRevision: trashed.headRevision,
      expectedLifecycleGeneration: trashed.lifecycleGeneration,
      deletionId: trashed.deletionId,
    });
    const restored = await readerDetail(db, "a", op.noteId);
    assert.equal(restored?.selectedRevision, current.headRevision);
    assert.equal(restored?.note.contentRevision, current.headRevision);
  } finally {
    await f.close();
  }
});

test("reader discards a snapshot if purge commits during the read", async () => {
  const f = await fixture();
  try {
    const { db, op, receipt } = f;
    const base = {
      libraryId: op.libraryId,
      noteId: op.noteId,
      expectedRevision: receipt.headRevision,
      expectedLifecycleGeneration: receipt.lifecycleGeneration,
    };
    const trash = (await readerAction(db, "a", {
      ...base,
      kind: "trash",
      operationId: randomUUID(),
    })) as {
      headRevision: string;
      lifecycleGeneration: string;
      deletionId: string;
    };
    let count = 0;
    const raced = new Proxy(db, {
      get(target, key) {
        if (key === "execute")
          return async (query: Parameters<typeof db.execute>[0]) => {
            const result = await target.execute(query);
            count++;
            if (count === 3)
              await readerAction(db, "a", {
                ...base,
                kind: "purge",
                operationId: randomUUID(),
                expectedRevision: trash.headRevision,
                expectedLifecycleGeneration: trash.lifecycleGeneration,
                deletionId: trash.deletionId,
              });
            return result;
          };
        return Reflect.get(target, key);
      },
    });
    assert.equal(await readerDetail(raced, "a", op.noteId), null);
  } finally {
    await f.close();
  }
});
