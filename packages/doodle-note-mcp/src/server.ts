import { LOCAL_SOURCE_TOOLS } from "./source-tools";
import { LocalMeetingSource } from "./local-source";
import { AgentToolError } from "@repo/agent-contract";
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

  const localTools =
    source instanceof LocalMeetingSource ? LOCAL_SOURCE_TOOLS : [];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...AGENT_TOOLS, ...localTools].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const localTool = localTools.find((t) => t.name === request.params.name);
    if (localTool) {
      try {
        const result = await localTool.run(
          source,
          request.params.arguments ?? {},
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof AgentToolError
                  ? error.message
                  : "Local sources unavailable; originals are preserved.",
            },
          ],
        };
      }
    }
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
