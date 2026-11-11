import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ClientConfigError,
  codexConfigHasServer,
  codexConfigServerCommand,
  codexConfigWithServer,
  codexConfigWithoutServer,
  jsonConfigHasServer,
  jsonConfigWithServer,
  jsonConfigWithoutServer
} from './mcp-clients-logic'
import type { McpServerSpec } from '../shared/integrations-api'

const spec: McpServerSpec = {
  command: '/Applications/DoodleNote.app/Contents/MacOS/DoodleNote',
  args: ['/Applications/DoodleNote.app/Contents/Resources/mcp/cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

const winSpec: McpServerSpec = {
  command: 'C:\\Users\\sean\\AppData\\Local\\Programs\\DoodleNote\\DoodleNote.exe',
  args: ['C:\\Users\\sean\\AppData\\Local\\Programs\\DoodleNote\\resources\\mcp\\cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

test('jsonConfigWithServer creates a config from nothing', () => {
  const out = jsonConfigWithServer(null, spec, 'x.json')
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.mcpServers['doodle-note'], {
    command: spec.command,
    args: spec.args,
    env: spec.env
  })
  assert.ok(jsonConfigHasServer(out))
})

test('jsonConfigWithServer preserves unrelated keys and other servers', () => {
  const existing = JSON.stringify({
    theme: 'dark',
    mcpServers: { other: { command: 'foo' } },
    projects: { '/x': { history: [1, 2] } }
  })
  const out = jsonConfigWithServer(existing, spec, 'x.json')
  const parsed = JSON.parse(out)
  assert.equal(parsed.theme, 'dark')
  assert.deepEqual(parsed.mcpServers.other, { command: 'foo' })
  assert.deepEqual(parsed.projects, { '/x': { history: [1, 2] } })
  assert.equal(parsed.mcpServers['doodle-note'].command, spec.command)
})

test('jsonConfigWithServer replaces a stale entry', () => {
  const stale = jsonConfigWithServer(null, { ...spec, args: ['/old/path.js'] }, 'x.json')
  const out = jsonConfigWithServer(stale, spec, 'x.json')
  assert.deepEqual(JSON.parse(out).mcpServers['doodle-note'].args, spec.args)
})

test('jsonConfigWithServer refuses to clobber invalid JSON', () => {
  assert.throws(() => jsonConfigWithServer('{ not json', spec, 'x.json'), ClientConfigError)
  assert.throws(() => jsonConfigWithServer('[1,2]', spec, 'x.json'), ClientConfigError)
})

test('jsonConfigWithoutServer removes only our entry', () => {
  const withBoth = jsonConfigWithServer(
    JSON.stringify({ mcpServers: { other: { command: 'foo' } } }),
    spec,
    'x.json'
  )
  const out = jsonConfigWithoutServer(withBoth, 'x.json')
  const parsed = JSON.parse(out)
  assert.deepEqual(parsed.mcpServers, { other: { command: 'foo' } })
  assert.ok(!jsonConfigHasServer(out))
})

test('jsonConfig connect/disconnect round-trips a file with no mcpServers key', () => {
  const original = JSON.stringify({ theme: 'dark', numStartups: 44 })
  const connected = jsonConfigWithServer(original, spec, 'x.json')
  const restored = jsonConfigWithoutServer(connected, 'x.json')
  assert.deepEqual(JSON.parse(restored), JSON.parse(original))
})

test('jsonConfigHasServer is false for garbage or missing entry', () => {
  assert.equal(jsonConfigHasServer('not json'), false)
  assert.equal(jsonConfigHasServer('{}'), false)
  assert.equal(jsonConfigHasServer('{"mcpServers":{}}'), false)
})

test('codexConfigWithServer appends a table to an existing config', () => {
  const existing = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "foo"\n'
  const out = codexConfigWithServer(existing, spec)
  assert.ok(out.startsWith('model = "o3"'))
  assert.ok(out.includes('[mcp_servers.other]'))
  assert.ok(out.includes('[mcp_servers.doodle-note]'))
  assert.ok(out.includes(`command = "${spec.command}"`))
  assert.ok(out.includes('env = { ELECTRON_RUN_AS_NODE = "1" }'))
  assert.ok(codexConfigHasServer(out))
})

test('codexConfigWithServer escapes Windows paths', () => {
  const out = codexConfigWithServer(null, winSpec)
  assert.ok(out.includes('command = "C:\\\\Users\\\\sean'))
})

test('codexConfigWithServer replaces a stale table instead of duplicating', () => {
  const stale = codexConfigWithServer('model = "o3"', { ...spec, args: ['/old.js'] })
  const out = codexConfigWithServer(stale, spec)
  assert.equal(out.match(/\[mcp_servers\.doodle-note\]/g)?.length, 1)
  assert.ok(!out.includes('/old.js'))
})

test('codexConfigWithoutServer removes our table and stops at the next one', () => {
  const config =
    'model = "o3"\n\n[mcp_servers.doodle-note]\ncommand = "x"\nargs = []\n\n[projects."/x"]\ntrust = true\n'
  const out = codexConfigWithoutServer(config)
  assert.ok(!out.includes('doodle-note'))
  assert.ok(out.includes('model = "o3"'))
  assert.ok(out.includes('[projects."/x"]'))
  assert.ok(out.includes('trust = true'))
})

test('codexConfigWithoutServer removes a trailing table cleanly', () => {
  const out = codexConfigWithoutServer(codexConfigWithServer('model = "o3"', spec))
  assert.equal(out.replace(/\n+$/, ''), 'model = "o3"')
})

test('codexConfigWithoutServer is a no-op when absent', () => {
  const config = 'model = "o3"\n'
  assert.equal(codexConfigWithoutServer(config), config)
})

test('codex round-trip from empty', () => {
  const out = codexConfigWithServer(null, spec)
  assert.ok(codexConfigHasServer(out))
  assert.equal(codexConfigWithoutServer(out).trim(), '')
})

const codexSpec: McpServerSpec = {
  command: 'C:\\Programs\\DoodleNote\\DoodleNote.exe',
  args: ['C:\\Programs\\DoodleNote\\resources\\mcp\\cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

/** Every table header in a TOML text, for "defined once" checks. */
const headers = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\[/.test(line))

test('codex: a user-added [mcp_servers.doodle-note.env] subtable is removed with our table', () => {
  const raw = [
    'model = "o3"',
    '',
    '[mcp_servers.doodle-note]',
    'command = "C:\\\\old\\\\DoodleNote.exe"',
    'args = []',
    '',
    '[mcp_servers.doodle-note.env]',
    'FOO = "bar"',
    '',
    '[mcp_servers.other]',
    'command = "npx"',
    ''
  ].join('\n')
  assert.equal(codexConfigServerCommand(raw, 'x'), 'C:\\old\\DoodleNote.exe')
  const next = codexConfigWithServer(raw, codexSpec)
  // Our server is defined once, by our table with its inline env; no clashing subtable.
  assert.deepEqual(headers(next), ['[mcp_servers.other]', '[mcp_servers.doodle-note]'])
  assert.doesNotMatch(next, /FOO = "bar"/)
  assert.match(next, /^model = "o3"\n/)
  assert.match(next, /\[mcp_servers\.other\]\ncommand = "npx"\n/)
  assert.equal(codexConfigServerCommand(next, 'x'), codexSpec.command)
  // Idempotent.
  assert.equal(codexConfigWithServer(next, codexSpec), next)
  // Lines go exactly as the base (macOS) code removed them: the blank lines
  // between our table and the next one go with ours.
  assert.equal(
    codexConfigWithoutServer(next),
    'model = "o3"\n[mcp_servers.other]\ncommand = "npx"\n'
  )
})

test('codex: dotted and inline definitions of our server are found and replaced', () => {
  const dotted = [
    '[mcp_servers]',
    'doodle-note.command = "C:\\\\old\\\\DoodleNote.exe"',
    'doodle-note.args = ["x"]',
    'other.command = "npx"',
    ''
  ].join('\n')
  assert.ok(codexConfigHasServer(dotted))
  assert.equal(codexConfigServerCommand(dotted, 'x'), 'C:\\old\\DoodleNote.exe')
  assert.equal(codexConfigWithoutServer(dotted), '[mcp_servers]\nother.command = "npx"\n')
  const root = 'mcp_servers.doodle-note.command = "C:\\\\old\\\\DoodleNote.exe"\nmodel = "o3"\n'
  assert.equal(codexConfigServerCommand(root, 'x'), 'C:\\old\\DoodleNote.exe')
  assert.equal(codexConfigWithoutServer(root), 'model = "o3"\n')
  const inline = [
    '[mcp_servers]',
    `"doodle-note" = { command = 'C:\\old\\DoodleNote.exe', args = [] }`,
    'other = { command = "npx" }',
    ''
  ].join('\n')
  assert.equal(codexConfigServerCommand(inline, 'x'), 'C:\\old\\DoodleNote.exe')
  const next = codexConfigWithServer(inline, codexSpec)
  assert.doesNotMatch(next, /"doodle-note" =/)
  assert.match(next, /other = \{ command = "npx" \}/)
  assert.equal(codexConfigServerCommand(next, 'x'), codexSpec.command)
  // A quoted table name is the same table.
  const quoted = '[mcp_servers."doodle-note"]\ncommand = "C:\\\\old\\\\DoodleNote.exe"\n'
  assert.equal(codexConfigWithoutServer(quoted), '')
})

test('codex: multi-line values and strings never end or start a table', () => {
  const raw = [
    '[mcp_servers.doodle-note]',
    'command = "x"',
    'args = [',
    '  "a",',
    '  ["b"],',
    ']',
    '[mcp_servers.other]',
    'command = "npx"',
    '[profiles.notes]',
    'text = """',
    '[mcp_servers.doodle-note]',
    'command = "not a table"',
    '"""',
    ''
  ].join('\n')
  const without = codexConfigWithoutServer(raw)
  assert.doesNotMatch(without, /"a",|\["b"\]/)
  assert.match(without, /^\[mcp_servers\.other\]\ncommand = "npx"\n\[profiles\.notes\]/)
  // The string's text is kept as it was.
  assert.match(without, /text = """\n\[mcp_servers\.doodle-note\]\ncommand = "not a table"\n"""\n$/)
  assert.ok(!codexConfigHasServer(without))
  assert.equal(codexConfigServerCommand(without, 'x'), null)
})

test('codex: another server whose name starts with ours, comments and CRLF are left alone', () => {
  const raw =
    '[mcp_servers.doodle-note-qa]\r\ncommand = "qa"\r\n\r\n' +
    '[mcp_servers.doodle-note] # added by DoodleNote\r\ncommand = "C:\\\\old\\\\DoodleNote.exe"\r\n'
  assert.equal(codexConfigServerCommand(raw, 'x'), 'C:\\old\\DoodleNote.exe')
  assert.equal(codexConfigWithoutServer(raw), '[mcp_servers.doodle-note-qa]\r\ncommand = "qa"\r\n')
  assert.ok(!codexConfigHasServer('[mcp_servers.doodle-note-qa]\ncommand = "qa"\n'))
})
