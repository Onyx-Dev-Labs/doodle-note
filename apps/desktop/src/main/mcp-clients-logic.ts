import type { McpServerSpec } from '../shared/integrations-api'
import {
  ClientConfigError,
  MCP_SERVER_KEY,
  type StrictClientConfigDialects
} from './mcp-clients-common'
import {
  TomlUncertain,
  tomlStatements,
  type TomlStatement,
  type TomlValue
} from './toml-statements'

/**
 * Pure read-modify-write helpers for wiring the doodle-note-mcp server into
 * MCP client configs. Two dialects cover every client we auto-configure:
 * JSON with a top-level `mcpServers` map (Claude Desktop's
 * claude_desktop_config.json and Claude Code's ~/.claude.json) and Codex's
 * ~/.codex/config.toml. All functions take and return file text so the
 * fs boundary stays in AgentAccessService and this stays unit-testable.
 *
 * This is the strict implementation, used on Windows only (AgentAccessService
 * picks by platform): Codex files are read with the TOML statement scanner, a
 * file it cannot read is refused, every definition of our server is removed,
 * and a JSON BOM is accepted. macOS keeps the base's code
 * (mcp-clients-logic-base.ts).
 */

export { ClientConfigError, MCP_SERVER_KEY }

/** What AgentAccessService calls on Windows; read at call time (see the darwin test). */
export const STRICT_CLIENT_CONFIGS: StrictClientConfigDialects = {
  json: {
    withServer: (raw, spec, path) => jsonConfigWithServer(raw, spec, path),
    withoutServer: (raw, path) => jsonConfigWithoutServer(raw, path),
    hasServer: (raw) => jsonConfigHasServer(raw),
    serverCommand: (raw, path) => jsonConfigServerCommand(raw, path)
  },
  codex: {
    withServer: (raw, spec, path) => codexConfigWithServer(raw, spec, path),
    withoutServer: (raw, path) => codexConfigWithoutServer(raw, path),
    hasServer: (raw) => codexConfigHasServer(raw),
    serverCommand: (raw, path) => codexConfigServerCommand(raw, path)
  }
}

interface JsonConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

function parseJsonConfig(raw: string, path: string): JsonConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new ClientConfigError(`${path} is not valid JSON — fix or remove it, then retry.`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ClientConfigError(`${path} is not a JSON object — fix or remove it, then retry.`)
  }
  return parsed as JsonConfig
}

/** Add/replace our entry, preserving everything else in the file. */
export function jsonConfigWithServer(
  raw: string | null,
  spec: McpServerSpec,
  path: string
): string {
  const config = raw === null || raw.trim() === '' ? {} : parseJsonConfig(raw, path)
  const servers = (config.mcpServers ??= {})
  servers[MCP_SERVER_KEY] = {
    command: spec.command,
    args: spec.args,
    env: spec.env
  }
  return JSON.stringify(config, null, 2) + '\n'
}

export function jsonConfigWithoutServer(raw: string, path: string): string {
  const config = parseJsonConfig(raw, path)
  if (config.mcpServers && typeof config.mcpServers === 'object') {
    delete config.mcpServers[MCP_SERVER_KEY]
    // Don't leave an empty map behind in a file that never had one.
    if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers
  }
  return JSON.stringify(config, null, 2) + '\n'
}

export function jsonConfigHasServer(raw: string): boolean {
  try {
    const config = JSON.parse(raw.replace(/^\uFEFF/, '')) as JsonConfig
    return Boolean(
      config &&
      typeof config === 'object' &&
      config.mcpServers &&
      typeof config.mcpServers === 'object' &&
      MCP_SERVER_KEY in config.mcpServers
    )
  } catch {
    return false
  }
}

/**
 * The command our JSON-dialect entry launches, or null when there is nothing to
 * repoint: no entry, or one without a command (an HTTP-transport entry the user
 * wrote, say). Throws ClientConfigError when the file cannot be parsed, so a
 * caller can tell "nothing to do" from "could not tell" (and try again later).
 */
export function jsonConfigServerCommand(raw: string, path: string): string | null {
  const config = parseJsonConfig(raw, path)
  const servers = config.mcpServers
  if (!servers || typeof servers !== 'object' || !(MCP_SERVER_KEY in servers)) return null
  const entry = servers[MCP_SERVER_KEY] as { command?: unknown } | null
  return typeof entry?.command === 'string' ? entry.command : null
}

const CODEX_HEADER = `[mcp_servers.${MCP_SERVER_KEY}]`

/**
 * TOML basic strings share JSON's escape rules for everything we emit
 * (quotes, backslashes in Windows paths), so JSON.stringify is a correct
 * TOML string encoder here.
 */
function tomlString(value: string): string {
  return JSON.stringify(value)
}

/** Where a TOML error message says the file is, when the caller does not say. */
const CODEX_CONFIG_LABEL = '~/.codex/config.toml'

const ownedPath = (path: string[]): boolean =>
  path[0] === 'mcp_servers' && path[1] === MCP_SERVER_KEY

/** Whether an inline table at `prefix` defines (part of) our server inside it. */
function inlineDefinesOurs(prefix: string[], value: TomlValue | null): boolean {
  if (value?.kind !== 'inline') return false
  return value.entries.some((entry) => {
    const path = [...prefix, ...entry.path]
    return ownedPath(path) || inlineDefinesOurs(path, entry.value)
  })
}

