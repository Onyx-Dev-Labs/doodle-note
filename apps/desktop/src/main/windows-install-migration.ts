import { realpathSync } from 'node:fs'
import { win32 } from 'node:path'
import type { InstallMigrationStatus } from '../shared/install-migration-api'
import { APP_IDENTITY, type AppIdentity } from './app-identity'
import type { InstallMigrationRecord, InstallRecordPending } from './windows-install-record'

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
 * Both are repointed at the running exe, but only on the installer's word: the
 * MigrationRecord it writes under HKCU\Software\<APP_GUID> after it really moved
 * this identity's install (windows-install-record.ts). A record that is there but
 * not complete for this identity is left alone, for the installer to repair. Every
 * attempt that finds a record (or cannot read it) is recorded where QA and support
 * can see it: AppMigration / AppMigrationLastAttempt / AppMigrationReason in the
 * identity's HKCU\Software\DoodleNote-InstallStatus\<APP_GUID> key, beside the
 * installer's own LastStep, and in Settings (installMigrationNotice). A copy of the
 * exe started from any folder that happens to be named DoodleNote (a DPI capture, a portable copy) finds no record
 * naming its folder and changes nothing. Nothing else depends on the folder: the
 * profile (%APPDATA%\desktop, which holds the library location, settings and
 * accounts) is named after the app, not the install folder, and is not moved.
 */

/** Both folder names come from the app identity, so a QA build migrates its own folders. */
export const LEGACY_INSTALL_FOLDER = APP_IDENTITY.legacyInstallFolder
export const INSTALL_FOLDER = APP_IDENTITY.installFolder

export interface LegacyInstall {
  dir: string
  exe: string
}

/** Resolves an existing path to the form Windows reports for it; throws when it does not exist. */
export type RealPath = (path: string) => string

/**
 * fs.realpathSync.native: on Windows, GetFinalPathNameByHandle, so 8.3 short
 * names come back long (junctions and links are resolved too; the installer
 * never moves to or from such a folder). Nothing to expand elsewhere.
 */
function nativeRealPath(path: string): string {
  if (process.platform !== 'win32') throw new Error('not Windows')
  return realpathSync.native(path)
}

/**
 * `path` with every 8.3 short name expanded: the deepest part that exists is
 * resolved (`realPath`) and the rest appended as written. A short name in the
 * part that does not exist (a removed folder) cannot be expanded and stays.
 */
export function longPath(path: string, realPath: RealPath = nativeRealPath): string {
  const normalized = win32.normalize(path)
  const root = win32.parse(normalized).root
  let head = normalized.length > root.length ? normalized.replace(/[\\/]+$/, '') : normalized
  const tail: string[] = []
  for (;;) {
    try {
      return win32.join(realPath(head), ...tail)
    } catch {
      // Missing (or not on Windows): try the folder above it.
    }
    const parent = win32.dirname(head)
    if (parent === head) return win32.join(head, ...tail)
    tail.unshift(win32.basename(head))
    head = parent
  }
}

/**
 * Windows path equality: case-insensitive, separator- and trailing-separator-
 * tolerant, and with 8.3 short names expanded on both sides first, so an exe
 * started as C:\Users\LONGUS~1\...\DOODLE~1\DoodleNote.exe still matches the record.
 */
export function samePath(a: string, b: string, realPath: RealPath = nativeRealPath): boolean {
  const norm = (path: string): string =>
    win32
      .normalize(longPath(path, realPath))
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  return norm(a) === norm(b)
}

/**
 * The old install the installer's record says this exe replaced, or why the record
 * does not apply to this exe: it must name exactly the running exe's folder as
 * MigratedTo, and the identity's two sibling folder names. Short names on either
 * side are expanded first (`realPath`), and the folder names are checked long.
 */
