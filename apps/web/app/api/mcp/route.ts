import { NextResponse } from "next/server";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type MeetingSource,
} from "@repo/agent-contract";
import { getDb } from "@repo/db";

import { authenticateEntitledAgentRequest } from "@/lib/agent-auth";
import { CloudMeetingSource } from "@/lib/cloud-meeting-source";

/**
 * DoodleNote's hosted MCP server: the same read-only tool contract as the
 * local doodle-note-mcp stdio server, backed by the workspace's cloud-synced
 * meetings instead of the on-disk store. Agents authenticate with a
 * revocable `dnag_` token (Authorization: Bearer), minted in the web app's
 * workspaces panel; every query is tenant-scoped to that token's workspace.
 *
 * Transport: stateless MCP Streamable HTTP. Each POST is one JSON-RPC
 * message answered directly with application/json — no sessions, no SSE
 * stream, no server-held state, which is exactly what serverless wants.
 * Claude (Code/Desktop/web), Codex, and other MCP clients handle the
 * JSON-response mode per the 2025-06-18 spec revision.
 */

const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function rpcResult(id: unknown, result: unknown): NextResponse {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request) {
  const authed = await authenticateEntitledAgentRequest(request);
  if (authed.response) return authed.response;

  let message: JsonRpcRequest;
  try {
    message = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(message)) {
    // JSON-RPC batching was removed in the 2025-06-18 MCP revision.
    return rpcError(null, -32600, "Batch requests are not supported", 400);
  }
  const method = typeof message.method === "string" ? message.method : "";
  const id = message.id;

  // Notifications (no id) are acknowledged and ignored — stateless server.
  if (id === undefined || id === null) {
    return new NextResponse(null, { status: 202 });
  }

  switch (method) {
    case "initialize": {
      const params = (message.params ?? {}) as { protocolVersion?: unknown };
      const requested = String(params.protocolVersion ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "doodle-note", version: SERVER_VERSION },
        instructions:
          "Read-only access to this DoodleNote workspace's meetings. " +
          "Use search_meetings or list_recent_meetings to find meetings, " +
          "get_meeting_notes for summaries, get_meeting_transcript for full transcripts.",
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: AGENT_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const params = (message.params ?? {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      const source: MeetingSource = new CloudMeetingSource(
        getDb(),
        authed.agent.organizationId,
      );
      const outcome = await executeAgentTool(
        source,
        String(params.name ?? ""),
        (params.arguments ?? {}) as Record<string, unknown>,
      );
      if (!outcome.ok) {
        return rpcResult(id, {
          content: [{ type: "text", text: outcome.message }],
          isError: true,
        });
      }
      return rpcResult(id, {
        content: [
          { type: "text", text: JSON.stringify(outcome.result, null, 2) },
        ],
      });
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** No SSE stream in stateless mode — clients that GET get a clear 405. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}
