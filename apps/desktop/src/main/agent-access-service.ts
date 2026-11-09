import { resolveLibraryPath, type LibraryPath } from './library-path'
import { libraryIpc } from './library-ipc'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  linkSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
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
import type { ClientConfigDialect } from './mcp-clients-common'
import { BASE_CLIENT_CONFIGS } from './mcp-clients-logic-base'
import { STRICT_CLIENT_CONFIGS } from './mcp-clients-logic'

export interface McpRepointResult {
  id: McpClientId
  outcome: 'unchanged' | 'updated' | 'failed'
  error?: string
}

/**
 * A client config file's text, `absent` only when there is no such file, or the
 * read error (locked, permission denied, a folder in its place).
 */
export function readConfigFile(
  path: string
): { state: 'absent' } | { state: 'read'; raw: string } | { state: 'error'; message: string } {
  try {
    return { state: 'read', raw: readFileSync(path, 'utf8') }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' }
    return { state: 'error', message: (error as Error).message }
  }
}

/**
 * A config file's text without a UTF-8 byte order mark (returned separately so a
 * rewrite keeps it); an empty or blank file is no config at all (null).
 */
export function configText(raw: string | null): { bom: string; text: string | null } {
  if (raw === null) return { bom: '', text: null }
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = raw.slice(bom.length)
  return { bom, text: text.trim() === '' ? null : text }
}

/** True when two config texts say the same thing (JSON compared parsed, TOML as text). */
export function sameConfigContent(a: string, b: string, dialect: 'json' | 'toml'): boolean {
  if (dialect === 'json') {
    try {
      return isDeepStrictEqual(JSON.parse(a), JSON.parse(b))
    } catch {
      return false
    }
  }
  const text = (value: string): string => value.replace(/\r\n/g, '\n').trimEnd()
  return text(a) === text(b)
}

/**
 * Where a write to `path` lands, resolved as the file system resolves it: the
 * real path of an existing file (fs.realpathSync.native: realpath(3) on macOS,
 * GetFinalPathNameByHandle on Windows), or, when the chain ends in a name that
 * does not exist yet (a dangling symbolic link, or no file), that name inside
 * its folder's real path, which is where open(O_CREAT) creates it. A link's text
 * is never joined and normalised lexically: `dirlink/../config.json` is the
 * `config.json` beside dirlink's *target*, not beside dirlink. Null when the
 * place cannot be determined this way (a missing or unreadable folder on the
 * way, a loop, a name ending in `.` or `..`); the caller then writes in place
 * (macOS: exactly the base's writeFileSync, which fails or succeeds as before)
 * or refuses (Windows). An error for which `thrown` is true is thrown instead
 * (round 13, macOS: one after which the base's write must not decide, an I/O
 * error for example; see BASE_DECIDES).
 */
export function configWriteTarget(
  path: string,
  thrown: (error: unknown) => boolean = () => false
): string | null {
  const separators = process.platform === 'win32' ? /[\\/]/ : /\//
  let current = path
  for (let hops = 0; hops <= 40; hops++) {
    try {
      const real = realpathSync.native(current)
      // (Checked, not assumed: a realpath that accepted a missing last name.)
      if (!lstatSync(real).isSymbolicLink()) return real
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return unresolved(error, thrown)
    }
    // Something on the way does not exist: resolve the folder, then the last name.
    let cut = -1
    for (let i = current.length - 1; i >= 0; i--)
      if (separators.test(current[i])) {
        cut = i
        break
      }
    const leaf = current.slice(cut + 1)
    if (leaf === '' || leaf === '.' || leaf === '..') return null
    let folder: string
    try {
      const head = cut < 0 ? '.' : current.slice(0, cut) || current[0]
      // `C:` alone is the drive's current folder, not its root.
      folder = realpathSync.native(/^[A-Za-z]:$/.test(head) ? head + sep : head)
    } catch (error) {
      return unresolved(error, thrown)
    }
    const candidate = join(folder, leaf)
    let link: boolean
    try {
      link = lstatSync(candidate).isSymbolicLink()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      return unresolved(error, thrown)
    }
    if (!link) return candidate
    // A dangling link: its text is relative to the link's real folder, taken verbatim.
    let text: string
    try {
      text = readlinkSync(candidate)
    } catch (error) {
      return unresolved(error, thrown)
    }
    current = isAbsolute(text) ? text : `${folder}${sep}${text}`
  }
  return null
}