export function legacyInstallFor(
  record: InstallMigrationRecord,
  execPath: string,
  identity: Pick<AppIdentity, 'installFolder' | 'legacyInstallFolder'> = APP_IDENTITY,
  realPath: RealPath = nativeRealPath
): LegacyInstall | { reason: string } {
  const exe = longPath(execPath, realPath)
  const dir = win32.dirname(exe)
  if (!samePath(record.to, dir, realPath)) return { reason: `it is for ${record.to}, not ${dir}` }
  if (win32.basename(dir).toLowerCase() !== identity.installFolder.toLowerCase())
    return { reason: `${dir} is not a ${identity.installFolder} folder` }
  const from = longPath(record.from, realPath)
  if (
    win32.basename(from).toLowerCase() !== identity.legacyInstallFolder.toLowerCase() ||
    !samePath(win32.dirname(from), win32.dirname(dir), realPath)
  )
    return {
      reason: `${record.from} is not the ${identity.legacyInstallFolder} folder beside ${dir}`
    }
  return { dir: from, exe: win32.join(from, win32.basename(exe)) }
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
  /**
   * The installer's record of a completed move, null when there is none, or
   * `{ pending }` when one is there but not complete (left alone: not acted on,
   * not cleared).
   */
  readRecord(): Promise<InstallMigrationRecord | InstallRecordPending | null>
  /** Removes the record once every step has succeeded. */
  clearRecord(): Promise<void>
  /** Whether a file exists (the old exe must be gone). */
  exists(path: string): boolean
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
  /** The status this profile recorded last (null: none), so a stale one can be ended. */
  readStatus(): InstallMigrationStatus | null
  /** Records a status (registry and profile); a failure is logged, never fatal. */
  writeStatus(status: InstallMigrationStatus): Promise<void>
  /** The attempt's time (tests pass a fixed one). */
  now?(): Date
  log(message: string): void
}

export interface InstallMigrationResult {
  ran: boolean
  loginItem: boolean
  mcpClients: string[]
  /** Steps or clients left for the next launch. */
  pending: string[]
  /** What this attempt recorded; null when nothing (no record, nothing to end). */
  status: InstallMigrationStatus | null
  /** Worth trying again in this session (the record could not be read, or a step failed). */
  retry: boolean
}

