import type { McpServerSpec } from '../shared/integrations-api'

/**
 * Pure read-modify-write helpers for wiring the doodle-note-mcp server into
 * MCP client configs. Two dialects cover every client we auto-configure:
 * JSON with a top-level `mcpServers` map (Claude Desktop's
 * claude_desktop_config.json and Claude Code's ~/.claude.json) and Codex's
 * ~/.codex/config.toml. All functions take and return file text so the
 * fs boundary stays in AgentAccessService and this stays unit-testable.
 */

/** The key our server is registered under in every client. */
export const MCP_SERVER_KEY = 'doodle-note'

export class ClientConfigError extends Error {}

interface JsonConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

function parseJsonConfig(raw: string, path: string): JsonConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
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
    const config = JSON.parse(raw) as JsonConfig
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

const CODEX_HEADER = `[mcp_servers.${MCP_SERVER_KEY}]`

/**
 * TOML basic strings share JSON's escape rules for everything we emit
 * (quotes, backslashes in Windows paths), so JSON.stringify is a correct
 * TOML string encoder here.
 */
function tomlString(value: string): string {
  return JSON.stringify(value)
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

/** Remove our table: from its header up to the next top-level table or EOF. */
export function codexConfigWithoutServer(raw: string): string {
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => line.trim() === CODEX_HEADER)
  if (start === -1) return raw
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('[')) {
      end = i
      break
    }
  }
  // Also drop blank lines we left directly above the block.
  let cut = start
  while (cut > 0 && lines[cut - 1].trim() === '') cut--
  const result = [...lines.slice(0, cut), ...lines.slice(end)].join('\n')
  // Removing a trailing block must not eat the file's final newline.
  return result === '' || result.endsWith('\n') ? result : result + '\n'
}

export function codexConfigHasServer(raw: string): boolean {
  return raw.split('\n').some((line) => line.trim() === CODEX_HEADER)
}