/** configWriteTarget's answer to a failure: null, or the failure thrown. */
function unresolved(error: unknown, thrown: (error: unknown) => boolean): null {
  if (thrown(error)) throw error
  return null
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * A temporary file's name beside `target`: short and of fixed length whatever the
 * target is called (round 11), so it fits wherever the target's own name fits (a
 * name built from a 220-character basename would be 262 characters,
 * ENAMETOOLONG where the base's write of the target itself succeeded).
 */
export function temporaryBeside(target: string): string {
  return join(dirname(target), `.dn-${randomBytes(4).toString('hex')}.tmp`)
}

/** Names tried when a temporary name is already taken (32 random bits each). */
export const TEMPORARY_ATTEMPTS = 8

/**
 * Creates a temporary file beside `target` (temporaryBeside; 'wx', so never one
 * that exists) and returns its path and open descriptor. Only a file returned
 * here belongs to the write, and only such a file is ever removed (round 12: a
 * name that was taken is someone else's file). A taken name (EEXIST) is retried
 * with a fresh one, TEMPORARY_ATTEMPTS names in all, then EEXIST is thrown; any
 * other error is thrown at once. Nothing is created when it throws.
 */
export function createTemporaryBeside(target: string, mode: number): { path: string; fd: number } {
  for (let attempt = 1; ; attempt++) {
    const path = temporaryBeside(target)
    try {
      return { path, fd: openSync(path, 'wx', mode) }
    } catch (error) {
      const taken = (error as NodeJS.ErrnoException).code === 'EEXIST'
      if (!taken || attempt >= TEMPORARY_ATTEMPTS) throw error
    }
  }
}

/**
 * Removes a temporary file this write created (createTemporaryBeside), never
 * another. A failure is not reported (the write's own result stands): the file
 * then remains, `.dn-<8 hex>.tmp` in the config's folder.
 */
function removeOwnTemporary(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Left behind (removed meanwhile, or the removal was refused).
  }
}

/**
 * Windows: replaces a client config file atomically: the new text goes to a
 * temporary file beside it (same folder, so the rename stays on one volume; a short
 * name, createTemporaryBeside: never an existing file, and only the file it created
 * is removed) with the original's mode (a new file: 0600), and is renamed over it.
 * A temporary file whose removal fails remains (removeOwnTemporary). Clients such as Claude Code rewrite their file
 * often, so the file is read again just before the rename; when it is no longer
 * `expected` (null: it did not exist) nothing is written and false is returned so
 * the caller starts over from the new content. A symbolic link is followed, so a
 * dotfile link keeps pointing at its target (configWriteTarget, the same
 * resolution as macOS); where it leads cannot be determined, nothing is written.
 */
export function replaceConfigFile(path: string, expected: string | null, next: string): boolean {
  if (expected === null) mkdirSync(dirname(path), { recursive: true })
  const target = configWriteTarget(path)
  if (target === null)
    throw new Error(`${path}: could not tell where this file leads; not written.`)
  const mode = expected === null ? 0o600 : statSync(target).mode & 0o7777
  // Throws when no temporary file could be created: nothing written, nothing removed.
  const { path: temporary, fd } = createTemporaryBeside(target, mode)
  try {
    try {
      writeFileSync(fd, next)
      // The file mode is subject to the umask on creation; set it exactly.
      if (process.platform !== 'win32') fchmodSync(fd, mode)
    } finally {
      closeSync(fd)
    }
    const current = readConfigFile(target)
    const now =
      current.state === 'read' ? current.raw : current.state === 'absent' ? null : undefined
    if (now !== expected) {
      removeOwnTemporary(temporary)
      return false
    }
    // Windows refuses the rename while another process has the file open without
    // FILE_SHARE_DELETE; that lasts milliseconds, so retry briefly.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temporary, target)
        return true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error
        sleep(50)
      }
    }
  } catch (error) {
    // Not renamed (the rename is the last step): still this write's own file.
    removeOwnTemporary(temporary)
    throw error
  }
}

