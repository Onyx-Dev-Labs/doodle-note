/**
 * Shared IPC contract for Settings → Integrations: local agent access (the
 * doodle-note-mcp opt-in file) and connector exports (GBrain today; the
 * connector list is generic by design).
 */

export const AGENT_ACCESS_GET_CHANNEL = 'agent-access:get'
export const AGENT_ACCESS_SET_CHANNEL = 'agent-access:set'

export const CONNECTORS_STATUS_CHANNEL = 'connectors:status'
export const CONNECTORS_CONFIGURE_GBRAIN_CHANNEL = 'connectors:configure-gbrain'
export const CONNECTORS_SYNC_NOW_CHANNEL = 'connectors:sync-now'
/** main → renderer: delivery state changed — refetch status. */
export const CONNECTORS_STATUS_EVENT_CHANNEL = 'connectors:status-event'

export interface AgentAccessStatus {
  enabled: boolean
  /** Where the opt-in config lives (~/.doodlenote/mcp.json). */
  configPath: string
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
  getConnectors(): Promise<ConnectorsStatus>
  configureGBrain(update: GBrainConfigUpdate): Promise<ConnectorsStatus>
  /** Re-plan immediately (also clears exhausted failures for a manual retry). */
  connectorsSyncNow(): Promise<ConnectorsStatus>
  onStatusChanged(cb: () => void): () => void
}
