import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  localSourceScope,
  searchOriginalSources,
} from "@repo/meetings-store/sources";
import { LocalMeetingSource } from "./local-source";
import { LOCAL_SOURCE_TOOLS } from "./source-tools";

test("local MCP full-history tools retain anchors, match desktop projection and never write originals/identity/cache", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mcp-sources-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "meetings");
  mkdirSync(dir);
  for (let i = 0; i < 501; i++)
    writeFileSync(
      join(dir, `m-${i}.json`),
      JSON.stringify({
        id: `m-${i}`,
        segments: [
          {
            id: "s",
            text: i === 0 ? "earlier ".repeat(500) + "Café needle" : "ordinary",
            speaker: "Manual",
          },
        ],
      }),
    );
  const before = readdirSync(dir).map((file) => [
    file,
    readFileSync(join(dir, file), "utf8"),
  ]);
  const source = new LocalMeetingSource(dir);
  const result = await source.retrieveSources("cafe needle");
  assert.deepEqual(
    result,
    searchOriginalSources(
      { meetingsDir: dir, scope: localSourceScope(dir), authorized: true },
      "cafe needle",
    ),
  );
  assert.equal(result.eligibleMeetingCount, 501);
  assert.equal(result.hits[0]?.anchor.sourceId, "transcript:s");
  assert.equal(
    (await source.resolveSource(result.hits[0]!.anchor)).status,
    "resolved",
  );
  assert.equal(
    (await source.getTranscript("m-0"))?.segments[0]?.segment_id,
    "s",
  );
  assert.deepEqual(
    readdirSync(dir).map((file) => [
      file,
      readFileSync(join(dir, file), "utf8"),
    ]),
    before,
  );
  assert.equal(
    (await LOCAL_SOURCE_TOOLS[0]!.run(source, { query: "needle" }))
      .matchedMeetingCount,
    1,
  );
  await assert.rejects(
    LOCAL_SOURCE_TOOLS[0]!.run(source, { query: "needle", limit: -1 }),
  );
  writeFileSync(
    join(dir, "m-0.json"),
    JSON.stringify({ id: "m-0", rawNotesMarkdown: "edited" }),
  );
  assert.equal(
    (await source.resolveSource(result.hits[0]!.anchor)).status,
    "stale",
  );
});

test("MCP relocation, consent revocation, trash and malformed identity fail closed", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mcp-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, "first");
  mkdirSync(first);
  localSourceScope(first, true);
  writeFileSync(
    join(first, "a.json"),
    JSON.stringify({ id: "a", rawNotesMarkdown: "needle" }),
  );
  let dir = first;
  let enabled = true;
  const source = new LocalMeetingSource(() => {
    if (!enabled) throw new Error("Revoked");
    return dir;
  });
  const anchor = (await source.retrieveSources("needle")).hits[0]!.anchor;
  const next = join(root, "next");
  cpSync(first, next, { recursive: true });
  dir = next;
  assert.equal((await source.resolveSource(anchor)).status, "resolved");
  writeFileSync(
    join(next, "a.json"),
    JSON.stringify({
      id: "a",
      trashedAt: "2026-01-01",
      rawNotesMarkdown: "needle",
    }),
  );
  assert.equal((await source.retrieveSources("needle")).hits.length, 0);
  assert.equal((await source.resolveSource(anchor)).status, "missing");
  enabled = false;
  await assert.rejects(source.retrieveSources("needle"), /Revoked/);
  enabled = true;
  writeFileSync(join(next, ".doodlenote-source-library.json"), "{");
  await assert.rejects(source.retrieveSources("needle"));
});

test("legacy local MCP tools also exclude explicitly account-bound and malformed ownership", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-account-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scope = localSourceScope(dir, true);
  for (const [id, owner] of [
    ["bound", { ...scope, accountId: "a", workspaceId: "w" }],
    ["malformed", {}],
  ])
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        id,
        sourceScope: owner,
        rawNotesMarkdown: "private",
        segments: [{ id: "s", text: "private" }],
      }),
    );
  const source = new LocalMeetingSource(dir);
  assert.equal((await source.listRecent(50)).length, 0);
  assert.equal((await source.search("private", 50)).length, 0);
  for (const id of ["bound", "malformed"]) {
    assert.equal(await source.getMeeting(id), null);
    assert.equal(await source.getNotes(id), null);
    assert.equal(await source.getTranscript(id), null);
  }
  assert.equal(
    (await source.retrieveSources("private")).countsAreComplete,
    false,
  );
});

test("a scope/consent change during a local source request fences its completed result", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mcp-inflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = join(root, "a");
  const second = join(root, "b");
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(
    join(first, "a.json"),
    JSON.stringify({ id: "a", rawNotesMarkdown: "needle" }),
  );
  let calls = 0;
  const moved = new LocalMeetingSource(() => (++calls === 1 ? first : second));
  await assert.rejects(moved.retrieveSources("needle"), /scope changed/);
  calls = 0;
  const revoked = new LocalMeetingSource(() => {
    if (++calls > 1) throw new Error("Revoked");
    return first;
  });
  await assert.rejects(revoked.retrieveSources("needle"), /Revoked/);
});
