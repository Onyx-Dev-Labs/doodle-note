import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type MeetingSource,
} from "@repo/agent-contract";

/**
 * Build the MCP server from the shared tool contract. The hosted DoodleNote
 * MCP registers the same AGENT_TOOLS against its own MeetingSource — tool
 * names, arguments, response shapes, and error behavior stay identical
 * across surfaces (executeAgentTool owns error normalization).
 */
export function createServer(source: MeetingSource, version: string): Server {
  const server = new Server(
    { name: "doodle-note", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const outcome = await executeAgentTool(
      source,
      request.params.name,
      request.params.arguments ?? {},
    );
    if (!outcome.ok) {
      return {
        content: [{ type: "text", text: outcome.message }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify(outcome.result, null, 2) },
      ],
    };
  });

  return server;
}
