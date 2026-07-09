import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MeetingFileStore } from "@repo/meetings-store";
import type { TranscriptSegment } from "@repo/meetings-store";
import { LocalMeetingSource } from "./local-source";

function seg(
  text: string,
  opts: Partial<TranscriptSegment> & { startMs?: number } = {},
): TranscriptSegment {
  return {
    id: opts.id ?? `s-${opts.startMs ?? 0}`,
    channel: opts.channel ?? "mic",
    speaker: opts.speaker ?? "You",
    text,
    startMs: opts.startMs ?? 0,
    endMs: (opts.startMs ?? 0) + 1000,
    confidence: 0.9,
    ...(opts.absoluteStartMs !== undefined
      ? { absoluteStartMs: opts.absoluteStartMs }
      : {}),
    ...(opts.echo !== undefined ? { echo: opts.echo } : {}),
  };
}

function fixture(): {
  source: LocalMeetingSource;
  store: MeetingFileStore;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "doodle-mcp-"));
  const store = new MeetingFileStore(dir);
  store.upsert({
    id: "meet-1",
    title: "Kickoff",
    createdAt: "2026-07-01T10:00:00.000Z",
    startedAt: "2026-07-01T10:00:00.000Z",
    endedAt: "2026-07-01T10:30:00.000Z",
    rawNotesMarkdown: "agenda",
    enhancedMarkdown: "## Kickoff notes",
    engine: "local:qwen3-4b-instruct",
    segments: [
      seg("hello there", { speaker: "You", startMs: 0, absoluteStartMs: 1000 }),
      seg("hi, thanks for joining", {
        speaker: "Them",
        channel: "system",
        startMs: 0,
        absoluteStartMs: 500,
        id: "sys-0",
      }),
      seg("echo bleed", { speaker: "You", startMs: 2000, echo: true }),
    ],
  });
  store.upsert({
    id: "trashed-1",
    title: "Secret meeting",
    createdAt: "2026-07-02T10:00:00.000Z",
    trashedAt: "2026-07-03T10:00:00.000Z",
    rawNotesMarkdown: "sensitive",
  });
  store.upsert({
    id: "note-1",
    kind: "note",
    title: "Quick idea",
    createdAt: "2026-07-03T10:00:00.000Z",
    rawNotesMarkdown: "remember this",
  });
  return {
    source: new LocalMeetingSource(dir),
    store,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("listRecent excludes trashed meetings and marks kinds", async () => {
  const { source, cleanup } = fixture();
  try {
    const meetings = await source.listRecent(10);
    assert.deepEqual(
      meetings.map((m) => m.meeting_id),
      ["note-1", "meet-1"],
    );
    assert.equal(meetings[0]?.kind, "note");
    assert.equal(meetings[1]?.kind, "meeting");
    assert.equal(meetings[1]?.duration_min, 30);
  } finally {
    cleanup();
  }
});

test("trashed meetings are invisible to every tool, including search and direct get", async () => {
  const { source, cleanup } = fixture();
  try {
    assert.equal(await source.getMeeting("trashed-1"), null);
    assert.equal(await source.getNotes("trashed-1"), null);
    assert.equal(await source.getTranscript("trashed-1"), null);
    const hits = await source.search("sensitive", 10);
    assert.deepEqual(hits, []);
  } finally {
    cleanup();
  }
});

test("transcript filters echo segments and orders by wall clock", async () => {
  const { source, cleanup } = fixture();
  try {
    const t = await source.getTranscript("meet-1");
    assert.ok(t);
    assert.deepEqual(
      t.segments.map((s) => s.speaker),
      ["Them", "You"], // absoluteStartMs 500 before 1000
    );
    assert.ok(!t.text.includes("echo bleed"));
    assert.equal(t.text, "Them: hi, thanks for joining\nYou: hello there");
  } finally {
    cleanup();
  }
});

test("notes carry raw + enhanced markdown and the generating engine", async () => {
  const { source, cleanup } = fixture();
  try {
    const notes = await source.getNotes("meet-1");
    assert.ok(notes);
    assert.equal(notes.raw_notes_markdown, "agenda");
    assert.equal(notes.enhanced_markdown, "## Kickoff notes");
    assert.equal(notes.generated_with, "local:qwen3-4b-instruct");
  } finally {
    cleanup();
  }
});

test("has_transcript is false when the only segments are echo", async () => {
  const { source, store, cleanup } = fixture();
  try {
    store.upsert({
      id: "echo-only",
      title: "Echoes",
      createdAt: "2026-07-04T10:00:00.000Z",
      segments: [seg("ghost", { echo: true })],
    });
    const meeting = await source.getMeeting("echo-only");
    assert.equal(meeting?.has_transcript, false);
  } finally {
    cleanup();
  }
});
