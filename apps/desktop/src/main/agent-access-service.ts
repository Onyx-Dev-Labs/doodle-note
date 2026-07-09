import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  AGENT_ACCESS_CONNECT_CLIENT_CHANNEL,
  AGENT_ACCESS_DISCONNECT_CLIENT_CHANNEL,
  AGENT_ACCESS_GET_CHANNEL,
  AGENT_ACCESS_SET_CHANNEL,
  type AgentAccessStatus,
  type McpClientId,
  type McpClientStatus,
  type McpServerSpec
} from '../shared/integrations-api'
import {
  codexConfigHasServer,
  codexConfigWithServer,
  codexConfigWithoutServer,
  jsonConfigHasServer,
  jsonConfigWithServer,
  jsonConfigWithoutServer
} from './mcp-clients-logic'

interface McpClientDef {
  id: McpClientId
  name: string
  /** Client counts as installed when any of these exists. */
  detectPaths: string[]
  configPath: string
  dialect: 'json' | 'toml'
}

/**
 * The MCP clients whose configs the Connect buttons manage. Both JSON
 * clients keep a top-level `mcpServers` map, so one dialect covers each.
 */
function clientDefs(home: string): McpClientDef[] {
  const appData =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : join(home, 'Library', 'Application Support')
  const claudeDesktopDir = join(appData, 'Claude')
  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      detectPaths: [claudeDesktopDir],
      configPath: join(claudeDesktopDir, 'claude_desktop_config.json'),
      dialect: 'json'
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      detectPaths: [join(home, '.claude.json'), join(home, '.claude')],
      configPath: join(home, '.claude.json'),
      dialect: 'json'
    },
    {
      id: 'codex',
      name: 'Codex',
      detectPaths: [join(home, '.codex')],
      configPath: join(home, '.codex', 'config.toml'),
      dialect: 'toml'
    }
  ]
}

/**
 * Owns the opt-in file the standalone doodle-note-mcp server requires
 * (~/.doodlenote/mcp.json). Agent access to meetings is off until the user
 * flips the Settings toggle, which writes { enabled: true, meetingsDir }
 * with the exact store path — the MCP server never guesses paths. Toggling
 * off rewrites enabled: false, which the server refuses on next launch.
 *
 * Also writes/removes our server entry in MCP client configs (Claude
 * Desktop, Claude Code, Codex) so connecting is one click instead of a
 * hand-edit. Client entries stay in place when the toggle goes off — the
 * opt-in file is the security gate, so revocation never depends on
 * successfully editing third-party configs.
 */
export class AgentAccessService {
  private readonly configPath: string
  private readonly clients: McpClientDef[]

  constructor(
    private readonly meetingsDir: string,
    private readonly server: McpServerSpec,
    home = homedir()
  ) {
    this.configPath = process.env.DOODLE_NOTE_MCP_CONFIG ?? join(home, '.doodlenote', 'mcp.json')
    this.clients = clientDefs(home)
  }

  registerIpc(): void {
    ipcMain.handle(AGENT_ACCESS_GET_CHANNEL, () => this.status())
    ipcMain.handle(AGENT_ACCESS_SET_CHANNEL, (_event, enabled: unknown) =>
      this.setEnabled(Boolean(enabled))
    )
    ipcMain.handle(AGENT_ACCESS_CONNECT_CLIENT_CHANNEL, (_event, id: unknown) =>
      this.setClientConnected(String(id) as McpClientId, true)
    )
    ipcMain.handle(AGENT_ACCESS_DISCONNECT_CLIENT_CHANNEL, (_event, id: unknown) =>
      this.setClientConnected(String(id) as McpClientId, false)
    )
  }

  status(): AgentAccessStatus {
    return {
      enabled: this.readEnabled(),
      configPath: this.configPath,
      server: this.server,
      clients: this.clients.map((def) => this.clientStatus(def))
    }
  }

  setEnabled(enabled: boolean): AgentAccessStatus {
    mkdirSync(dirname(this.configPath), { recursive: true })
    writeFileSync(
      this.configPath,
      JSON.stringify({ enabled, meetingsDir: this.meetingsDir }, null, 2) + '\n'
    )
    return this.status()
  }

  setClientConnected(id: McpClientId, connected: boolean): AgentAccessStatus {
    const def = this.clients.find((c) => c.id === id)
    if (!def) throw new Error(`Unknown MCP client: ${id}`)
    const raw = this.tryRead(def.configPath)
    let next: string | null
    if (connected) {
      next =
        def.dialect === 'json'
          ? jsonConfigWithServer(raw, this.server, def.configPath)
          : codexConfigWithServer(raw, this.server)
    } else {
      // Nothing to remove from a file that doesn't exist.
      next =
        raw === null
          ? null
          : def.dialect === 'json'
            ? jsonConfigWithoutServer(raw, def.configPath)
            : codexConfigWithoutServer(raw)
    }
    if (next !== null && next !== raw) {
      mkdirSync(dirname(def.configPath), { recursive: true })
      writeFileSync(def.configPath, next)
    }
    return this.status()
  }

  private clientStatus(def: McpClientDef): McpClientStatus {
    const raw = this.tryRead(def.configPath)
    const connected =
      raw !== null &&
      (def.dialect === 'json' ? jsonConfigHasServer(raw) : codexConfigHasServer(raw))
    return {
      id: def.id,
      name: def.name,
      installed: def.detectPaths.some((p) => existsSync(p)),
      connected,
      configPath: def.configPath
    }
  }

  private tryRead(path: string): string | null {
    try {
      if (!existsSync(path)) return null
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  }

  private readEnabled(): boolean {
    try {
      if (!existsSync(this.configPath)) return false
      const parsed = JSON.parse(readFileSync(this.configPath, 'utf8')) as { enabled?: unknown }
      return parsed.enabled === true
    } catch {
      return false
    }
  }
}