/**
 * Every other platform (macOS): the base's write (win/bark 9355b87 wrote in
 * place with writeFileSync) with one change, the one disclosed for macOS: the
 * text goes to a temporary file beside the target and is renamed over it, so a
 * crash never leaves a half-written config. Everything else is the base's: no
 * re-read before the write (the base wrote blind), the original's permission
 * bits kept (writeFileSync kept them), a new file created with the default mode
 * (0666 less the umask, as writeFileSync did), and a symbolic link followed, even
 * one whose target does not exist yet (writeFileSync created the target), to
 * the file the kernel's own resolution reaches (configWriteTarget). Where that
 * cannot be determined, or the place holds no file, the base's in-place write.
 *
 * The rename needs write permission on the folder, not on the file, so it would
 * replace a read-only file the base could not write and fail on a writable file
 * in a read-only folder the base could write. So the replace is used only where
 * both writes are allowed, and the file's own permission is decided as the base
 * decided it, by opening it for writing (round 11; no create, no truncation):
 * that open is the moment the base's write was allowed, and its descriptor stays
 * the authority until the last fstat, just before the rename. A change made after
 * it (chmod 0444) is one the base's write, already open, would have outlived too:
 * the text is written and the file keeps the mode it has just before the rename. A change made before it
 * fails the open and the base's write decides. A new file is linked into place
 * (link(2), never replacing a file that appeared meanwhile). If a step on the way
 * fails for want of permission or support, or because the name no longer leads
 * to a file (the open, the temporary file, the link or the rename; BASE_DECIDES),
 * or the name no longer holds the opened file (replaced meanwhile), the original
 * is untouched and the base's in-place write decides: it succeeds or fails (same
 * error, truncating first as it always did) exactly as it would have at that
 * moment. Any other failure (a full disk, EDQUOT, EIO) is thrown with the original
 * untouched and the temporary file removed (unless that removal fails, below),
 * where the base's write would have truncated it first (round 12: the one
 * difference in failure, disclosed, for the owner to acknowledge). Round 13: the
 * checks before the replace (resolving the path, the stat, the folder's access
 * check and the open) are classified the same way: a BASE_DECIDES failure there
 * leads to the base's in-place write, any other is thrown before anything is
 * written or created.
 *
 * The temporary file is created exclusively (createTemporaryBeside: a taken name
 * is retried with a fresh one, then the base's write decides), and only a file
 * this write created is removed: never one another writer holds (round 12).
 *
 * What remains (the concurrency contract, tested where it can be): a change to
 * the file's mode bits made in the interval between the last fstat (the
 * descriptor is released there) and the rename lands on the replaced file, not
 * the new one (the owner, group and any ACL of the original are not carried over
 * at all: the new file has only the ACL entries its folder passes on, if any;
 * disclosed). As with any replace by rename, another writer's content is
 * lost when it lands meanwhile: another client's own atomic rewrite between the
 * identity check (lstat) and the rename is replaced by ours, and another
 * process's in-place write to the file between the open and the rename goes to
 * the replaced file. And the temporary file remains whenever its removal fails
 * (removeOwnTemporary: the failure is not reported, the result stands; it is
 * attempted on every failure path, a failed close included, round 13), for
 * example when the folder became read-only before the rename or, for a new file,
 * before the link. It is `.dn-<8 hex>.tmp` in the config's folder.
 */