/**
 * Our statements: our table and its subtables (up to the next other table, as
 * before), and any key whose full path is under ours (dotted or inline). Throws
 * ClientConfigError when the file cannot be read as TOML, or when our server
 * sits inside an inline table of a parent (`mcp_servers = { doodle-note = ... }`),
 * which cannot be removed without rewriting a line that is not ours. Callers
 * then leave the file as it is.
 */
function codexOwnedStatements(raw: string, path: string): TomlStatement[] {
  let statements: TomlStatement[]
  try {
    statements = tomlStatements(raw)
  } catch (error) {
    if (!(error instanceof TomlUncertain)) throw error
    throw new ClientConfigError(
      `${path} could not be read as TOML (${error.message}); it was left unchanged — fix it, then retry.`
    )
  }
  const owned: TomlStatement[] = []
  let inOurTable = false
  for (const statement of statements) {
    if (statement.kind === 'header') inOurTable = ownedPath(statement.path)
    const mine = statement.kind === 'keyval' && ownedPath(statement.path)
    if (statement.kind === 'keyval' && !mine && inlineDefinesOurs(statement.path, statement.value))
      throw new ClientConfigError(
        `${path} defines ${CODEX_HEADER} inside another inline table; it was left unchanged — move it to its own table, then retry.`
      )
    if (inOurTable || mine) owned.push(statement)
  }
  return owned
}

/**
 * Append our table (replacing any previous one); the rest of the file is
 * untouched. Throws ClientConfigError, writing nothing, when the existing file
 * cannot be read as TOML.
 */
export function codexConfigWithServer(
  raw: string | null,
  spec: McpServerSpec,
  path = CODEX_CONFIG_LABEL
): string {
  const base = raw === null ? '' : codexConfigWithoutServer(raw, path)
  const envPairs = Object.entries(spec.env)
    .map(([key, value]) => `${key} = ${tomlString(value)}`)
    .join(', ')
  const block =
    `${CODEX_HEADER}\n` +
    `command = ${tomlString(spec.command)}\n` +
    `args = [${spec.args.map(tomlString).join(', ')}]\n` +
    `env = { ${envPairs} }\n`
  const trimmed = base.replace(/\n+$/, '')
  return trimmed === '' ? block : `${trimmed}\n\n${block}`
}

/**
 * Remove our server: its table up to the next other table (with the blank lines
 * directly above its header, as before), every subtable
 * (`[mcp_servers.doodle-note.env]`, which would otherwise clash with the inline
 * `env` we write), and any dotted or inline definition elsewhere
 * (`mcp_servers.doodle-note.command = ...`, `doodle-note = { ... }` under
 * `[mcp_servers]`). Every other line is kept byte for byte. Throws
 * ClientConfigError, changing nothing, when the file cannot be read as TOML.
 */
export function codexConfigWithoutServer(raw: string, path = CODEX_CONFIG_LABEL): string {
  const owned = codexOwnedStatements(raw, path)
  if (owned.length === 0) return raw
  // A byte order mark belongs to the file, not to the first line.
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const lines = raw.slice(bom.length).split('\n')
  const drop = new Set<number>()
  for (const statement of owned) {
    for (let i = statement.start; i <= statement.end; i++) drop.add(i)
    if (statement.kind === 'header') {
      for (let i = statement.start - 1; i >= 0 && lines[i].trim() === '' && !drop.has(i); i--)
        drop.add(i)
    }
  }
  const result = lines.filter((_, i) => !drop.has(i)).join('\n')
  // Removing a trailing block must not eat the file's final newline.
  return bom + (result === '' || result.endsWith('\n') ? result : result + '\n')
}

/**
 * Whether the file registers our server. A file that cannot be read as TOML
 * falls back to the exact header line, as before: this only drives the
 * Connected badge, and every edit of such a file is refused.
 */
export function codexConfigHasServer(raw: string): boolean {
  try {
    return codexOwnedStatements(raw, CODEX_CONFIG_LABEL).length > 0
  } catch {
    return raw.split('\n').some((line) => line.trim() === CODEX_HEADER)
  }
}

/**
 * The command our Codex entry launches, or null when there is nothing to
 * repoint: no entry, or one that defines no command (a `url` entry, say).
 * Throws ClientConfigError when the file cannot be read as TOML, or a command
 * is there but is not a string.
 */
export function codexConfigServerCommand(raw: string, path: string): string | null {
  const owned = codexOwnedStatements(raw, path)
  for (const statement of owned) {
    if (statement.kind !== 'keyval' || !statement.value) continue
    const rest = statement.path.slice(2)
    // command = "..." in our table, or mcp_servers.doodle-note.command = "..."
    if (rest.length === 1 && rest[0] === 'command') return commandString(statement.value, path)
    // An inline table: doodle-note = { command = "...", ... } ("command" quoted or not).
    if (rest.length === 0 && statement.value.kind === 'inline') {
      const entry = statement.value.entries.find(
        (e) => e.path.length === 1 && e.path[0] === 'command'
      )
      if (entry) return commandString(entry.value, path)
    }
  }
  return null
}

function commandString(value: TomlValue, path: string): string {
  if (value.kind === 'string') return value.value
  throw new ClientConfigError(`${path} has a ${CODEX_HEADER} entry without a readable command.`)
}
