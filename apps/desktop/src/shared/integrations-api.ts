/** Shared IPC contract for Settings → Integrations local agent access. */

export const AGENT_ACCESS_GET_CHANNEL = 'agent-access:get'
export const AGENT_ACCESS_SET_CHANNEL = 'agent-access:set'
export const AGENT_ACCESS_CONNECT_CLIENT_CHANNEL = 'agent-access:connect-client'
export const AGENT_ACCESS_DISCONNECT_CLIENT_CHANNEL = 'agent-access:disconnect-client'

export type McpClientId = 'claude-desktop' | 'claude-code' | 'codex'

/** How an MCP client should launch the bundled doodle-note-mcp server. */
export interface McpServerSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpClientStatus {
  id: McpClientId
  name: string
  /** Client detected on this machine (its config dir/file exists). */
  installed: boolean
  /** Our server entry is present in the client's config. */
  connected: boolean
  /** The client config file the Connect button edits. */
  configPath: string
}

export interface AgentAccessStatus {
  enabled: boolean
  /** Where the opt-in config lives (~/.doodlenote/mcp.json). */
  configPath: string
  /** Launch spec for manual setup in clients we don't auto-configure. */
  server: McpServerSpec
  clients: McpClientStatus[]
}

/** API surface exposed on `window.integrations` by the preload script. */
export interface IntegrationsApi {
  getAgentAccess(): Promise<AgentAccessStatus>
  setAgentAccess(enabled: boolean): Promise<AgentAccessStatus>
  /** Write our server entry into the client's MCP config. */
  connectClient(id: McpClientId): Promise<AgentAccessStatus>
  /** Remove our server entry from the client's MCP config. */
  disconnectClient(id: McpClientId): Promise<AgentAccessStatus>
}
