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

export interface InstallMigrationDeps {
  platform: NodeJS.Platform
  isPackaged: boolean
  execPath: string
  /** Contents of the done-marker, or null when absent. */
  readMarker(): string | null
  writeMarker(contents: string): void
  loginItem: {
    stateFor(exe: string): LoginItemState
    /** Register the running exe, keeping the user's enabled/disabled choice. */
    registerCurrent(enabled: boolean): void
  }
  /** Re-register our MCP server in clients whose entry runs an exe inside `legacyDir`; returns client ids. */
  repointMcpClients(isLegacyCommand: (command: string) => boolean): string[]
  log(message: string): void
}

export interface InstallMigrationResult {
  ran: boolean
  loginItem: boolean
  mcpClients: string[]
}

const MARKER_VERSION = 1

/**
 * Idempotent; runs once per profile after a move (a marker records it). A step
 * that throws is logged and retried on the next launch, the other step still runs.
 */
export function runWindowsInstallMigration(deps: InstallMigrationDeps): InstallMigrationResult {
  const none = { ran: false, loginItem: false, mcpClients: [] }
  if (deps.platform !== 'win32' || !deps.isPackaged) return none
  const legacy = legacyInstallFor(deps.execPath)
  if (!legacy) return none
  const marker = deps.readMarker()
  if (marker) {
    try {
      const parsed = JSON.parse(marker) as { version?: unknown; to?: unknown }
      if (
        parsed.version === MARKER_VERSION &&
        typeof parsed.to === 'string' &&
        parsed.to.toLowerCase() === deps.execPath.toLowerCase()
      )
        return none
    } catch {
      // A damaged marker only means the (idempotent) migration runs again.
    }
  }

  let failed = false
  let loginItem = false
  try {
    const state = deps.loginItem.stateFor(legacy.exe)
    if (state.registered) {
      deps.loginItem.registerCurrent(state.enabled)
      loginItem = true
      deps.log(`[install-migration] login item moved to ${deps.execPath}`)
    }
  } catch (error) {
    failed = true
    deps.log(`[install-migration] login item not moved: ${(error as Error).message}`)
  }

  let mcpClients: string[] = []
  try {
    mcpClients = deps.repointMcpClients((command) => isInsideFolder(command, legacy.dir))
    if (mcpClients.length)
      deps.log(`[install-migration] MCP clients repointed: ${mcpClients.join(', ')}`)
  } catch (error) {
    failed = true
    deps.log(`[install-migration] MCP clients not repointed: ${(error as Error).message}`)
  }

  if (!failed) {
    try {
      deps.writeMarker(
        JSON.stringify({ version: MARKER_VERSION, from: legacy.exe, to: deps.execPath }) + '\n'
      )
    } catch (error) {
      deps.log(`[install-migration] marker not written: ${(error as Error).message}`)
    }
  }
  return { ran: true, loginItem, mcpClients }
}
