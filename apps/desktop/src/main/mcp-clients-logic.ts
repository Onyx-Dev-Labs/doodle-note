import type { McpServerSpec } from '../shared/integrations-api'
import { APP_IDENTITY } from './app-identity'

/**
 * Pure read-modify-write helpers for wiring the doodle-note-mcp server into
 * MCP client configs. Two dialects cover every client we auto-configure:
 * JSON with a top-level `mcpServers` map (Claude Desktop's
 * claude_desktop_config.json and Claude Code's ~/.claude.json) and Codex's
 * ~/.codex/config.toml. All functions take and return file text so the
 * fs boundary stays in AgentAccessService and this stays unit-testable.
 */

/** The key our server is registered under in every client (doodle-note-qa for a QA build). */
export const MCP_SERVER_KEY = APP_IDENTITY.mcpServerKey

export class ClientConfigError extends Error {}

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

/** Splits a TOML key (`a.b`, `"a b".c`, `'x'.y`) into its parts; null when it is not a key. */
export function tomlKeyPath(text: string): string[] | null {
  const s = text.trim()
  const parts: string[] = []
  let i = 0
  const space = (): void => {
    while (s[i] === ' ' || s[i] === '\t') i++
  }
  for (;;) {
    space()
    if (s[i] === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
      if (j >= s.length) return null
      try {
        parts.push(JSON.parse(s.slice(i, j + 1)) as string)
      } catch {
        return null
      }
      i = j + 1
    } else if (s[i] === "'") {
      const j = s.indexOf("'", i + 1)
      if (j === -1) return null
      parts.push(s.slice(i + 1, j))
      i = j + 1
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(s.slice(i))
      if (!bare) return null
      parts.push(bare[0])
      i += bare[0].length
    }
    space()
    if (i === s.length) return parts
    if (s[i] !== '.') return null
    i++
  }
}

interface TomlStatement {
  /** First and last line (inclusive). */
  start: number
  end: number
  kind: 'header' | 'keyval' | 'other'
  /** Header: the table's key path. Key/value: the full path (table + key). */
  path: string[]
  /** Key/value: the value text on its first line. */
  value: string
}

const TRIPLE_BASIC = '"""'
const TRIPLE_LITERAL = "'''"

/** Index of the `=` that ends a key (outside quoted key parts), or -1. */
function keyEnd(text: string): number {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '=') return i
  }
  return -1
}

/** The last line of a value that starts at lines[line][column]. */
function valueEnd(lines: string[], line: number, column: number): number {
  let depth = 0
  let multiline: string | null = null
  for (let l = line; l < lines.length; l++) {
    const text = lines[l]
    let quote: string | null = null
    for (let i = l === line ? column : 0; i < text.length; i++) {
      if (multiline) {
        if (multiline === TRIPLE_BASIC && text[i] === '\\') i++
        else if (text.startsWith(multiline, i)) {
          i += 2
          multiline = null
        }
        continue
      }
      const c = text[i]
      if (quote) {
        if (c === '\\' && quote === '"') i++
        else if (c === quote) quote = null
        continue
      }
      if (text.startsWith(TRIPLE_BASIC, i) || text.startsWith(TRIPLE_LITERAL, i)) {
        multiline = text.slice(i, i + 3)
        i += 2
      } else if (c === '"' || c === "'") quote = c
      else if (c === '#') break
      else if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') depth--
    }
    if (!multiline && depth <= 0) return l
  }
  return lines.length - 1
}

/**
 * A line-based reading of a TOML file good enough to find every statement that
 * belongs to one key: table headers (`[a.b]`, `[[a.b]]`), key/value pairs with
 * their full path (dotted keys included) and their extent over lines (multi-line
 * arrays, inline tables and multi-line strings), and everything else.
 */
function tomlStatements(lines: string[]): TomlStatement[] {
  const statements: TomlStatement[] = []
  let table: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (text === '' || text.startsWith('#')) {
      statements.push({ start: i, end: i, kind: 'other', path: [], value: '' })
      continue
    }
    const header = /^(\[\[?)([^\]]*)(\]\]?)\s*(?:#.*)?$/.exec(text)
    if (header && header[1].length === header[3].length) {
      const path = tomlKeyPath(header[2])
      if (path) {
        table = path
        statements.push({ start: i, end: i, kind: 'header', path, value: '' })
        continue
      }
    }
    const eq = keyEnd(text)
    const key = eq === -1 ? null : tomlKeyPath(text.slice(0, eq))
    if (!key) {
      statements.push({ start: i, end: i, kind: 'other', path: [], value: '' })
      continue
    }
    const end = valueEnd(lines, i, lines[i].indexOf(text) + eq + 1)
    statements.push({
      start: i,
      end,
      kind: 'keyval',
      path: [...table, ...key],
      value: text.slice(eq + 1).trim()
    })
    i = end
  }
  return statements
}

