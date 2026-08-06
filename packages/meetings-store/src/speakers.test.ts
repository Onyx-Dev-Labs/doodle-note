import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  labelSegments,
  normalizeParticipants,
  renameSpeaker,
  sanitizeSpeakerName,
  speakerInfos,
  withSelfParticipant,
} from "./speakers";
import { MeetingFileStore } from "./store";
import type { MeetingParticipant, TranscriptSegment } from "./types";

function segment(
  channel: "mic" | "system",
  text: string,
  startMs: number,
): TranscriptSegment {
  return {
    id: `s-${channel}-${startMs}`,
    channel,
    speaker: channel === "mic" ? "You" : "Them",
    speakerId: channel === "mic" ? "self" : "far",
    text,
    startMs,
    endMs: startMs + 1000,
    confidence: 0.9,
  };
}

const transcript: TranscriptSegment[] = [
  segment("mic", "Morning — thanks for making time.", 0),
  segment("system", "Of course.", 1000),
  segment("mic", "I will send the contract today.", 2000),
];

test("sanitizeSpeakerName strips control characters and caps length", () => {
  assert.equal(sanitizeSpeakerName("  Priya\tPatel \n"), "Priya Patel");
  assert.equal(sanitizeSpeakerName("a".repeat(80)).length, 40);
  assert.equal(sanitizeSpeakerName("   "), "");
});

test("renaming a speaker applies the name across the whole transcript", () => {
  const renamed = renameSpeaker({ segments: transcript }, "far", "Priya Patel");
  assert.deepEqual(
    renamed.segments.map((s) => s.speaker),
    ["You", "Priya Patel", "You"],
  );
  assert.deepEqual(renamed.participants, [
    { id: "far", name: "Priya Patel", source: "manual", confidence: 1 },
  ]);
});

test("clearing a name restores the channel default everywhere", () => {
  const named = renameSpeaker({ segments: transcript }, "far", "Priya");
  const cleared = renameSpeaker(named, "far", "  ");
  assert.deepEqual(
    cleared.segments.map((s) => s.speaker),
    ["You", "Them", "You"],
  );
  assert.deepEqual(cleared.participants, []);
});

test("the profile name labels the user's own lines, a rename still wins", () => {
  const roster = withSelfParticipant([], "Sean");
  assert.deepEqual(
    labelSegments(transcript, roster).map((s) => s.speaker),
    ["Sean", "Them", "Sean"],
  );

  const manual: MeetingParticipant[] = [
    { id: "self", name: "Sean Inman", source: "manual", confidence: 1 },
  ];
  assert.deepEqual(withSelfParticipant(manual, "Sean"), manual);
});

test("speakerInfos reports each label and who the note-taker is", () => {
  const roster = withSelfParticipant([], "Sean");
  assert.deepEqual(speakerInfos(transcript, roster), [
    { label: "Sean", isSelf: true },
    { label: "Them", isSelf: false },
  ]);
});

test("normalizeParticipants drops junk and de-duplicates ids", () => {
  assert.deepEqual(
    normalizeParticipants([
      { id: "far", name: " Priya ", source: "calendar", confidence: 0.8 },
      { id: "far", name: "Someone else" },
      { id: "", name: "No id" },
      { id: "far-2", name: "" },
      "nope",
    ]),
    [{ id: "far", name: "Priya", source: "calendar", confidence: 0.8 }],
  );
});

test("legacy segments without speaker ids keep working through the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "speakers-store-"));
  try {
    const store = new MeetingFileStore(dir);
    store.upsert({
      id: "meeting-1",
      segments: [
        {
          id: "old-1",
          channel: "system",
          speaker: "Them",
          text: "Legacy line.",
          startMs: 0,
          endMs: 500,
          confidence: 0.9,
        } as TranscriptSegment,
      ],
    });
    // Naming the far side rewrites the stored label, id backfilled from channel.
    const record = store.upsert({
      id: "meeting-1",
      participants: [
        { id: "far", name: "Priya", source: "manual", confidence: 1 },
      ],
    });
    assert.equal(record.segments[0]?.speakerId, "far");
    assert.equal(record.segments[0]?.speaker, "Priya");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
