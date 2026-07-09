import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeetingRecord } from "@repo/meetings-store";
import {
  MAX_ATTEMPTS,
  connectorStatus,
  planDeliveries,
  recordFailure,
  recordSuccess,
  resetFailures,
} from "./dispatcher";
import { contentHashOf } from "./event";
import type { ConnectorStateMap } from "./types";

function meeting(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "m1",
    title: "Kickoff",
    createdAt: "2026-07-01T10:00:00.000Z",
    rawNotesMarkdown: "raw",
    enhancedMarkdown: "## Notes",
    segments: [],
    echoSuppressed: 0,
    ...overrides,
  };
}

const NOW = 1_800_000_000_000;

test("plans a delivery for a finalized meeting once, then never again while unchanged", () => {
  const records = [meeting()];
  let state: ConnectorStateMap = {};
  const first = planDeliveries({
    records,
    state,
    connectorIds: ["gbrain"],
    now: NOW,
  });
  assert.equal(first.length, 1);
  state = recordSuccess(state, first[0]!, NOW);
  const second = planDeliveries({
    records,
    state,
    connectorIds: ["gbrain"],
    now: NOW + 1,
  });
  assert.deepEqual(second, []);
});

test("content change re-plans delivery with a new hash", () => {
  const original = meeting();
  let state: ConnectorStateMap = {};
  state = recordSuccess(
    state,
    {
      connectorId: "gbrain",
      meetingId: "m1",
      contentHash: contentHashOf(original),
    },
    NOW,
  );
  const edited = meeting({ enhancedMarkdown: "## Notes v2" });
  const planned = planDeliveries({
    records: [edited],
    state,
    connectorIds: ["gbrain"],
    now: NOW,
  });
  assert.equal(planned.length, 1);
  assert.notEqual(planned[0]!.contentHash, contentHashOf(original));
});

test("unfinalized meetings never plan: no notes, or trashed", () => {
  const noNotes = meeting({ enhancedMarkdown: undefined });
  const trashed = meeting({ id: "m2", trashedAt: "2026-07-02T00:00:00.000Z" });
  const planned = planDeliveries({
    records: [noNotes, trashed],
    state: {},
    connectorIds: ["gbrain"],
    now: NOW,
  });
  assert.deepEqual(planned, []);
});

test("retryable failure backs off exponentially and stops at MAX_ATTEMPTS", () => {
  const records = [meeting()];
  let state: ConnectorStateMap = {};
  let now = NOW;
  let attempts = 0;
  for (let i = 0; i < 20; i++) {
    const planned = planDeliveries({
      records,
      state,
      connectorIds: ["gbrain"],
      now,
    });
    if (planned.length === 0) {
      const entry = state["gbrain"]!["m1"]!;
      if (entry.attempts >= MAX_ATTEMPTS) break;
      now = entry.nextAttemptAt!; // jump past the backoff window
      continue;
    }
    attempts++;
    state = recordFailure(state, planned[0]!, "boom", true, now);
  }
  assert.equal(attempts, MAX_ATTEMPTS);
  // Exhausted — even far in the future nothing is planned.
  const later = planDeliveries({
    records,
    state,
    connectorIds: ["gbrain"],
    now: now + 10 ** 9,
  });
  assert.deepEqual(later, []);
});

test("non-retryable failure exhausts immediately but new content retries", () => {
  const records = [meeting()];
  let state: ConnectorStateMap = {};
  const planned = planDeliveries({
    records,
    state,
    connectorIds: ["gbrain"],
    now: NOW,
  });
  state = recordFailure(state, planned[0]!, "bad key", false, NOW);
  assert.deepEqual(
    planDeliveries({
      records,
      state,
      connectorIds: ["gbrain"],
      now: NOW + 10 ** 9,
    }),
    [],
  );
  const edited = [meeting({ title: "Kickoff (renamed)" })];
  assert.equal(
    planDeliveries({
      records: edited,
      state,
      connectorIds: ["gbrain"],
      now: NOW,
    }).length,
    1,
  );
});

test("resetFailures clears attempts so a manual retry re-plans", () => {
  const records = [meeting()];
  let state: ConnectorStateMap = {};
  const planned = planDeliveries({
    records,
    state,
    connectorIds: ["gbrain"],
    now: NOW,
  });
  state = recordFailure(state, planned[0]!, "bad key", false, NOW);
  state = resetFailures(state, "gbrain");
  assert.equal(
    planDeliveries({ records, state, connectorIds: ["gbrain"], now: NOW })
      .length,
    1,
  );
});

test("failure keeps the previously delivered hash (edit-after-success failure path)", () => {
  const original = meeting();
  let state: ConnectorStateMap = {};
  state = recordSuccess(
    state,
    {
      connectorId: "gbrain",
      meetingId: "m1",
      contentHash: contentHashOf(original),
    },
    NOW,
  );
  const edited = meeting({ enhancedMarkdown: "## v2" });
  state = recordFailure(
    state,
    {
      connectorId: "gbrain",
      meetingId: "m1",
      contentHash: contentHashOf(edited),
    },
    "500",
    true,
    NOW,
  );
  const entry = state["gbrain"]!["m1"]!;
  assert.equal(entry.deliveredHash, contentHashOf(original));
  const status = connectorStatus(state, "gbrain");
  assert.equal(status.delivered, 1);
  assert.equal(status.pending, 1);
  assert.equal(status.lastError, "500");
});

test("contentHash ignores volatile fields (chat, folder, engine)", () => {
  const a = meeting();
  const b = meeting({
    chat: [{ question: "q", answer: "a", askedAt: "2026-07-01T11:00:00.000Z" }],
    folderId: "f9",
    engine: "cloud:claude-sonnet-5",
  });
  assert.equal(contentHashOf(a), contentHashOf(b));
});
