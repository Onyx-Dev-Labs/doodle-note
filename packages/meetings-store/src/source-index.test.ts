import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { DerivedSourceIndex } from "./derived-index";
import {
  SourceIndexClient,
  StaleSourceRequestError,
} from "./source-index-client";
import {
  localSourceScope,
  projectSources,
  resolveOriginalSource,
  searchOriginalSources,
  SOURCE_IDENTITY_FILE,
} from "./source-projection";
import type { SourceContext } from "./source-contract";

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), "doodle-sources-"));
  const dir = join(root, "meetings");
  mkdirSync(dir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = {
    meetingsDir: dir,
    scope: localSourceScope(dir, true),
    authorized: true,
  };
  const put = (id: string, patch: Record<string, unknown> = {}) =>
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        id,
        title: id,
        rawNotesMarkdown: "",
        segments: [],
        ...patch,
      }),
    );
  return { root, dir, context, put };
}

test("full eligible history includes an old late passage without summary; lexical cache and readonly scan agree", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 501; i++)
    f.put(`meeting-${i}`, { createdAt: new Date(i * 86400000).toISOString() });
  f.put("meeting-0", {
    segments: [
      {
        id: "old-passage",
        text: "earlier words ".repeat(200) + "Café launch Δοκιμή 東京計画",
        speaker: "Manual name",
      },
    ],
  });
  const before = readFileSync(join(f.dir, "meeting-0.json"));
  const index = new DerivedSourceIndex(join(f.root, "cache"));
  t.after(() => index.close());
  for (const query of [
    "cafe launch",
    "fé",
    "東京",
    "東京計画",
    "Δοκιμή",
    '"launch"',
    "*",
  ]) {
    assert.deepEqual(
      index.search(f.context, query),
      searchOriginalSources(f.context, query),
    );
  }
  const result = index.search(f.context, "launch");
  assert.equal(result.eligibleMeetingCount, 501);
  assert.equal(result.hits[0]?.anchor.sourceId, "transcript:old-passage");
  assert.equal(result.hits[0]?.speaker, "Manual name");
  assert.equal(result.freshness, "reconciled");
  assert.equal(
    resolveOriginalSource(f.context, result.hits[0]!.anchor).status,
    "resolved",
  );
  assert.deepEqual(readFileSync(join(f.dir, "meeting-0.json")), before);
});

test("edits, speaker corrections, trash, restore, imports and hard deletions reconcile with explicit stale resolution", (t) => {
  const f = fixture(t);
  const index = new DerivedSourceIndex(join(f.root, "cache"));
  t.after(() => index.close());
  f.put("old", { rawNotesMarkdown: "needle" });
  const anchor = index.search(f.context, "needle").hits[0]!.anchor;
  f.put("old", { rawNotesMarkdown: "replacement" });
  assert.equal(resolveOriginalSource(f.context, anchor).status, "stale");
  assert.equal(index.search(f.context, "needle").hits.length, 0);
  f.put("old", { rawNotesMarkdown: "replacement", trashedAt: "2026-01-01" });
  assert.equal(index.search(f.context, "replacement").eligibleMeetingCount, 0);
  assert.equal(resolveOriginalSource(f.context, anchor).status, "missing");
  f.put("old", { rawNotesMarkdown: "needle" });
  assert.equal(index.search(f.context, "needle").hits.length, 1);
  f.put("imported", {
    segments: [{ id: "s", source: "text", text: "needle", speaker: "Editor" }],
  });
  assert.equal(index.search(f.context, "needle").matchedMeetingCount, 2);
  rmSync(join(f.dir, "old.json"));
  assert.equal(index.search(f.context, "needle").matchedMeetingCount, 1);
});

test("explicit library/account/workspace isolation and revoked scopes never infer ownership", (t) => {
  const f = fixture(t);
  const index = new DerivedSourceIndex(join(f.root, "cache"));
  t.after(() => index.close());
  f.put("local", { rawNotesMarkdown: "private" });
  const accountScope = {
    ...f.context.scope,
    accountId: "alice",
    workspaceId: "team",
  };
  f.put("bound", { rawNotesMarkdown: "private", sourceScope: accountScope });
  assert.equal(
    index.search(f.context, "private").hits[0]?.anchor.meetingId,
    "local",
  );
  const account = { ...f.context, scope: accountScope };
  const hit = index.search(account, "private").hits[0]!;
  assert.equal(hit.anchor.meetingId, "bound");
  assert.equal(
    index.search(
      { ...account, scope: { ...accountScope, accountId: "bob" } },
      "private",
    ).hits.length,
    0,
  );
  assert.equal(
    resolveOriginalSource(f.context, hit.anchor).status,
    "unauthorized",
  );
  assert.throws(
    () => index.search({ ...account, authorized: false }, "private"),
    /unauthorized/,
  );
  assert.equal(index.search(f.context, "private").hits.length, 1);
});

