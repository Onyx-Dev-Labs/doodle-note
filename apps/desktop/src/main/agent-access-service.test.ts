import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AgentAccessService, replaceConfigFile, sameConfigContent } from './agent-access-service'
import type { McpServerSpec } from '../shared/integrations-api'

const spec: McpServerSpec = {
  command: 'C:\\Programs\\DoodleNote\\DoodleNote.exe',
  args: ['C:\\Programs\\DoodleNote\\resources\\mcp\\cli.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

function withHome(run: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), 'dn-agent-access-'))
  try {
    run(home)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('a config is replaced through a temporary file beside it, keeping its mode', () => {
  withHome((home) => {
    const file = join(home, '.claude.json')
    writeFileSync(file, '{"a":1}\n')
    if (process.platform !== 'win32') chmodSync(file, 0o640)
    assert.equal(replaceConfigFile(file, '{"a":1}\n', '{"a":2}\n'), true)
    assert.equal(readFileSync(file, 'utf8'), '{"a":2}\n')
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o640)
    // No temporary file is left behind.
    assert.deepEqual(readdirSync(home), ['.claude.json'])
  })
})

test('a config the client rewrote meanwhile is not overwritten', () => {
  withHome((home) => {
    const file = join(home, '.claude.json')
    // What we read was {"a":1}; the client has since written {"a":1,"b":2}.
    writeFileSync(file, '{"a":1,"b":2}\n')
    assert.equal(replaceConfigFile(file, '{"a":1}\n', '{"a":1,"mcpServers":{}}\n'), false)
    assert.equal(readFileSync(file, 'utf8'), '{"a":1,"b":2}\n')
    assert.deepEqual(readdirSync(home), ['.claude.json'])
    // A file that appeared after we saw none is not replaced either.
    assert.equal(replaceConfigFile(file, null, '{}\n'), false)
    assert.equal(readFileSync(file, 'utf8'), '{"a":1,"b":2}\n')
  })
})

test('a symlinked config keeps its link; the target is replaced', (t) => {
  withHome((home) => {
    const real = join(home, 'dotfiles', 'claude.json')
    mkdirSync(join(home, 'dotfiles'))
    writeFileSync(real, '{}\n')
    const link = join(home, '.claude.json')
    try {
      symlinkSync(real, link)
    } catch {
      t.skip('symbolic links need a privilege this account does not have')
      return
    }
    assert.equal(replaceConfigFile(link, '{}\n', '{"x":1}\n'), true)
    assert.equal(readFileSync(real, 'utf8'), '{"x":1}\n')
    assert.ok(statSync(link).isFile())
    assert.equal(readFileSync(link, 'utf8'), '{"x":1}\n')
  })
})

test('content is compared parsed for JSON, as text for TOML', () => {
  assert.ok(sameConfigContent('{"a":1,"b":[1,2]}', '{\n  "a": 1,\n  "b": [1, 2]\n}\n', 'json'))
  assert.ok(!sameConfigContent('{"a":1}', '{"a":2}', 'json'))
  assert.ok(!sameConfigContent('not json', 'not json', 'json'))
  assert.ok(sameConfigContent('a = 1\r\n', 'a = 1\n\n', 'toml'))
  assert.ok(!sameConfigContent('a = 1', 'a = 2', 'toml'))
})

test('connecting a client whose entry is already current does not rewrite the file', () => {
  withHome((home) => {
    const file = join(home, '.claude.json')
    // Same content as we would write, formatted differently (as Claude Code writes it).
    const raw = JSON.stringify({ projects: {}, mcpServers: { 'doodle-note': spec } })
    writeFileSync(file, raw)
    const before = statSync(file).mtimeMs
    const service = new AgentAccessService(() => join(home, 'meetings'), spec, home)
    service.setClientConnected('claude-code', true)
    assert.equal(readFileSync(file, 'utf8'), raw)
    assert.equal(statSync(file).mtimeMs, before)
    assert.deepEqual(
      service.repointStaleClients(() => true, ['claude-code']),
      [{ id: 'claude-code', outcome: 'unchanged' }]
    )
    assert.equal(readFileSync(file, 'utf8'), raw)
  })
})

test('connecting keeps everything else the client wrote and leaves no temporary file', () => {
  withHome((home) => {
    const file = join(home, '.claude.json')
    writeFileSync(file, JSON.stringify({ numStartups: 7, mcpServers: { other: { command: 'x' } } }))
    const service = new AgentAccessService(() => join(home, 'meetings'), spec, home)
    service.setClientConnected('claude-code', true)
    const config = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(config.numStartups, 7)
    assert.deepEqual(config.mcpServers.other, { command: 'x' })
    assert.equal(config.mcpServers['doodle-note'].command, spec.command)
    assert.deepEqual(
      readdirSync(home).filter((name) => name.endsWith('.tmp')),
      []
    )
  })
})

test('a config that exists but cannot be read is never replaced blind', () => {
  withHome((home) => {
    // A folder where the file should be: reading fails, it is not "absent".
    mkdirSync(join(home, '.claude.json'))
    const service = new AgentAccessService(() => join(home, 'meetings'), spec, home)
    assert.throws(() => service.setClientConnected('claude-code', true))
    assert.ok(statSync(join(home, '.claude.json')).isDirectory())
  })
})

test('repointing: an entry without a command, an empty file and a BOM are not failures', () => {
  withHome((home) => {
    const claudeCode = join(home, '.claude.json')
    const http = JSON.stringify({ mcpServers: { 'doodle-note': { url: 'http://127.0.0.1:1/mcp' } } })
    writeFileSync(claudeCode, http)
    mkdirSync(join(home, '.codex'))
    const codex = join(home, '.codex', 'config.toml')
    writeFileSync(codex, '')
    const service = new AgentAccessService(() => join(home, 'meetings'), spec, home)
    assert.deepEqual(
      service.repointStaleClients(() => true),
      [
        { id: 'claude-desktop', outcome: 'unchanged' },
        { id: 'claude-code', outcome: 'unchanged' },
        { id: 'codex', outcome: 'unchanged' }
      ]
    )
    assert.equal(readFileSync(claudeCode, 'utf8'), http)
    assert.equal(readFileSync(codex, 'utf8'), '')

    // A BOM is stripped for parsing and kept on write.
    const stale = { ...spec, command: 'C:\\Programs\\desktop\\DoodleNote.exe' }
    writeFileSync(claudeCode, '\uFEFF' + JSON.stringify({ mcpServers: { 'doodle-note': stale } }))
    assert.equal(service.status().clients.find((c) => c.id === 'claude-code')?.connected, true)
    assert.deepEqual(
      service.repointStaleClients(() => true, ['claude-code']),
      [{ id: 'claude-code', outcome: 'updated' }]
    )
    const text = readFileSync(claudeCode, 'utf8')
    assert.ok(text.startsWith('\uFEFF'))
    assert.equal(JSON.parse(text.slice(1)).mcpServers['doodle-note'].command, spec.command)

    // Connecting into an empty file writes a fresh config.
    service.setClientConnected('codex', true)
    assert.match(readFileSync(codex, 'utf8'), /^\[mcp_servers\.doodle-note\]/)
  })
})
