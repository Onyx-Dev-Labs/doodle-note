import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MeetingFileStore } from "./store";

function fixture(t: { after(fn: () => void): void }): {
  dir: string;
  file: string;
  store: MeetingFileStore;
} {
  const dir = mkdtempSync(join(tmpdir(), "dn-text-update-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    file: join(dir, "fixture.json"),
    store: new MeetingFileStore(dir),
  };
}
const original = {
  id: "fixture",
  title: "Original",
  rawNotesMarkdown: "Personal notes",
  segments: [
    {
      id: "s1",
      text: "Transcript",
      channel: "mic",
      speaker: "You",
      futureSegment: true,
    },
  ],
  participants: [
    { id: "mic", name: "Corrected", source: "manual", futureParticipant: true },
  ],
  sourceScope: {
    libraryId: "canonical-library",
    accountId: null,
    workspaceId: null,
  },
  metadata: {
    selectedSummaryID: "chosen",
    summaries: [{ id: "chosen", text: "Corrected" }],
  },
  enhancedMarkdown: "Obsolete",
  ink: [1, 2],
  future: { keep: true },
};

test("text edits preserve all unedited raw fields and no-op edits preserve bytes and notifications", (t) => {
  const f = fixture(t),
    before = JSON.stringify(original);
  writeFileSync(f.file, before);
  let writes = 0;
  f.store.onDidWrite = () => {
    writes++;
  };
  f.store.updateText({
    id: "fixture",
    title: original.title,
    rawNotesMarkdown: original.rawNotesMarkdown,
  });
  assert.equal(readFileSync(f.file, "utf8"), before);
  assert.equal(writes, 0);
  f.store.updateText({ id: "fixture", rawNotesMarkdown: "Edited" });
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")), {
    ...original,
    rawNotesMarkdown: "Edited",
  });
  assert.equal(writes, 1);
  // A later text edit reads the current disk original, including external rich corrections.
  const newer = {
    ...original,
    rawNotesMarkdown: "Edited",
    title: "External title",
    ink: [3],
  };
  writeFileSync(f.file, JSON.stringify(newer));
  f.store.updateText({ id: "fixture", rawNotesMarkdown: "Latest" });
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")), {
    ...newer,
    rawNotesMarkdown: "Latest",
  });
});

test("invalid text payloads cannot inject, replace or clear reserved/richer fields", (t) => {
  const f = fixture(t),
    before = JSON.stringify(original);
  writeFileSync(f.file, before);
  const invalid: unknown[] = [null, [], {}, { id: "../escape", title: "x" }];
  for (const field of ["title", "rawNotesMarkdown"])
    for (const value of [null, undefined, [], 1, {}])
      invalid.push({ id: "fixture", [field]: value });
  for (const field of [
    "sourceScope",
    "metadata",
    "ink",
    "segments",
    "participants",
    "enhancedMarkdown",
    "trashedAt",
    "future",
  ])
    for (const value of [null, undefined, { injected: true }])
      invalid.push({ id: "fixture", title: "Bad", [field]: value });
  for (const patch of invalid) {
    assert.throws(
      () =>
        f.store.updateText(
          patch as Parameters<MeetingFileStore["updateText"]>[0],
        ),
      /Invalid meeting text edit/,
    );
    assert.equal(readFileSync(f.file, "utf8"), before);
    assert.deepEqual(readdirSync(f.dir), ["fixture.json"]);
  }
});

test("missing, malformed, trashed and unavailable originals are not replaced or resurrected", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.store.updateText({ id: "fixture", title: "New" }),
    /ENOENT/,
  );
  assert.deepEqual(readdirSync(f.dir), []);
  for (const raw of [
    "not-json",
    "null",
    "[]",
    '{"id":"other"}',
    JSON.stringify({ ...original, trashedAt: "2026-10-17T00:00:00.000Z" }),
  ]) {
    writeFileSync(f.file, raw);
    assert.throws(() => f.store.updateText({ id: "fixture", title: "New" }));
    assert.equal(readFileSync(f.file, "utf8"), raw);
  }
  const before = JSON.stringify(original);
  writeFileSync(f.file, before);
  const unavailable = new MeetingFileStore(f.dir, () => {
    throw new Error("Library unavailable");
  });
  assert.throws(
    () => unavailable.updateText({ id: "fixture", title: "New" }),
    /Library unavailable/,
  );
  assert.equal(readFileSync(f.file, "utf8"), before);
});

test("unreadable destination is rejected without creating temporary files", (t) => {
  const f = fixture(t);
  // A destination directory is unreadable as a meeting; it must never be replaced with a draft.
  mkdirSync(f.file);
  assert.throws(() => f.store.updateText({ id: "fixture", title: "New" }));
  assert.deepEqual(readdirSync(f.dir), ["fixture.json"]);
});
