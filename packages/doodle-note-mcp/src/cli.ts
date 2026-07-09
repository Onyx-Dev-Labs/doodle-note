import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config";
import { LocalMeetingSource } from "./local-source";
import { createServer } from "./server";

const VERSION = "0.2.0";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // stderr only — stdout belongs to the MCP protocol.
    console.error(err instanceof ConfigError ? err.message : String(err));
    process.exit(1);
  }
  const source = new LocalMeetingSource(config.meetingsDir);
  const server = createServer(source, VERSION);
  await server.connect(new StdioServerTransport());
  console.error(
    `doodle-note-mcp ${VERSION} serving meetings from ${config.meetingsDir}`,
  );
}

void main();