/** UTC to the second, the form the installer writes (YYYY-MM-DDTHH:MM:SSZ). */
export function statusTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** A reason code from an error's `code` (WinEngineHost.registry): "reader-…". */
export function readFailureReason(error: unknown): string {
  const code = String((error as { code?: unknown })?.code ?? 'error')
  if (/^reader-[a-z0-9-]+$/.test(code)) return code
  return `reader-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
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
  /** The record's MigratedAt: progress belongs to one move. */
  migratedAt: string
  loginItemDone: boolean
  /** MCP clients still to repoint; "all" when the whole step failed. */
  mcpPending: string[] | 'all'
  complete: boolean
}

function readProgress(raw: string | null, execPath: string, migratedAt: string): Marker | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Marker>
    if (
      parsed.version !== MARKER_VERSION ||
      typeof parsed.to !== 'string' ||
      parsed.to.toLowerCase() !== execPath.toLowerCase() ||
      parsed.migratedAt !== migratedAt ||
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
 * Runs only when the installer's record says it moved this exe's install, and the
 * old exe is gone. Idempotent; runs until every step has succeeded once (the
 * marker records progress per move), then clears the record. A step or client
 * that fails is logged and retried on the next launch; the others still run and
 * are not redone. Without a record nothing is read or written.
 */
export async function runWindowsInstallMigration(
  deps: InstallMigrationDeps
): Promise<InstallMigrationResult> {
  const nothing = { ran: false, loginItem: false, mcpClients: [], pending: [] }
  if (deps.platform !== 'win32' || !deps.isPackaged)
    return { ...nothing, status: null, retry: false }
  const at = statusTime(deps.now?.() ?? new Date())
  const recordStatus = async (
    state: InstallMigrationStatus['state'],
    reason: string
  ): Promise<InstallMigrationStatus> => {
    const status = { state, at, reason }
    try {
      await deps.writeStatus(status)
    } catch (error) {
      deps.log(`[install-migration] status not recorded: ${(error as Error).message}`)
    }
    return status
  }
  const stop = async (
    state: InstallMigrationStatus['state'],
    reason: string,
    retry = false
  ): Promise<InstallMigrationResult> => ({
    ...nothing,
    status: await recordStatus(state, reason),
    retry
  })
  let read: InstallMigrationRecord | InstallRecordPending | null
  try {
    read = await deps.readRecord()
  } catch (error) {
    // Nothing is known, so nothing is repointed and nothing is cleared: the record (if
    // any) stays for the next try, in a few minutes and at the next start.
    deps.log(`[install-migration] install record not read: ${(error as Error).message}`)
    return stop('read-failed', readFailureReason(error), true)
  }
  if (!read) {
    // Most launches. A pending or read-failed status left by an earlier attempt is ended.
    let last: InstallMigrationStatus | null = null
    try {
      last = deps.readStatus()
    } catch {
      // An unreadable status file is treated as none.
    }
    if (last && (last.state === 'pending' || last.state === 'read-failed'))
      return stop('none', 'no-record')
    return { ...nothing, status: null, retry: false }
  }
  if ('pending' in read) {
    deps.log(`[install-migration] install record left for the installer: ${read.pending}`)
    return stop('pending', read.code)
  }
  const record = read
  const legacy = legacyInstallFor(record, deps.execPath)
  if ('reason' in legacy) {
    deps.log(`[install-migration] ignoring the install record: ${legacy.reason}`)
    return stop('pending', 'record-other-folder')
  }
  if (deps.exists(legacy.exe)) {
    deps.log(`[install-migration] ${legacy.exe} still exists; nothing repointed`)
    return stop('pending', 'old-exe-present')
  }
  let cleared = true
  const clear = async (): Promise<void> => {
    try {
      await deps.clearRecord()
    } catch (error) {
      cleared = false
      deps.log(`[install-migration] install record not cleared: ${(error as Error).message}`)
    }
  }
  let raw: string | null = null
  try {
    raw = deps.readMarker()
  } catch (error) {
    deps.log(`[install-migration] marker not read: ${(error as Error).message}`)
  }
  const progress = readProgress(raw, deps.execPath, record.at)
  if (progress?.complete) {
    await clear()
    return {
      ...nothing,
      status: await recordStatus('complete', cleared ? 'repointed' : 'record-not-cleared'),
      retry: false
    }
  }

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
    migratedAt: record.at,
    loginItemDone,
    mcpPending,
    complete: pending.length === 0
  }
  try {
    deps.writeMarker(JSON.stringify(marker) + '\n')
  } catch (error) {
    deps.log(`[install-migration] marker not written: ${(error as Error).message}`)
  }
  if (marker.complete) await clear()
  const status = marker.complete
    ? await recordStatus('complete', cleared ? 'repointed' : 'record-not-cleared')
    : await recordStatus('pending', `steps-pending:${pending.join(',')}`)
  return { ran: true, loginItem, mcpClients, pending, status, retry: !marker.complete }
}

/** In-session retries after a failed attempt (every launch also tries once). */
export const INSTALL_MIGRATION_RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000] as const

/**
 * Runs the migration now and, while an attempt asks for it (`retry`), again after
 * each of `delays`. Never throws.
 */
export function runWithRetries(
  attempt: () => Promise<InstallMigrationResult>,
  schedule: (run: () => void, ms: number) => void,
  log: (message: string) => void,
  delays: readonly number[] = INSTALL_MIGRATION_RETRY_MS
): Promise<void> {
  const go = async (index: number): Promise<void> => {
    let retry = false
    try {
      retry = (await attempt()).retry
    } catch (error) {
      log(`[install-migration] ${(error as Error).message}`)
      retry = true
    }
    if (retry && index < delays.length) schedule(() => void go(index + 1), delays[index])
  }
  return go(0)
}
