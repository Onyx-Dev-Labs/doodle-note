import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  AGENT_ACCESS_GET_CHANNEL,
  AGENT_ACCESS_SET_CHANNEL,
  type AgentAccessStatus
} from '../shared/integrations-api'

/**
 * Owns the opt-in file the standalone doodle-note-mcp server requires
 * (~/.doodlenote/mcp.json). Agent access to meetings is off until the user
 * flips the Settings toggle, which writes { enabled: true, meetingsDir }
 * with the exact store path — the MCP server never guesses paths. Toggling
 * off rewrites enabled: false, which the server refuses on next launch.
 */
export class AgentAccessService {
  private readonly configPath: string

  constructor(private readonly meetingsDir: string) {
    this.configPath =
      process.env.DOODLE_NOTE_MCP_CONFIG ?? join(homedir(), '.doodlenote', 'mcp.json')
  }

  registerIpc(): void {
    ipcMain.handle(AGENT_ACCESS_GET_CHANNEL, () => this.status())
    ipcMain.handle(AGENT_ACCESS_SET_CHANNEL, (_event, enabled: unknown) =>
      this.setEnabled(Boolean(enabled))
    )
  }

  status(): AgentAccessStatus {
    return { enabled: this.readEnabled(), configPath: this.configPath }
  }

  setEnabled(enabled: boolean): AgentAccessStatus {
    mkdirSync(dirname(this.configPath), { recursive: true })
    writeFileSync(
      this.configPath,
      JSON.stringify({ enabled, meetingsDir: this.meetingsDir }, null, 2) + '\n'
    )
    return this.status()
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