test("coverage distinguishes truncation, corrupt files and missing selected summaries; richer originals remain byte-identical", (t) => {
  const f = fixture(t);
  f.put("rich", {
    rawNotesMarkdown: "needle\nneedle",
    segments: [{ id: "echo", text: "hidden", echo: true }],
    enhancedMarkdown: "obsolete summary",
    metadata: {
      selectedSummaryID: "missing",
      summaries: [],
      revisionID: "retained",
    },
    ink: { opaque: [1, 2] },
  });
  writeFileSync(join(f.dir, "corrupt.json"), "{");
  const before = readFileSync(join(f.dir, "rich.json"));
  const result = searchOriginalSources(f.context, "needle", 1);
  assert.equal(result.matchedSourceCount, 2);
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.countsAreComplete, false);
  assert.equal(result.isExhaustive, false);
  assert.equal(searchOriginalSources(f.context, "obsolete").hits.length, 0);
  assert.equal(searchOriginalSources(f.context, "hidden").hits.length, 0);
  assert.deepEqual(readFileSync(join(f.dir, "rich.json")), before);
  const p = projectSources(
    {
      id: "rich",
      segments: [],
      metadata: {
        selectedSummaryID: "v1",
        summaries: [
          { id: "v1", text: "selected" },
          { id: "v0", text: "old" },
        ],
      },
    },
    f.context.scope,
  )!;
  assert.equal(p.passages[0]?.anchor.sourceId, "summary:v1");
});

test("relocation preserves anchors; independent libraries differ; missing/corrupt identity never gets silently overwritten", (t) => {
  const f = fixture(t);
  f.put("a", { rawNotesMarkdown: "needle" });
  const anchor = searchOriginalSources(f.context, "needle").hits[0]!.anchor;
  const moved = join(f.root, "relocated");
  cpSync(f.dir, moved, { recursive: true });
  assert.deepEqual(localSourceScope(moved), f.context.scope);
  assert.equal(
    resolveOriginalSource({ ...f.context, meetingsDir: moved }, anchor).status,
    "resolved",
  );
  const other = join(f.root, "other");
  mkdirSync(other);
  assert.notEqual(localSourceScope(other, true).libraryId, anchor.libraryId);
  rmSync(join(other, SOURCE_IDENTITY_FILE));
  const before = readdirSync(other);
  assert.match(localSourceScope(other).libraryId, /^legacy-/);
  assert.deepEqual(readdirSync(other), before);
  writeFileSync(join(other, SOURCE_IDENTITY_FILE), "{");
  assert.throws(() => localSourceScope(other, true));
  assert.equal(readFileSync(join(other, SOURCE_IDENTITY_FILE), "utf8"), "{");
});

test("corrupt cache rebuild and interrupted transactions preserve originals; restart is rebuildable", (t) => {
  const f = fixture(t);
  f.put("a", { rawNotesMarkdown: "needle" });
  const cache = join(f.root, "cache");
  mkdirSync(cache);
  writeFileSync(join(cache, "sources-v1.sqlite"), "not a database");
  let index = new DerivedSourceIndex(cache);
  assert.equal(index.search(f.context, "needle").hits.length, 1);
  f.put("b", { rawNotesMarkdown: "needle" });
  let checkpoints = 0;
  assert.throws(
    () =>
      index.search(f.context, "needle", 50, 0, () => {
        if (++checkpoints === 6) throw new Error("cancelled");
      }),
    /cancelled/,
  );
  index.close();
  index = new DerivedSourceIndex(cache);
  t.after(() => index.close());
  assert.equal(index.search(f.context, "needle").matchedMeetingCount, 2);
  assert.equal(
    JSON.parse(readFileSync(join(f.dir, "b.json"), "utf8")).rawNotesMarkdown,
    "needle",
  );
});

function clientFor(
  f: ReturnType<typeof fixture>,
  context: () => SourceContext = () => f.context,
) {
  const worker = new Worker(
    `require(${JSON.stringify(fileURLToPath(import.meta.resolve("tsx/cjs")))}); require(${JSON.stringify(fileURLToPath(new URL("./source-index-worker.ts", import.meta.url)))});`,
    {
      eval: true,
      workerData: { meetingsDir: f.dir, cacheDir: join(f.root, "cache") },
    },
  );
  return new SourceIndexClient(worker, context);
}

