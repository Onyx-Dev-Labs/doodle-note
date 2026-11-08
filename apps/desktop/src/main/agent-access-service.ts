import { resolveLibraryPath, type LibraryPath } from './library-path'
import { libraryIpc } from './library-ipc'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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
import {
  codexConfigHasServer,
  codexConfigServerCommand,
  codexConfigWithServer,
  codexConfigWithoutServer,
  jsonConfigHasServer,
  jsonConfigServerCommand,
  jsonConfigWithServer,
  jsonConfigWithoutServer
} from './mcp-clients-logic'

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

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Replaces a client config file atomically: the new text goes to a temporary file
 * beside it (same folder, so the rename stays on one volume) with the original's
 * mode, and is renamed over it. Clients such as Claude Code rewrite their file
 * often, so the file is read again just before the rename; when it is no longer
 * `expected` (null: it did not exist) nothing is written and false is returned so
 * the caller starts over from the new content. A symbolic link is followed, so a
 * dotfile link keeps pointing at its target.
 */
export function replaceConfigFile(path: string, expected: string | null, next: string): boolean {
  const target = expected === null ? path : realpathSync(path)
  const mode = expected === null ? 0o600 : statSync(target).mode & 0o7777
  mkdirSync(dirname(target), { recursive: true })
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  writeFileSync(temporary, next, { flag: 'wx', mode })
  try {
    // The file mode is subject to the umask on creation; set it exactly.
    if (process.platform !== 'win32') chmodSync(temporary, mode)
    const current = readConfigFile(target)
    const now =
      current.state === 'read' ? current.raw : current.state === 'absent' ? null : undefined
    if (now !== expected) {
      unlinkSync(temporary)
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
    try {
      unlinkSync(temporary)
    } catch {
      // already renamed or removed
    }
    throw error
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
    sandboxIdentity: options.sandbox?.identity ?? null
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
    this.updateClientConfig(def, (raw) => {
      if (connected) {
        return def.dialect === 'json'
          ? jsonConfigWithServer(raw, this.server, def.configPath)
          : codexConfigWithServer(raw, this.server, def.configPath)
      }
      // Nothing to remove from a file that doesn't exist.
      if (raw === null) return null
      return def.dialect === 'json'
        ? jsonConfigWithoutServer(raw, def.configPath)
        : codexConfigWithoutServer(raw, def.configPath)
    })
    return this.status()
  }

  /**
   * Read-modify-write of one client config: `change` gets the current text (null:
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
    const results: McpRepointResult[] = []
    for (const def of this.clients) {
      if (only && !only.includes(def.id)) continue
      try {
        const outcome = this.updateClientConfig(def, (raw) => {
          if (raw === null) return null
          const command =
            def.dialect === 'json'
              ? jsonConfigServerCommand(raw, def.configPath)
              : codexConfigServerCommand(raw, def.configPath)
          if (command === null || !isStale(command)) return null
          return def.dialect === 'json'
            ? jsonConfigWithServer(raw, this.server, def.configPath)
            : codexConfigWithServer(raw, this.server, def.configPath)
        })
        results.push({ id: def.id, outcome })
      } catch (error) {
        results.push({ id: def.id, outcome: 'failed', error: (error as Error).message })
      }
    }
    return results
  }

  private clientStatus(def: McpClientDef): McpClientStatus {
    const raw = configText(this.tryRead(def.configPath)).text
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
