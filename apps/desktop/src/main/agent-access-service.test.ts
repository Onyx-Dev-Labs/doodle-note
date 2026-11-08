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
import {
  AgentAccessService,
  agentAccessRoots,
  clientDefs,
  replaceConfigFile,
  sameConfigContent
} from './agent-access-service'
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

test('production roots are the real ones; a sandbox holds every client root and the opt-in file', () => {
  const env = {
    APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
    DOODLE_NOTE_MCP_CONFIG: 'C:\\elsewhere\\mcp.json'
  }
  const home = 'C:\\Users\\u'
  const sandboxHome = join('C:\\Users\\u\\AppData\\Roaming\\desktop-qa', 'agent-access-home')
  for (const platform of ['win32', 'darwin'] as const) {
    const production = agentAccessRoots({ platform, env, home })
    assert.equal(production.sandboxIdentity, null)
    assert.equal(production.mcpConfigPath, env.DOODLE_NOTE_MCP_CONFIG)
    assert.equal(
      production.appData,
      platform === 'win32' ? env.APPDATA : join(home, 'Library', 'Application Support')
    )
    assert.deepEqual(
      clientDefs(production).map((def) => def.configPath),
      [
        join(production.appData, 'Claude', 'claude_desktop_config.json'),
        join(home, '.claude.json'),
        join(home, '.codex', 'config.toml')
      ]
    )

    const qa = agentAccessRoots({
      platform,
      env,
      home,
      sandbox: { home: sandboxHome, identity: 'qa' }
    })
    assert.equal(qa.sandboxIdentity, 'qa')
    // Neither %APPDATA% nor an inherited DOODLE_NOTE_MCP_CONFIG escapes the sandbox.
    assert.equal(qa.mcpConfigPath, join(sandboxHome, '.doodlenote', 'mcp.json'))
    const paths = [
      qa.home,
      qa.appData,
      qa.mcpConfigPath,
      ...clientDefs(qa).flatMap((def) => [def.configPath, ...def.detectPaths])
    ]
    assert.equal(paths.length, 10)
    for (const path of paths) {
      assert.ok(path.startsWith(sandboxHome), `${path} is outside the sandbox`)
    }
  }
})

test('a sandbox writes its identity into the opt-in file and binds the server spec to it', () => {
  withHome((root) => {
    const sandboxHome = join(root, 'agent-access-home')
    const service = new AgentAccessService(
      () => join(root, 'meetings'),
      spec,
      agentAccessRoots({
        platform: process.platform,
        env: { DOODLE_NOTE_MCP_CONFIG: join(root, 'prod-mcp.json') },
        home: root,
        sandbox: { home: sandboxHome, identity: 'qa' }
      })
    )
    const optIn = join(sandboxHome, '.doodlenote', 'mcp.json')
    const status = service.setEnabled(true)
    assert.equal(status.configPath, optIn)
    assert.deepEqual(JSON.parse(readFileSync(optIn, 'utf8')), {
      enabled: true,
      meetingsDir: join(root, 'meetings'),
      identity: 'qa'
    })
    assert.deepEqual(status.server.env, {
      ELECTRON_RUN_AS_NODE: '1',
      DOODLE_NOTE_MCP_CONFIG: optIn,
      DOODLE_NOTE_MCP_IDENTITY: 'qa'
    })
    // What Connect writes into a client is that same spec.
    service.setClientConnected('claude-code', true)
    const written = JSON.parse(readFileSync(join(sandboxHome, '.claude.json'), 'utf8'))
    assert.deepEqual(written.mcpServers['doodle-note'].env, status.server.env)
    assert.ok(!readdirSync(root).includes('prod-mcp.json'))
  })
})

test('a production spec carries no sandbox binding', () => {
  withHome((home) => {
    const service = new AgentAccessService(
      () => join(home, 'meetings'),
      spec,
      agentAccessRoots({ platform: process.platform, env: {}, home })
    )
    assert.deepEqual(service.status().server, spec)
    service.setEnabled(true)
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.doodlenote', 'mcp.json'), 'utf8')), {
      enabled: true,
      meetingsDir: join(home, 'meetings')
    })
  })
})

test('repointing: an entry without a command, an empty file and a BOM are not failures', () => {
  withHome((home) => {
    const claudeCode = join(home, '.claude.json')
    const http = JSON.stringify({
      mcpServers: { 'doodle-note': { url: 'http://127.0.0.1:1/mcp' } }
    })
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
