/**
 * Shared IPC contract for Settings → Integrations: local agent access (the
 * doodle-note-mcp opt-in file) and connector exports (GBrain today; the
 * connector list is generic by design).
 */

export const AGENT_ACCESS_GET_CHANNEL = 'agent-access:get'
export const AGENT_ACCESS_SET_CHANNEL = 'agent-access:set'
export const AGENT_ACCESS_CONNECT_CLIENT_CHANNEL = 'agent-access:connect-client'
export const AGENT_ACCESS_DISCONNECT_CLIENT_CHANNEL = 'agent-access:disconnect-client'

export const CONNECTORS_STATUS_CHANNEL = 'connectors:status'
export const CONNECTORS_CONFIGURE_GBRAIN_CHANNEL = 'connectors:configure-gbrain'
export const CONNECTORS_SYNC_NOW_CHANNEL = 'connectors:sync-now'
/** main → renderer: delivery state changed — refetch status. */
export const CONNECTORS_STATUS_EVENT_CHANNEL = 'connectors:status-event'

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

export interface ConnectorDeliveryStats {
  delivered: number
  pending: number
  failed: number
  lastError?: string
  lastDeliveredAt?: string
}

export interface GBrainSettingsView {
  enabled: boolean
  endpointUrl: string
  /** True when an API key is stored (the key itself never crosses IPC back). */
  hasApiKey: boolean
  stats: ConnectorDeliveryStats
}

export interface ConnectorsStatus {
  gbrain: GBrainSettingsView
}

export interface GBrainConfigUpdate {
  enabled: boolean
  endpointUrl: string
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string
}

/** API surface exposed on `window.integrations` by the preload script. */
export interface IntegrationsApi {
  getAgentAccess(): Promise<AgentAccessStatus>
  setAgentAccess(enabled: boolean): Promise<AgentAccessStatus>
  /** Write our server entry into the client's MCP config. */
  connectClient(id: McpClientId): Promise<AgentAccessStatus>
  /** Remove our server entry from the client's MCP config. */
  disconnectClient(id: McpClientId): Promise<AgentAccessStatus>
  getConnectors(): Promise<ConnectorsStatus>
  configureGBrain(update: GBrainConfigUpdate): Promise<ConnectorsStatus>
  /** Re-plan immediately (also clears exhausted failures for a manual retry). */
  connectorsSyncNow(): Promise<ConnectorsStatus>
  onStatusChanged(cb: () => void): () => void
}
