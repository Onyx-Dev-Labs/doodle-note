import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ClientConfigError,
  codexConfigHasServer,
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