export function replaceConfigFileBase(path: string, next: string): void {
  const target = configWriteTarget(path, unclassified)
  let stats: ReturnType<typeof statSync> | null = null
  let statFailed = false
  if (target !== null)
    try {
      stats = statSync(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') statFailed = baseDecides(error)
    }
  // Not determinable (configWriteTarget, the stat), or a folder (or anything else
  // that is not a file) in the config's place, or a read-only folder: written as
  // the base wrote it, in place through the original path, so it fails (or
  // succeeds) exactly as before.
  if (
    target === null ||
    statFailed ||
    (stats !== null && !stats.isFile()) ||
    !writable(dirname(target))
  ) {
    writeFileSync(path, next)
    return
  }
  let authority: number | null = null
  if (stats !== null)
    try {
      authority = openSync(target, fsConstants.O_WRONLY)
    } catch (error) {
      // Not writable (or gone) now: the base's write decides (round 13: only after
      // a BASE_DECIDES failure; an I/O error is thrown, nothing written).
      baseDecides(error)
      writeFileSync(path, next)
      return
    }
  const replacing = authority !== null
  // Set only once this write has created the file (round 12): a name that was
  // taken (EEXIST) belongs to someone else and is never removed.
  let temporary: string | null = null
  let done = false
  let failure: unknown = null
  const replaced = new Error('replaced meanwhile')
  try {
    // A new file: the default mode (0666 less the umask), as writeFileSync created
    // it. A replacement: private until it takes the original's mode below.
    const created = createTemporaryBeside(target, replacing ? 0o600 : 0o666)
    temporary = created.path
    const fd = created.fd
    try {
      writeFileSync(fd, next)
      if (authority !== null) {
        // The mode the file has now (changed after the open: kept), set exactly.
        const now = fstatSync(authority)
        const here = lstatSync(target)
        if (here.ino !== now.ino || here.dev !== now.dev) throw replaced
        fchmodSync(fd, now.mode & 0o7777)
        // Released before the rename (Windows refuses to rename over an open file);
        // from here on a change lands on the replaced file: the stated residual.
        // Cleared first (round 13): a close that fails has still released the
        // number (POSIX), which must not be closed again below.
        const opened = authority
        authority = null
        closeSync(opened)
      }
    } finally {
      closeSync(fd)
    }
    if (replacing) renameSync(temporary, target)
    else linkSync(temporary, target)
    done = true
  } catch (error) {
    // The original is untouched. A permission or compatibility failure, or a file
    // replaced or removed meanwhile: the base's write decides. Anything else (a
    // full disk, I/O) is thrown as is, the original left intact (round 12).
    if (error !== replaced && unclassified(error)) failure = error
  } finally {
    // Still open only after a failure. Closed once, and its own failure changes
    // nothing (round 13): the outcome above stands and the cleanup below runs.
    if (authority !== null) {
      const opened = authority
      authority = null
      try {
        closeSync(opened)
      } catch {
        // Released anyway; nothing was written through it.
      }
    }
    // Renamed into place: the name is free again and may be another writer's now.
    if (temporary !== null && !(done && replacing)) removeOwnTemporary(temporary)
  }
  if (failure !== null) throw failure
  if (!done) writeFileSync(path, next)
}

/**
 * The failures after which the base's in-place write decides (round 12: of the
 * atomic replace; round 13: also of the checks before it): those of permission,
 * compatibility and the name, where the base's own write may succeed (or fails
 * with its own error): access refused, a read-only volume, no hard links or
 * renames here (EXDEV, ENOTSUP, EOPNOTSUPP, EINVAL, EMLINK), a name too long,
 * every temporary name taken or a file that appeared before the link (EEXIST), a
 * file or folder removed meanwhile (ENOENT), and a name that does not lead to a
 * file (round 13: ENOTDIR, EISDIR, ELOOP, each one the base's own open fails
 * with, before it truncates anything). Any other failure (ENOSPC, EDQUOT, EIO,
 * ENOMEM, EMFILE, ...) is thrown with the original untouched, because the
 * in-place write truncates first: on a full disk it would leave the config empty
 * or cut short (the base's behavior; a disclosed difference, for the owner to
 * acknowledge).
 */
const BASE_DECIDES = new Set([
  'EACCES',
  'EPERM',
  'EROFS',
  'EXDEV',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EINVAL',
  'EMLINK',
  'ENAMETOOLONG',
  'EEXIST',
  'ENOENT',
  'ENOTDIR',
  'EISDIR',
  'ELOOP'
])

/** True for a failure after which the base's write must not decide (not BASE_DECIDES). */
function unclassified(error: unknown): boolean {
  return !BASE_DECIDES.has((error as NodeJS.ErrnoException).code ?? '')
}

/** Returns true for a BASE_DECIDES failure (the base's write decides); throws any other. */
function baseDecides(error: unknown): true {
  if (unclassified(error)) throw error
  return true
}

/**
 * access(2) W_OK (macOS: also honours ACLs and the immutable flags). False after
 * a BASE_DECIDES failure; any other is thrown (round 13: an I/O error is not a
 * read-only folder).
 */
function writable(path: string): boolean {
  try {
    accessSync(path, fsConstants.W_OK)
    return true
  } catch (error) {
    baseDecides(error)
    return false
  }
}

interface McpClientDef {
  id: McpClientId
  name: string
  /** Client counts as installed when any of these exists. */
  detectPaths: string[]
  configPath: string
  dialect: 'json' | 'toml'
}

/**
 * Where agent access reads and writes: the home the client dotfiles live in
 * (~/.claude.json, ~/.codex), the per-user app data folder Claude Desktop keeps
 * its config in, and the opt-in file the MCP server requires.
 */
export interface AgentAccessRoots {
  home: string
  appData: string
  mcpConfigPath: string
  /**
   * Set for a sandbox: the identity the opt-in file is written for. The server
   * spec then names the sandbox's opt-in file and this identity, and the MCP
   * server refuses any other file (packages/doodle-note-mcp/src/config.ts).
   */
  sandboxIdentity: string | null
  /**
   * The platform the roots are for. It also picks how client configs are
   * edited: Windows uses the strict implementation (mcp-clients-logic.ts), every
   * other platform the base's code (mcp-clients-logic-base.ts), so macOS
   * behaves as before this PR apart from the atomic replace.
   */
  platform: NodeJS.Platform
}

/** Environment that binds the MCP server to a sandbox's opt-in file. */
export const MCP_CONFIG_ENV = 'DOODLE_NOTE_MCP_CONFIG'
export const MCP_IDENTITY_ENV = 'DOODLE_NOTE_MCP_IDENTITY'

/**
 * The real locations, shared by every production DoodleNote of this user; or,
 * with `sandbox`, every one of them inside its home folder. A development or QA
 * identity build passes its sandbox, so no client config root (not even
 * %APPDATA%, nor a DOODLE_NOTE_MCP_CONFIG inherited from the environment) can
 * lead it to the production files.
 */
export function agentAccessRoots(options: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  sandbox?: { home: string; identity: string }
}): AgentAccessRoots {
  const sandboxHome = options.sandbox?.home
  const { platform, env } = options
  const home = sandboxHome ?? options.home
  const appData =
    platform === 'win32'
      ? sandboxHome === undefined && env.APPDATA
        ? env.APPDATA
        : join(home, 'AppData', 'Roaming')
      : join(home, 'Library', 'Application Support')
  const defaultConfig = join(home, '.doodlenote', 'mcp.json')
  return {
    home,
    appData,
    mcpConfigPath:
      sandboxHome === undefined ? (env.DOODLE_NOTE_MCP_CONFIG ?? defaultConfig) : defaultConfig,
    sandboxIdentity: options.sandbox?.identity ?? null,
    platform
  }
}

