import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeetingRecord } from "@repo/meetings-store";
import { buildFinalizedEvent } from "./event";
import { buildGBrainPayload, fileDate, slugify } from "./gbrain-markdown";

function record(): MeetingRecord {
  return {
    id: "0b7e4a2c-1111-4222-8333-abcdefabcdef",
    title: "Quarterly Budget: Review!",
    createdAt: "2026-07-08T09:55:00.000Z",
    startedAt: "2026-07-08T10:00:00.000Z",
    endedAt: "2026-07-08T10:45:00.000Z",
    calendarEventId: "cal-evt-42",
    rawNotesMarkdown: "- follow up with legal",
    enhancedMarkdown: "## Decisions\n- budget approved",
    segments: [
      {
        id: "s1",
        channel: "mic",
        speaker: "You",
        text: "shall we approve the budget",
        startMs: 0,
        endMs: 2000,
        confidence: 0.95,
      },
      {
        id: "s2",
        channel: "system",
        speaker: "Them",
        text: "approved",
        startMs: 2000,
        endMs: 3000,
        confidence: 0.92,
      },
    ],
    echoSuppressed: 1,
  };
}

test("slugify produces stable, filesystem-safe slugs", () => {
  assert.equal(slugify("Quarterly Budget: Review!"), "quarterly-budget-review");
  assert.equal(slugify("  Café / naïve—test  "), "cafe-naive-test");
  assert.equal(slugify("!!!"), "untitled");
  assert.ok(slugify("x".repeat(200)).length <= 50);
});

test("payload uses the deterministic <date>-<slug>-<id> layout", () => {
  const event = buildFinalizedEvent(record(), {
    folderName: "Finance",
    finalizedAt: "2026-07-08T11:00:00.000Z",
  });
  const payload = buildGBrainPayload(event);
  assert.equal(fileDate(event), "20260708");
  const base =
    "20260708-quarterly-budget-review-0b7e4a2c-1111-4222-8333-abcdefabcdef";
  assert.deepEqual(
    payload.files.map((f) => f.path),
    [`meetings/${base}.md`, `meeting-summaries/${base}-summary.md`],
  );
  assert.equal(payload.index.meeting_path, `meetings/${base}.md`);
  assert.equal(payload.doodlenote_id, event.meeting.id);
  assert.equal(payload.content_hash, event.content_hash);
});

test("rendering is byte-deterministic for the same event", () => {
  const event = buildFinalizedEvent(record(), {
    finalizedAt: "2026-07-08T11:00:00.000Z",
  });
  const a = buildGBrainPayload(event);
  const b = buildGBrainPayload(event);
  assert.deepEqual(a, b);
  assert.equal(a.files[0]!.content, b.files[0]!.content);
});

test("meeting doc carries frontmatter, raw notes, and transcript; summary doc carries enhanced notes", () => {
  const event = buildFinalizedEvent(record(), {
    folderName: "Finance",
    finalizedAt: "2026-07-08T11:00:00.000Z",
  });
  const [meetingFile, summaryFile] = buildGBrainPayload(event).files;
  const doc = meetingFile!.content;
  assert.ok(doc.startsWith("---\nsource: DoodleNote\n"));
  assert.match(doc, /source_kind: doodlenote-meeting\n/);
  assert.match(doc, /doodlenote_id: 0b7e4a2c-1111-4222-8333-abcdefabcdef\n/);
  assert.match(doc, /title: "Quarterly Budget: Review!"\n/);
  assert.match(doc, /calendar_event_id: "cal-evt-42"\n/);
  assert.match(doc, /folder: "Finance"\n/);
  assert.match(doc, /content_hash: [0-9a-f]{64}\n/);
  assert.match(doc, /## My notes\n\n- follow up with legal/);
  assert.match(
    doc,
    /## Transcript\n\nYou: shall we approve the budget\nThem: approved/,
  );

  const summary = summaryFile!.content;
  assert.match(summary, /source_kind: doodlenote-meeting-summary\n/);
  assert.match(summary, /## Decisions\n- budget approved/);
  assert.ok(
    !summary.includes("shall we approve"),
    "summary must not embed the transcript",
  );
});

test("echo segments never reach the export", () => {
  const rec = record();
  rec.segments.push({
    id: "s3",
    channel: "mic",
    speaker: "You",
    text: "ghost echo line",
    startMs: 4000,
    endMs: 5000,
    confidence: 0.5,
    echo: true,
  });
  const event = buildFinalizedEvent(rec, {
    finalizedAt: "2026-07-08T11:00:00.000Z",
  });
  assert.ok(
    !JSON.stringify(buildGBrainPayload(event)).includes("ghost echo line"),
  );
});
