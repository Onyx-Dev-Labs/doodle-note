import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MeetingFileStore } from "./store";
import type { TranscriptSegment } from "./types";

function tempStore(): {
  store: MeetingFileStore;
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "meetings-store-"));
  return {
    store: new MeetingFileStore(dir),
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function segment(text: string, startMs = 0, endMs = 1000): TranscriptSegment {
  return {
    id: `s-${startMs}`,
    channel: "mic",
    speaker: "You",
    text,
    startMs,
    endMs,
    confidence: 0.9,
  };
}

test("upsert + get round-trips a record and fills defaults", () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsert({ id: "abc-123", title: "Standup" });
    const got = store.get("abc-123");
    assert.ok(got);
    assert.equal(got.title, "Standup");
    assert.equal(got.rawNotesMarkdown, "");
    assert.deepEqual(got.segments, []);
    assert.equal(got.echoSuppressed, 0);
  } finally {
    cleanup();
  }
});

test("upsert merges patches; null folderId clears the field", () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsert({ id: "m1", title: "A", folderId: "f1" });
    store.upsert({ id: "m1", enhancedMarkdown: "## Notes" });
    assert.equal(store.get("m1")?.folderId, "f1");
    assert.equal(store.get("m1")?.enhancedMarkdown, "## Notes");
    store.upsert({ id: "m1", folderId: null });
    assert.equal(store.get("m1")?.folderId, undefined);
  } finally {
    cleanup();
  }
});

test("rejects unsafe ids for reads and writes", () => {
  const { store, cleanup } = tempStore();
  try {
    assert.throws(() => store.upsert({ id: "../evil", title: "x" }));
    assert.equal(store.get("../evil"), null);
  } finally {
    cleanup();
  }
});

test("list sorts newest-first and carries kind/trash markers", () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsert({
      id: "old",
      title: "Old",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.upsert({
      id: "new",
      title: "New",
      createdAt: "2026-06-01T00:00:00.000Z",
      kind: "note",
    });
    store.upsert({
      id: "gone",
      title: "Gone",
      createdAt: "2026-03-01T00:00:00.000Z",
      trashedAt: "2026-03-02T00:00:00.000Z",
    });
    const list = store.list();
    assert.deepEqual(
      list.map((m) => m.id),
      ["new", "gone", "old"],
    );
    assert.equal(list[0]?.kind, "note");
    assert.ok(list[1]?.trashedAt);
  } finally {
    cleanup();
  }
});

test("search reports strongest field: title > notes > transcript", () => {
  const { store, cleanup } = tempStore();
  try {
    store.upsert({ id: "a", title: "Budget review" });
    store.upsert({
      id: "b",
      title: "Standup",
      rawNotesMarkdown: "discuss budget line",
    });
    store.upsert({
      id: "c",
      title: "Sync",
      segments: [segment("the budget is fine")],
    });
    const hits = store.search("budget");
    const byId = Object.fromEntries(hits.map((h) => [h.id, h.field]));
    assert.deepEqual(byId, { a: "title", b: "notes", c: "transcript" });
  } finally {
    cleanup();
  }
});

test("corrupt files are skipped rather than crashing the list", () => {
  const { store, dir, cleanup } = tempStore();
  try {
    store.upsert({ id: "ok1", title: "Fine" });
    writeFileSync(join(dir, "bad.json"), "{ not json");
    assert.deepEqual(
      store.list().map((m) => m.id),
      ["ok1"],
    );
  } finally {
    cleanup();
  }
});

test("onDidWrite fires with deletedId on trash and delete", () => {
  const { store, cleanup } = tempStore();
  try {
    const events: Array<{ deletedId?: string }> = [];
    store.onDidWrite = (c) => events.push(c);
    store.upsert({ id: "m1", title: "A" });
    store.upsert({ id: "m1", trashedAt: new Date().toISOString() });
    store.delete("m1");
    assert.deepEqual(events, [{}, { deletedId: "m1" }, { deletedId: "m1" }]);
  } finally {
    cleanup();
  }
});