test("real worker keeps scans off caller; cancellation, local edits and scope changes fence stale asynchronous results", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 1000; i++)
    f.put(`m-${i}`, { rawNotesMarkdown: "needle ".repeat(200) });
  let context = f.context;
  const client = clientFor(f, () => context);
  t.after(() => client.close());
  assert.equal((await client.search("needle", 1)).matchedMeetingCount, 1000);
  const pending = client.search("needle");
  await new Promise((resolve) => setImmediate(resolve));
  client.invalidate();
  await assert.rejects(pending, StaleSourceRequestError);
  const abort = new AbortController();
  const cancelled = client.search("needle", 50, abort.signal);
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(cancelled, /cancelled/);
  const switched = client.search("needle");
  await new Promise((resolve) => setImmediate(resolve));
  context = { ...context, authorized: false };
  await assert.rejects(switched, StaleSourceRequestError);
  context = f.context;
  assert.equal((await client.search("needle", 1)).hits.length, 1);
});

test("explicit ownership survives legacy store edits and malformed ownership remains ineligible", async (t) => {
  const f = fixture(t);
  const { MeetingFileStore } = await import("./store");
  const store = new MeetingFileStore(f.dir);
  const scope = {
    ...f.context.scope,
    accountId: "account",
    workspaceId: "workspace",
  };
  store.upsert({
    id: "owned",
    sourceScope: scope,
    rawNotesMarkdown: "private",
  });
  store.upsert({ id: "owned", title: "edited" });
  assert.deepEqual(store.get("owned")?.sourceScope, scope);
  assert.equal(searchOriginalSources(f.context, "private").hits.length, 0);
  f.put("malformed", { sourceScope: {}, rawNotesMarkdown: "private" });
  store.upsert({ id: "malformed", title: "edited" });
  assert.equal(searchOriginalSources(f.context, "private").hits.length, 0);
});

test(
  "unreadable and mismatched originals report incomplete coverage, never a complete empty result",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async (t) => {
    const f = fixture(t);
    const { chmodSync, symlinkSync } = await import("node:fs");
    f.put("unreadable", { rawNotesMarkdown: "private" });
    chmodSync(join(f.dir, "unreadable.json"), 0);
    t.after(() => {
      try {
        chmodSync(join(f.dir, "unreadable.json"), 0o600);
      } catch {}
    });
    writeFileSync(
      join(f.dir, "wrong.json"),
      JSON.stringify({ id: "different", rawNotesMarkdown: "private" }),
    );
    symlinkSync(join(f.dir, "wrong.json"), join(f.dir, "linked.json"));
    const result = searchOriginalSources(f.context, "private");
    assert.equal(result.countsAreComplete, false);
    assert.equal(result.unavailableCount, 3);
  },
);

test("external writes/deletes/imports during reconciliation remove obsolete hits and mark counts incomplete", async (t) => {
  const f = fixture(t);
  f.put("a", { rawNotesMarkdown: "needle" });
  f.put("b", { rawNotesMarkdown: "needle" });
  const { scanSources, sourceResult } = await import("./source-projection");
  const snapshot = scanSources(f.context);
  rmSync(join(f.dir, "a.json"));
  f.put("b", { rawNotesMarkdown: "replacement" });
  f.put("new", { rawNotesMarkdown: "needle" });
  const result = sourceResult(
    snapshot,
    f.context,
    0,
    snapshot.documents.flatMap((d) => d.passages),
    50,
  );
  assert.equal(result.hits.length, 0);
  assert.equal(result.countsAreComplete, false);
  assert.equal(result.isExhaustive, false);
  assert.equal(result.unavailableCount, 3);
  assert.equal(
    searchOriginalSources(f.context, "needle").hits[0]?.anchor.meetingId,
    "new",
  );
});

test(
  "readonly legacy library can be read without identity writes; failed desktop initialization preserves files",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async (t) => {
    const f = fixture(t);
    f.put("a", { rawNotesMarkdown: "needle" });
    const { chmodSync } = await import("node:fs");
    rmSync(join(f.dir, SOURCE_IDENTITY_FILE));
    chmodSync(f.dir, 0o500);
    try {
      const scope = localSourceScope(f.dir);
      assert.match(scope.libraryId, /^legacy-/);
      assert.equal(
        searchOriginalSources({ ...f.context, scope }, "needle").hits.length,
        1,
      );
      assert.throws(() => localSourceScope(f.dir, true));
      assert.deepEqual(readdirSync(f.dir), ["a.json"]);
    } finally {
      chmodSync(f.dir, 0o700);
    }
  },
);