/**
 * The MCP clients whose configs the Connect buttons manage. Both JSON
 * clients keep a top-level `mcpServers` map, so one dialect covers each.
 */
export function clientDefs(roots: AgentAccessRoots): McpClientDef[] {
  const { home, appData } = roots
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
  private readonly sandboxIdentity: string | null
  /** Windows: the strict client-config edits; otherwise the base's (see AgentAccessRoots.platform). */
  private readonly strictClientConfigs: boolean
  /** The launch spec written into client configs and shown in Settings. */
  private readonly server: McpServerSpec

  private get meetingsDir(): string {
    return resolveLibraryPath(this.meetingsDirSource)
  }

  /**
   * `roots` defaults to the real locations; a string is a home folder that holds
   * every one of them (tests).
   */
  constructor(
    private readonly meetingsDirSource: LibraryPath,
    server: McpServerSpec,
    roots: AgentAccessRoots | string = agentAccessRoots({
      platform: process.platform,
      env: process.env,
      home: homedir()
    })
  ) {
    const resolved =
      typeof roots === 'string'
        ? agentAccessRoots({
            platform: process.platform,
            env: process.env,
            home: roots,
            sandbox: { home: roots, identity: '' }
          })
        : roots
    this.configPath = resolved.mcpConfigPath
    this.clients = clientDefs(resolved)
    this.sandboxIdentity = resolved.sandboxIdentity || null
    this.strictClientConfigs = resolved.platform === 'win32'
    // A sandbox's server must read the sandbox's opt-in file, never the real
    // ~/.doodlenote/mcp.json (which would expose the production library).
    this.server = this.sandboxIdentity
      ? {
          ...server,
          env: {
            ...server.env,
            [MCP_CONFIG_ENV]: this.configPath,
            [MCP_IDENTITY_ENV]: this.sandboxIdentity
          }
        }
      : server
  }

  /** Preserve consent while following a successfully relocated library. */
  refreshLibraryPath(previousMeetingsDir: string): void {
    const raw = this.tryRead(this.configPath)
    if (raw === null) return
    let config: Record<string, unknown>
    try {
      config = JSON.parse(raw)
    } catch {
      return // Do not replace malformed configuration.
    }
    if (
      config &&
      typeof config.enabled === 'boolean' &&
      config.meetingsDir === previousMeetingsDir &&
      config.meetingsDir !== this.meetingsDir
    ) {
      const temporary = `${this.configPath}.${randomUUID()}.tmp`
      writeFileSync(
        temporary,
        JSON.stringify({ ...config, meetingsDir: this.meetingsDir }, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 }
      )
      renameSync(temporary, this.configPath)
    }
  }

  registerIpc(): void {
    libraryIpc.handle(AGENT_ACCESS_GET_CHANNEL, () => this.status())
    libraryIpc.handle(AGENT_ACCESS_SET_CHANNEL, (_event, enabled: unknown) =>
      this.setEnabled(Boolean(enabled))
    )
    libraryIpc.handle(AGENT_ACCESS_CONNECT_CLIENT_CHANNEL, (_event, id: unknown) =>
      this.setClientConnected(String(id) as McpClientId, true)
    )
    libraryIpc.handle(AGENT_ACCESS_DISCONNECT_CLIENT_CHANNEL, (_event, id: unknown) =>
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
      JSON.stringify(
        {
          enabled,
          meetingsDir: this.meetingsDir,
          ...(this.sandboxIdentity ? { identity: this.sandboxIdentity } : {})
        },
        null,
        2
      ) + '\n'
    )
    return this.status()
  }

  setClientConnected(id: McpClientId, connected: boolean): AgentAccessStatus {
    const def = this.clients.find((c) => c.id === id)
    if (!def) throw new Error(`Unknown MCP client: ${id}`)
    if (!this.strictClientConfigs) {
      this.setClientConnectedBase(def, connected)
      return this.status()
    }
    const dialect = this.strictDialect(def)
    this.updateClientConfig(def, (raw) => {
      if (connected) return dialect.withServer(raw, this.server, def.configPath)
      // Nothing to remove from a file that doesn't exist.
      if (raw === null) return null
      return dialect.withoutServer(raw, def.configPath)
    })
    return this.status()
  }

  /**
   * macOS (every platform but Windows): win/bark 9355b87's setClientConnected,
   * statement for statement, with its in-place write replaced by
   * replaceConfigFileBase (temporary file + rename, the one disclosed change). So
   * an unreadable config reads as none, an empty or blank one is edited as the
   * base edited it, a JSON BOM is not accepted, and a write happens whenever the
   * text differs.
   */
  private setClientConnectedBase(def: McpClientDef, connected: boolean): void {
    const dialect = this.baseDialect(def)
    const raw = this.tryRead(def.configPath)
    let next: string | null
    if (connected) {
      next = dialect.withServer(raw, this.server, def.configPath)
    } else {
      // Nothing to remove from a file that doesn't exist.
      next = raw === null ? null : dialect.withoutServer(raw, def.configPath)
    }
    if (next !== null && next !== raw) {
      mkdirSync(dirname(def.configPath), { recursive: true })
      replaceConfigFileBase(def.configPath, next)
    }
  }

  // Looked up at every call, never cached: the darwin test replaces the strict
  // functions with ones that throw and expects macOS never to reach them.
  private strictDialect(def: McpClientDef): (typeof STRICT_CLIENT_CONFIGS)['json'] {
    return def.dialect === 'json' ? STRICT_CLIENT_CONFIGS.json : STRICT_CLIENT_CONFIGS.codex
  }

  private baseDialect(def: McpClientDef): ClientConfigDialect {
    return def.dialect === 'json' ? BASE_CLIENT_CONFIGS.json : BASE_CLIENT_CONFIGS.codex
  }

  /**
   * Windows: read-modify-write of one client config: `change` gets the current text (null:
   * no file, or an empty one) and returns the new text, or null for no change. A
   * UTF-8 byte order mark is not part of the text `change` sees and is kept on
   * write. Nothing is written when the content would not change; the write is
   * atomic (replaceConfigFile) and starts over if the client rewrote the file in
   * the meantime. A config that exists but cannot be read throws, so it is never
   * replaced blind.
   */
  private updateClientConfig(
    def: McpClientDef,
    change: (raw: string | null) => string | null
  ): 'unchanged' | 'updated' {
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = readConfigFile(def.configPath)
      if (read.state === 'error') throw new Error(read.message)
      const raw = read.state === 'read' ? read.raw : null
      const { bom, text } = configText(raw)
      const next = change(text)
      if (next === null || (text !== null && sameConfigContent(text, next, def.dialect)))
        return 'unchanged'
      if (replaceConfigFile(def.configPath, raw, bom + next)) return 'updated'
    }
    throw new Error(`${def.configPath} kept changing while it was being updated; try again.`)
  }

  /**
   * Re-register our server, with the current launch spec, in every client whose
   * entry runs a command `isStale` rejects (the Windows install folder moved).
   * Other entries and clients are untouched. `only` limits the pass to clients
   * not yet done. Each client reports `unchanged` (no config file, no entry of
   * ours, or already current), `updated`, or `failed`: the file exists but could
   * not be read, parsed or written, so the caller must try again later rather
   * than treat it as nothing to do.
   */
  repointStaleClients(
    isStale: (command: string) => boolean,
    only?: readonly string[] | null
  ): McpRepointResult[] {
    // The install move it serves exists only on Windows.
    if (!this.strictClientConfigs) throw new Error('MCP client repointing is Windows-only.')
    const results: McpRepointResult[] = []
    for (const def of this.clients) {
      if (only && !only.includes(def.id)) continue
      try {
        const dialect = this.strictDialect(def)
        const outcome = this.updateClientConfig(def, (raw) => {
          if (raw === null) return null
          const command = dialect.serverCommand(raw, def.configPath)
          if (command === null || !isStale(command)) return null
          return dialect.withServer(raw, this.server, def.configPath)
        })
        results.push({ id: def.id, outcome })
      } catch (error) {
        results.push({ id: def.id, outcome: 'failed', error: (error as Error).message })
      }
    }
    return results
  }

  private clientStatus(def: McpClientDef): McpClientStatus {
    // The base read the file as it is; Windows sets a BOM aside and reads an empty file as none.
    const raw = this.strictClientConfigs
      ? configText(this.tryRead(def.configPath)).text
      : this.tryRead(def.configPath)
    const dialect = this.strictClientConfigs ? this.strictDialect(def) : this.baseDialect(def)
    const connected = raw !== null && dialect.hasServer(raw)
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
