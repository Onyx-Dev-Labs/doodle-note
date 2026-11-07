import { win32 } from 'node:path'

/**
 * Windows install folder rename, app side. Builds before 0.5.x installed to
 * <UserProgramFiles>\desktop (electron-builder names one-click per-user folders
 * after the package); the installer now moves them to <UserProgramFiles>\DoodleNote
 * (build/windows-installer.nsh) and removes the old folder once the new one is
 * verified. Two things outside the installer's reach still name the old exe:
 *
 * - the "Open at login" Run entry Electron registered with the old path, and
 * - MCP client configs (Claude Desktop, Claude Code, Codex) that launch the
 *   bundled MCP server through the old DoodleNote.exe.
 *
 * Both are repointed at the running exe on the first launch from the new
 * folder. Nothing else depends on the folder: the profile (%APPDATA%\desktop,
 * which holds the library location, settings and accounts) is named after the
 * app, not the install folder, and is not moved.
 */

export const LEGACY_INSTALL_FOLDER = 'desktop'
export const INSTALL_FOLDER = 'DoodleNote'

export interface LegacyInstall {
  dir: string
  exe: string
}

/** The pre-rename install this exe replaced, or null when not running from a DoodleNote folder. */
export function legacyInstallFor(execPath: string): LegacyInstall | null {
  const dir = win32.dirname(win32.normalize(execPath))
  if (win32.basename(dir).toLowerCase() !== INSTALL_FOLDER.toLowerCase()) return null
  const legacyDir = win32.join(win32.dirname(dir), LEGACY_INSTALL_FOLDER)
  return { dir: legacyDir, exe: win32.join(legacyDir, win32.basename(execPath)) }
}

/** Case-insensitive, separator-tolerant "is this path inside that folder" (Windows rules). */
export function isInsideFolder(path: string, folder: string): boolean {
  const a = win32.normalize(path).toLowerCase()
  const b = win32.normalize(folder).replace(/\\+$/, '').toLowerCase()
  return a === b || a.startsWith(`${b}\\`)
}

export interface LoginItemState {
  /** A Run entry with this app's name launches the given exe. */
  registered: boolean
  /** Not disabled in Task Manager / Settings > Startup. */
  enabled: boolean
}

export interface McpRepointOutcome {
  id: string
  /** `failed`: the config exists but could not be read, parsed or written. */
  outcome: 'unchanged' | 'updated' | 'failed'
  error?: string
}

export interface InstallMigrationDeps {
  platform: NodeJS.Platform
  isPackaged: boolean
  execPath: string
  /** Contents of the progress marker, or null when absent. */
  readMarker(): string | null
  writeMarker(contents: string): void
  loginItem: {
    stateFor(exe: string): LoginItemState
    /** Register the running exe, keeping the user's enabled/disabled choice. */
    registerCurrent(enabled: boolean): void
  }
  /**
   * Re-register our MCP server in clients whose entry runs an exe inside the old
   * folder. `only` lists the clients still to do (null: all of them).
   */
  repointMcpClients(
    isLegacyCommand: (command: string) => boolean,
    only: readonly string[] | null
  ): McpRepointOutcome[]
  log(message: string): void
}

export interface InstallMigrationResult {
  ran: boolean
  loginItem: boolean
  mcpClients: string[]
  /** Steps or clients left for the next launch. */
  pending: string[]
}

/**
 * The marker records progress, so a launch only redoes what is not done yet.
 * Version 1 markers (written before per-client tracking) are not trusted: they
 * could record "done" after a config file failed to read.
 */
const MARKER_VERSION = 2

interface Marker {
  version: number
  from: string
  to: string
  loginItemDone: boolean
  /** MCP clients still to repoint; "all" when the whole step failed. */
  mcpPending: string[] | 'all'
  complete: boolean
}

function readProgress(raw: string | null, execPath: string): Marker | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Marker>
    if (
      parsed.version !== MARKER_VERSION ||
      typeof parsed.to !== 'string' ||
      parsed.to.toLowerCase() !== execPath.toLowerCase() ||
      typeof parsed.loginItemDone !== 'boolean' ||
      typeof parsed.complete !== 'boolean' ||
      !(
        parsed.mcpPending === 'all' ||
        (Array.isArray(parsed.mcpPending) &&
          parsed.mcpPending.every((id) => typeof id === 'string'))
      )
    )
      return null
    return parsed as Marker
  } catch {
    // A damaged marker only means the (idempotent) migration runs again.
    return null
  }
}

/**
 * Idempotent; runs after a move until every step has succeeded once (the marker
 * records progress). A step or client that fails is logged and retried on the
 * next launch; the others still run and are not redone.
 */
export function runWindowsInstallMigration(deps: InstallMigrationDeps): InstallMigrationResult {
  const none = { ran: false, loginItem: false, mcpClients: [], pending: [] }
  if (deps.platform !== 'win32' || !deps.isPackaged) return none
  const legacy = legacyInstallFor(deps.execPath)
  if (!legacy) return none
  let raw: string | null = null
  try {
    raw = deps.readMarker()
  } catch (error) {
    deps.log(`[install-migration] marker not read: ${(error as Error).message}`)
  }
  const progress = readProgress(raw, deps.execPath)
  if (progress?.complete) return none

  let loginItemDone = progress?.loginItemDone ?? false
  let loginItem = false
  if (!loginItemDone) {
    try {
      const state = deps.loginItem.stateFor(legacy.exe)
      if (state.registered) {
        deps.loginItem.registerCurrent(state.enabled)
        loginItem = true
        deps.log(`[install-migration] login item moved to ${deps.execPath}`)
      }
      loginItemDone = true
    } catch (error) {
      deps.log(`[install-migration] login item not moved: ${(error as Error).message}`)
    }
  }

  const previouslyPending = progress?.mcpPending ?? 'all'
  let mcpPending: string[] | 'all' = previouslyPending
  const mcpClients: string[] = []
  if (previouslyPending === 'all' || previouslyPending.length > 0) {
    try {
      const outcomes = deps.repointMcpClients(
        (command) => isInsideFolder(command, legacy.dir),
        previouslyPending === 'all' ? null : previouslyPending
      )
      mcpPending = []
      for (const result of outcomes) {
        if (result.outcome === 'updated') mcpClients.push(result.id)
        if (result.outcome === 'failed') {
          mcpPending.push(result.id)
          deps.log(`[install-migration] ${result.id} not repointed: ${result.error ?? 'failed'}`)
        }
      }
      if (mcpClients.length)
        deps.log(`[install-migration] MCP clients repointed: ${mcpClients.join(', ')}`)
    } catch (error) {
      deps.log(`[install-migration] MCP clients not repointed: ${(error as Error).message}`)
    }
  }

  const pending = [
    ...(loginItemDone ? [] : ['login-item']),
    ...(mcpPending === 'all' ? ['mcp-clients'] : mcpPending)
  ]
  const marker: Marker = {
    version: MARKER_VERSION,
    from: legacy.exe,
    to: deps.execPath,
    loginItemDone,
    mcpPending,
    complete: pending.length === 0
  }
  try {
    deps.writeMarker(JSON.stringify(marker) + '\n')
  } catch (error) {
    deps.log(`[install-migration] marker not written: ${(error as Error).message}`)
  }
  return { ran: true, loginItem, mcpClients, pending }
}