/** Our statements: our table and its subtables, and any key whose full path is under ours. */
function codexOwnedStatements(lines: string[]): TomlStatement[] {
  const ours = (path: string[]): boolean => path[0] === 'mcp_servers' && path[1] === MCP_SERVER_KEY
  const owned: TomlStatement[] = []
  let inOurTable = false
  for (const statement of tomlStatements(lines)) {
    if (statement.kind === 'header') inOurTable = ours(statement.path)
    if (inOurTable || (statement.kind === 'keyval' && ours(statement.path))) owned.push(statement)
  }
  return owned
}

/** A single-line TOML string value (basic or literal), or null. */
function tomlStringValue(value: string): string | null {
  const basic = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(value)
  if (basic) {
    try {
      const parsed: unknown = JSON.parse(basic[1])
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }
  const literal = /^'([^']*)'\s*(?:#.*)?$/.exec(value)
  return literal ? literal[1] : null
}

/** Append our table (replacing any previous one); the rest of the file is untouched. */
export function codexConfigWithServer(raw: string | null, spec: McpServerSpec): string {
  const base = raw === null ? '' : codexConfigWithoutServer(raw)
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
 * Remove our server: its table up to the next table, every subtable
 * (`[mcp_servers.doodle-note.env]`, which would otherwise clash with the inline
 * `env` we write), and any dotted or inline definition elsewhere
 * (`mcp_servers.doodle-note.command = ...`, `doodle-note = { ... }` under
 * `[mcp_servers]`). Everything else is kept as it was.
 */
export function codexConfigWithoutServer(raw: string): string {
  const lines = raw.split('\n')
  const owned = codexOwnedStatements(lines)
  if (owned.length === 0) return raw
  const drop = new Set<number>()
  for (const statement of owned) {
    for (let i = statement.start; i <= statement.end; i++) drop.add(i)
    // Also drop blank lines we left directly above a removed table.
    if (statement.kind === 'header') {
      for (let i = statement.start - 1; i >= 0 && lines[i].trim() === '' && !drop.has(i); i--)
        drop.add(i)
    }
  }
  // Blank lines that separated our table from a table we keep stay.
  for (const statement of tomlStatements(lines)) {
    if (statement.kind !== 'header' || drop.has(statement.start)) continue
    for (let i = statement.start - 1; i >= 0 && drop.has(i) && lines[i].trim() === ''; i--)
      drop.delete(i)
  }
  const result = lines.filter((_, i) => !drop.has(i)).join('\n')
  // Removing a trailing block must not eat the file's final newline.
  return result === '' || result.endsWith('\n') ? result : result + '\n'
}

export function codexConfigHasServer(raw: string): boolean {
  return codexOwnedStatements(raw.split('\n')).length > 0
}

/**
 * The command our Codex entry launches, or null when there is nothing to
 * repoint: no entry, or one that defines no command (a `url` entry, say).
 * Throws ClientConfigError when a command is there but cannot be read.
 */
export function codexConfigServerCommand(raw: string, path: string): string | null {
  const owned = codexOwnedStatements(raw.split('\n'))
  if (owned.length === 0) return null
  let sawCommand = false
  for (const statement of owned) {
    if (statement.kind !== 'keyval') continue
    const rest = statement.path.slice(2)
    if (rest.length === 1 && rest[0] === 'command') {
      sawCommand = true
      const value = tomlStringValue(statement.value)
      if (value !== null) return value
      break
    }
    // An inline table: doodle-note = { command = "...", ... }
    if (rest.length === 0) {
      if (/(?:^|[{,\s])command\s*=/.test(statement.value)) sawCommand = true
      const inline = /(?:^|[{,\s])command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(statement.value)
      const value = inline ? tomlStringValue(inline[1]) : null
      if (value !== null) return value
    }
  }
  if (!sawCommand) return null
  throw new ClientConfigError(`${path} has a ${CODEX_HEADER} entry without a readable command.`)
}
