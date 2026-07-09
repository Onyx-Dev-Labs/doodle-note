import { AGENT_SCHEMA_VERSION, type MeetingSource } from "./types";

/**
 * Tool definitions shared by every DoodleNote agent surface. Input schemas
 * are plain JSON Schema (no validator dependency) so both the stdio MCP
 * server and the hosted MCP can register them verbatim; argument checking
 * happens in `run` with clear, agent-readable error messages.
 */

export class AgentToolError extends Error {}

/** JSON-serializable tool result; servers wrap it as they see fit. */
export type AgentToolResult = Record<string, unknown>;

export interface AgentToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
  run(
    source: MeetingSource,
    args: Record<string, unknown>,
  ): Promise<AgentToolResult>;
}

/**
 * Run one tool by name against a source, normalizing errors: expected
 * validation/not-found messages go back to the agent verbatim; anything
 * else becomes a generic message (never internals, paths, or content).
 * Both the stdio server and the hosted MCP call this, so error behavior
 * stays identical across surfaces.
 */
export async function executeAgentTool(
  source: MeetingSource,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: AgentToolResult } | { ok: false; message: string }> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, message: `Unknown tool: ${name}` };
  try {
    return { ok: true, result: await tool.run(source, args) };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof AgentToolError
          ? err.message
          : "Internal error reading the meeting store.",
    };
  }
}

const DEFAULT_LIST_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_LIMIT = 50;

function readLimit(args: Record<string, unknown>, fallback: number): number {
  const raw = args["limit"];
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new AgentToolError(
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
    );
  }
  return n;
}

function readString(args: Record<string, unknown>, key: string): string {
  const raw = args[key];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new AgentToolError(
      `${key} is required and must be a non-empty string`,
    );
  }
  return raw.trim();
}

const MEETING_ID_PROPERTY = {
  meeting_id: {
    type: "string",
    description:
      "Stable DoodleNote meeting id, as returned by list/search tools.",
  },
} as const;

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "list_recent_meetings",
    description:
      "List the most recent DoodleNote meetings and quick notes, newest first. " +
      "Returns metadata only (titles, times, whether notes/transcript exist) — " +
      "use get_meeting_notes or get_meeting_transcript to fetch content.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many to return (default ${DEFAULT_LIST_LIMIT}).`,
        },
      },
    },
    async run(source, args) {
      const meetings = await source.listRecent(
        readLimit(args, DEFAULT_LIST_LIMIT),
      );
      return { schema_version: AGENT_SCHEMA_VERSION, meetings };
    },
  },
  {
    name: "search_meetings",
    description:
      "Case-insensitive keyword search across meeting titles, notes, and transcripts. " +
      "Each result reports the strongest field that matched.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Maximum results (default ${DEFAULT_SEARCH_LIMIT}).`,
        },
      },
      required: ["query"],
    },
    async run(source, args) {
      const results = await source.search(
        readString(args, "query"),
        readLimit(args, DEFAULT_SEARCH_LIMIT),
      );
      return { schema_version: AGENT_SCHEMA_VERSION, results };
    },
  },
  {
    name: "get_meeting",
    description:
      "Fetch metadata for one meeting by id (no notes or transcript content).",
    inputSchema: {
      type: "object",
      properties: { ...MEETING_ID_PROPERTY },
      required: ["meeting_id"],
    },
    async run(source, args) {
      const id = readString(args, "meeting_id");
      const meeting = await source.getMeeting(id);
      if (!meeting) throw new AgentToolError(`No meeting found with id ${id}`);
      return { schema_version: AGENT_SCHEMA_VERSION, meeting };
    },
  },
  {
    name: "get_meeting_notes",
    description:
      "Fetch a meeting's notes: the user's own rough notes and, when present, the " +
      "AI-generated notes. Prefer enhanced_markdown when it exists.",
    inputSchema: {
      type: "object",
      properties: { ...MEETING_ID_PROPERTY },
      required: ["meeting_id"],
    },
    async run(source, args) {
      const id = readString(args, "meeting_id");
      const notes = await source.getNotes(id);
      if (!notes) throw new AgentToolError(`No meeting found with id ${id}`);
      return { schema_version: AGENT_SCHEMA_VERSION, notes };
    },
  },
  {
    name: "get_meeting_transcript",
    description:
      "Fetch a meeting's full transcript as speaker-attributed segments plus a rendered " +
      "text form. Transcripts can be long — prefer get_meeting_notes for summaries.",
    inputSchema: {
      type: "object",
      properties: { ...MEETING_ID_PROPERTY },
      required: ["meeting_id"],
    },
    async run(source, args) {
      const id = readString(args, "meeting_id");
      const transcript = await source.getTranscript(id);
      if (!transcript)
        throw new AgentToolError(`No meeting found with id ${id}`);
      return { schema_version: AGENT_SCHEMA_VERSION, transcript };
    },
  },
];
