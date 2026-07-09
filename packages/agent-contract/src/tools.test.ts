import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS, AgentToolError } from "./tools";
import {
  AGENT_SCHEMA_VERSION,
  type MeetingSource,
  type AgentMeetingSummary,
} from "./types";

const summary: AgentMeetingSummary = {
  meeting_id: "m1",
  kind: "meeting",
  title: "Standup",
  created_at: "2026-07-01T10:00:00.000Z",
  has_notes: true,
  has_transcript: true,
};

function fakeSource(overrides: Partial<MeetingSource> = {}): MeetingSource {
  return {
    listRecent: async (limit) => [summary].slice(0, limit),
    search: async () => [{ ...summary, matched_field: "title" }],
    getMeeting: async (id) => (id === "m1" ? summary : null),
    getNotes: async (id) =>
      id === "m1"
        ? { meeting_id: "m1", title: "Standup", raw_notes_markdown: "hi" }
        : null,
    getTranscript: async (id) =>
      id === "m1"
        ? { meeting_id: "m1", title: "Standup", segments: [], text: "" }
        : null,
    ...overrides,
  };
}

function tool(name: string) {
  const def = AGENT_TOOLS.find((t) => t.name === name);
  assert.ok(def, `tool ${name} exists`);
  return def;
}

test("every tool result carries the schema version", async () => {
  const source = fakeSource();
  for (const [name, args] of [
    ["list_recent_meetings", {}],
    ["search_meetings", { query: "standup" }],
    ["get_meeting", { meeting_id: "m1" }],
    ["get_meeting_notes", { meeting_id: "m1" }],
    ["get_meeting_transcript", { meeting_id: "m1" }],
  ] as const) {
    const result = await tool(name).run(source, { ...args });
    assert.equal(result["schema_version"], AGENT_SCHEMA_VERSION, name);
  }
});

test("limit is validated and clamped to the declared bounds", async () => {
  const seen: number[] = [];
  const source = fakeSource({
    listRecent: async (limit) => {
      seen.push(limit);
      return [];
    },
  });
  await tool("list_recent_meetings").run(source, {});
  await tool("list_recent_meetings").run(source, { limit: 3 });
  assert.deepEqual(seen, [10, 3]);
  await assert.rejects(
    tool("list_recent_meetings").run(source, { limit: 0 }),
    AgentToolError,
  );
  await assert.rejects(
    tool("list_recent_meetings").run(source, { limit: 999 }),
    AgentToolError,
  );
  await assert.rejects(
    tool("list_recent_meetings").run(source, { limit: "ten" }),
    AgentToolError,
  );
});

test("search requires a non-empty query", async () => {
  const source = fakeSource();
  await assert.rejects(tool("search_meetings").run(source, {}), AgentToolError);
  await assert.rejects(
    tool("search_meetings").run(source, { query: "   " }),
    AgentToolError,
  );
});

test("unknown meeting ids produce a clear error, not a null payload", async () => {
  const source = fakeSource();
  for (const name of [
    "get_meeting",
    "get_meeting_notes",
    "get_meeting_transcript",
  ]) {
    await assert.rejects(
      tool(name).run(source, { meeting_id: "nope" }),
      (err: unknown) =>
        err instanceof AgentToolError && /nope/.test(String(err)),
      name,
    );
  }
});

test("tool input schemas are well-formed JSON Schema objects", () => {
  for (const def of AGENT_TOOLS) {
    assert.equal(typeof def.description, "string");
    assert.ok(
      def.description.length > 20,
      `${def.name} has a real description`,
    );
    assert.equal(
      (def.inputSchema as { type?: string }).type,
      "object",
      def.name,
    );
  }
});
