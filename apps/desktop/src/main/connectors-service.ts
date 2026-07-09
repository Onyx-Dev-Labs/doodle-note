import { ipcMain, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ConnectorError,
  connectorStatus,
  gbrainConnector,
  planDeliveries,
  buildFinalizedEvent,
  recordFailure,
  recordSuccess,
  resetFailures,
  type ConnectorStateMap,
  type PlannedDelivery
} from '@repo/connectors'
import type { MeetingRecord } from '@repo/meetings-store'
import {
  CONNECTORS_CONFIGURE_GBRAIN_CHANNEL,
  CONNECTORS_STATUS_CHANNEL,
  CONNECTORS_STATUS_EVENT_CHANNEL,
  CONNECTORS_SYNC_NOW_CHANNEL,
  type ConnectorsStatus,
  type GBrainConfigUpdate
} from '../shared/integrations-api'
import type { FoldersService } from './folders-service'
import type { MeetingsService } from './meetings-service'

const DISPATCH_DEBOUNCE_MS = 5_000
/** Retry sweep; cheap no-op when nothing is due. */
const RETRY_INTERVAL_MS = 60_000

interface ConnectorsConfig {
  gbrain: {
    enabled: boolean
    endpointUrl: string
    /** safeStorage-encrypted API key, base64. */
    apiKeyEnc?: string
  }
}

const DEFAULT_CONFIG: ConnectorsConfig = { gbrain: { enabled: false, endpointUrl: '' } }

/**
 * Runs connector exports: watches the meetings store, and once a meeting is
 * finalized (AI notes generated) delivers it to every ENABLED connector via
 * the pure planner in @repo/connectors. Exports are strictly opt-in,
 * credentials are safeStorage-encrypted at rest, deliveries are idempotent
 * (content-hash keyed) and retried with backoff, and per-connector status is
 * surfaced to Settings. Meetings pulled from cloud sync (e.g. recorded on
 * iOS) land in the same store, so they dispatch here too.
 */
export class ConnectorsService {
  private config: ConnectorsConfig
  private state: ConnectorStateMap
  private readonly configPath: string
  private readonly statePath: string
  private debounceTimer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    userDataDir: string,
    private readonly meetings: MeetingsService,
    private readonly folders: FoldersService,
    private readonly broadcast: (channel: string, payload: unknown) => void
  ) {
    this.configPath = join(userDataDir, 'connectors.json')
    this.statePath = join(userDataDir, 'connector-deliveries.json')
    this.config = readJson(this.configPath, DEFAULT_CONFIG)
    this.state = readJson(this.statePath, {})
  }

  registerIpc(): void {
    ipcMain.handle(CONNECTORS_STATUS_CHANNEL, () => this.status())
    ipcMain.handle(CONNECTORS_CONFIGURE_GBRAIN_CHANNEL, (_event, update: unknown) =>
      this.configureGBrain(update as GBrainConfigUpdate)
    )
    ipcMain.handle(CONNECTORS_SYNC_NOW_CHANNEL, () => this.syncNow())

    setInterval(() => {
      if (this.enabledConnectorIds().length > 0) void this.dispatchCycle()
    }, RETRY_INTERVAL_MS).unref()
  }

  /** Store-change hook: debounced like cloud sync so bursts coalesce. */
  onMeetingsChanged(): void {
    if (this.enabledConnectorIds().length === 0) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => void this.dispatchCycle(), DISPATCH_DEBOUNCE_MS)
    this.debounceTimer.unref()
  }

  status(): ConnectorsStatus {
    const stats = connectorStatus(this.state, 'gbrain')
    const lastDeliveredAt = Object.values(this.state['gbrain'] ?? {})
      .map((e) => e.deliveredAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1)
    return {
      gbrain: {
        enabled: this.config.gbrain.enabled,
        endpointUrl: this.config.gbrain.endpointUrl,
        hasApiKey: Boolean(this.config.gbrain.apiKeyEnc),
        stats: { ...stats, ...(lastDeliveredAt ? { lastDeliveredAt } : {}) }
      }
    }
  }

  configureGBrain(update: GBrainConfigUpdate): ConnectorsStatus {
    const next = { ...this.config.gbrain }
    next.enabled = Boolean(update.enabled)
    next.endpointUrl = String(update.endpointUrl ?? '').trim()
    if (typeof update.apiKey === 'string') {
      if (update.apiKey.length === 0) {
        delete next.apiKeyEnc
      } else if (safeStorage.isEncryptionAvailable()) {
        next.apiKeyEnc = safeStorage.encryptString(update.apiKey).toString('base64')
      } else {
        throw new Error('Secure credential storage is unavailable on this machine.')
      }
    }
    this.config = { ...this.config, gbrain: next }
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    if (next.enabled) this.onMeetingsChanged()
    return this.status()
  }

  async syncNow(): Promise<ConnectorsStatus> {
    this.state = resetFailures(this.state, 'gbrain')
    this.persistState()
    await this.dispatchCycle()
    return this.status()
  }

  private enabledConnectorIds(): string[] {
    return this.config.gbrain.enabled ? ['gbrain'] : []
  }

  private async dispatchCycle(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const connectorIds = this.enabledConnectorIds()
      if (connectorIds.length === 0) return
      const records = this.meetings.readAll()
      const planned = planDeliveries({
        records,
        state: this.state,
        connectorIds,
        now: Date.now()
      })
      if (planned.length === 0) return
      const byId = new Map(records.map((r) => [r.id, r]))
      const folderNames = new Map(this.folders.list().map((f) => [f.id, f.name]))
      for (const delivery of planned) {
        const record = byId.get(delivery.meetingId)
        if (!record) continue
        await this.deliverOne(delivery, record, folderNames)
      }
      this.broadcast(CONNECTORS_STATUS_EVENT_CHANNEL, {})
    } finally {
      this.running = false
    }
  }

  private async deliverOne(
    delivery: PlannedDelivery,
    record: MeetingRecord,
    folderNames: Map<string, string>
  ): Promise<void> {
    try {
      const event = buildFinalizedEvent(record, {
        folderName: record.folderId ? folderNames.get(record.folderId) : undefined
      })
      await gbrainConnector.deliver(event, {
        endpointUrl: this.config.gbrain.endpointUrl,
        apiKey: this.decryptApiKey()
      })
      this.state = recordSuccess(this.state, delivery, Date.now())
    } catch (err) {
      const retryable = err instanceof ConnectorError ? err.retryable : true
      const message = err instanceof Error ? err.message : String(err)
      // Status/log surface: message only — connector errors never carry
      // meeting content, and neither may anything logged here.
      console.error(`[connectors] gbrain delivery failed for ${delivery.meetingId}: ${message}`)
      this.state = recordFailure(this.state, delivery, message, retryable, Date.now())
    }
    this.persistState()
  }

  private decryptApiKey(): string {
    const enc = this.config.gbrain.apiKeyEnc
    if (!enc) return ''
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return ''
    }
  }

  private persistState(): void {
    try {
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch (err) {
      console.error('[connectors] failed to persist delivery state:', err)
    }
  }
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(path, 'utf8')) as T) }
  } catch {
    return fallback
  }
}
