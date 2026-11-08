import type { McpServerSpec } from '../shared/integrations-api'
import { APP_IDENTITY } from './app-identity'

/**
 * What both client-config implementations share: the key our server is
 * registered under, the error a caller shows, and the shape AgentAccessService
 * calls. mcp-clients-logic.ts is the strict implementation (Windows);
 * mcp-clients-logic-base.ts keeps the base's (win/bark 9355b87) code for every
 * other platform, so macOS behaves exactly as before. Neither imports the other.
 */

/** The key our server is registered under in every client (doodle-note-qa for a QA build). */
export const MCP_SERVER_KEY = APP_IDENTITY.mcpServerKey

export class ClientConfigError extends Error {}

/** One client file format: our entry added, removed, detected. */
export interface ClientConfigDialect {
  withServer(raw: string | null, spec: McpServerSpec, path: string): string
  withoutServer(raw: string, path: string): string
  hasServer(raw: string): boolean
}

export interface ClientConfigDialects {
  json: ClientConfigDialect
  codex: ClientConfigDialect
}

/** The strict dialects also read the command our entry launches (repointing). */
export interface StrictClientConfigDialect extends ClientConfigDialect {
  serverCommand(raw: string, path: string): string | null
}

export interface StrictClientConfigDialects {
  json: StrictClientConfigDialect
  codex: StrictClientConfigDialect
}
