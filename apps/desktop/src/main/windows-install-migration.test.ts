import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AgentAccessService } from './agent-access-service'
import {
  ClientConfigError,
  codexConfigServerCommand,
  codexConfigWithServer,
  jsonConfigServerCommand,
  jsonConfigWithServer
} from './mcp-clients-logic'
import {
  isInsideFolder,
  legacyInstallFor,
  runWindowsInstallMigration,
  type InstallMigrationDeps,
  type LoginItemState,
  type McpRepointOutcome
} from './windows-install-migration'
import type { McpServerSpec } from '../shared/integrations-api'

const programs = 'C:\\Users\\Pat\\AppData\\Local\\Programs'
const newExe = `${programs}\\DoodleNote\\DoodleNote.exe`
const oldExe = `${programs}\\desktop\\DoodleNote.exe`

const spec = (dir: string): McpServerSpec => ({
  command: `${programs}\\${dir}\\DoodleNote.exe`,
  args: [`${programs}\\${dir}\\resources\\mcp\\cli.js`],
  env: { ELECTRON_RUN_AS_NODE: '1' }
})

test('the legacy install is the sibling desktop folder of a DoodleNote folder', () => {
  assert.deepEqual(legacyInstallFor(newExe), { dir: `${programs}\\desktop`, exe: oldExe })
  // Case-insensitive, as Windows paths are.
  assert.deepEqual(legacyInstallFor(`${programs}\\doodlenote\\DoodleNote.exe`)?.exe, oldExe)
  // Still in the old folder (not yet migrated), or a custom /D folder: nothing to do.
  assert.equal(legacyInstallFor(oldExe), null)
  assert.equal(legacyInstallFor('D:\\Apps\\Notes\\DoodleNote.exe'), null)
})

test('folder containment follows Windows rules and does not match siblings', () => {
  assert.ok(isInsideFolder(oldExe, `${programs}\\desktop`))
  assert.ok(isInsideFolder(oldExe.toUpperCase(), `${programs}\\desktop\\`))
  assert.ok(isInsideFolder(`${programs}/desktop/DoodleNote.exe`, `${programs}\\desktop`))
  assert.ok(!isInsideFolder(`${programs}\\desktop-old\\DoodleNote.exe`, `${programs}\\desktop`))
  assert.ok(!isInsideFolder(newExe, `${programs}\\desktop`))
})

function fakeDeps(overrides: Partial<InstallMigrationDeps> = {}): InstallMigrationDeps & {
  marker: string | null
  logs: string[]
  registered: boolean[]
} {
  const deps = {
    platform: 'win32' as NodeJS.Platform,
    isPackaged: true,
    execPath: newExe,
    marker: null as string | null,
    logs: [] as string[],
    registered: [] as boolean[],
    readMarker: () => deps.marker,
    writeMarker: (contents: string) => {
      deps.marker = contents
    },
    loginItem: {
      stateFor: (exe: string): LoginItemState => ({ registered: exe === oldExe, enabled: true }),
      registerCurrent: (enabled: boolean) => {
        deps.registered.push(enabled)
      }
    },
    repointMcpClients: (): McpRepointOutcome[] => [],
    log: (message: string) => {
      deps.logs.push(message)
    },
    ...overrides
  }
  return deps
}

test('the first launch from the new folder moves the login item and MCP clients, once', () => {
  let seen: ((command: string) => boolean) | null = null
  const deps = fakeDeps({
    repointMcpClients: (isLegacy, only) => {
      seen = isLegacy
      assert.equal(only, null)
      return [
        { id: 'claude-desktop', outcome: 'updated' },
        { id: 'codex', outcome: 'unchanged' }
      ]
    }
  })
  assert.deepEqual(runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: true,
    mcpClients: ['claude-desktop'],
    pending: []
  })
  assert.deepEqual(deps.registered, [true])
  assert.ok(seen!(oldExe))
  assert.ok(!seen!(newExe))
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, true)
  // Second launch: the marker short-circuits.
  assert.equal(runWindowsInstallMigration(deps).ran, false)
  assert.deepEqual(deps.registered, [true])
})

test('a login item the user disabled in Task Manager stays disabled', () => {
  const deps = fakeDeps({
    loginItem: {
      stateFor: () => ({ registered: true, enabled: false }),
      registerCurrent: (enabled) => deps.registered.push(enabled)
    }
  })
  runWindowsInstallMigration(deps)
  assert.deepEqual(deps.registered, [false])
})

test('no login item is created when the old install had none', () => {
  const deps = fakeDeps({
    loginItem: {
      stateFor: () => ({ registered: false, enabled: false }),
      registerCurrent: () => assert.fail()
    }
  })
  assert.equal(runWindowsInstallMigration(deps).loginItem, false)
})

test('nothing runs on macOS, in unpackaged runs, or from the old folder', () => {
  for (const overrides of [
    { platform: 'darwin' as NodeJS.Platform },
    { isPackaged: false },
    { execPath: oldExe }
  ]) {
    const deps = fakeDeps({
      ...overrides,
      loginItem: { stateFor: () => assert.fail(), registerCurrent: () => assert.fail() },
      repointMcpClients: () => assert.fail()
    })
    assert.equal(runWindowsInstallMigration(deps).ran, false)
    assert.equal(deps.marker, null)
  }
})

test('a failed step is retried on the next launch and does not block the other step', () => {
  let attempts = 0
  const deps = fakeDeps({
    repointMcpClients: () => {
      attempts++
      if (attempts === 1) throw new Error('EBUSY')
      return []
    }
  })
  const first = runWindowsInstallMigration(deps)
  assert.equal(first.loginItem, true)
  assert.deepEqual(first.pending, ['mcp-clients'])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, false)
  assert.match(deps.logs.join('\n'), /not repointed: EBUSY/)
  // The login item is done and is not redone.
  assert.deepEqual(runWindowsInstallMigration(deps).pending, [])
  assert.equal(attempts, 2)
  assert.deepEqual(deps.registered, [true])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, true)
})

test('a client whose config could not be read is retried on its own until it succeeds', () => {
  const calls: (readonly string[] | null)[] = []
  const outcomes: McpRepointOutcome[][] = [
    [
      { id: 'claude-desktop', outcome: 'updated' },
      { id: 'claude-code', outcome: 'failed', error: 'EBUSY: resource busy or locked' },
      { id: 'codex', outcome: 'unchanged' }
    ],
    [{ id: 'claude-code', outcome: 'failed', error: 'not valid JSON' }],
    [{ id: 'claude-code', outcome: 'updated' }]
  ]
  const deps = fakeDeps({
    repointMcpClients: (_isLegacy, only) => {
      calls.push(only)
      return outcomes[calls.length - 1]
    }
  })
  assert.deepEqual(runWindowsInstallMigration(deps).pending, ['claude-code'])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, false)
  assert.match(deps.logs.join('\n'), /claude-code not repointed: EBUSY/)
  assert.deepEqual(runWindowsInstallMigration(deps).pending, ['claude-code'])
  assert.deepEqual(runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: false,
    mcpClients: ['claude-code'],
    pending: []
  })
  assert.deepEqual(calls, [null, ['claude-code'], ['claude-code']])
  assert.equal(runWindowsInstallMigration(deps).ran, false)
  assert.equal(calls.length, 3)
})

test('a login item that could not be read is retried without redoing the MCP clients', () => {
  let reads = 0
  let repoints = 0
  const deps = fakeDeps({
    loginItem: {
      stateFor: () => {
        reads++
        if (reads === 1) throw new Error('registry unavailable')
        return { registered: true, enabled: true }
      },
      registerCurrent: (enabled) => deps.registered.push(enabled)
    },
    repointMcpClients: () => {
      repoints++
      return []
    }
  })
  assert.deepEqual(runWindowsInstallMigration(deps).pending, ['login-item'])
  assert.deepEqual(runWindowsInstallMigration(deps).pending, [])
  assert.equal(reads, 2)
  assert.equal(repoints, 1)
  assert.deepEqual(deps.registered, [true])
})

test('a marker for another exe, a damaged or unreadable one, or a version 1 one re-runs it', () => {
  const deps = fakeDeps()
  deps.marker = JSON.stringify({ version: 2, to: 'C:\\Elsewhere\\DoodleNote.exe', complete: true })
  assert.equal(runWindowsInstallMigration(deps).ran, true)
  deps.marker = '{oops'
  assert.equal(runWindowsInstallMigration(deps).ran, true)
  // Version 1 could say "done" after a config failed to read.
  deps.marker = JSON.stringify({ version: 1, from: oldExe, to: newExe })
  assert.equal(runWindowsInstallMigration(deps).ran, true)
  const unreadable = fakeDeps({
    readMarker: () => {
      throw new Error('EACCES')
    }
  })
  assert.equal(runWindowsInstallMigration(unreadable).ran, true)
})

test('the MCP server command is read back from both client dialects', () => {
  assert.equal(
    jsonConfigServerCommand(jsonConfigWithServer(null, spec('desktop'), 'x'), 'x'),
    oldExe
  )
  assert.equal(codexConfigServerCommand(codexConfigWithServer(null, spec('desktop')), 'x'), oldExe)
  assert.equal(jsonConfigServerCommand('{"mcpServers":{}}', 'x'), null)
  assert.equal(jsonConfigServerCommand('{"theme":"dark"}', 'x'), null)
  assert.equal(codexConfigServerCommand('[mcp_servers.other]\ncommand = "x"\n', 'x'), null)
  // Unreadable is not "absent": the caller retries instead of finishing.
  assert.throws(() => jsonConfigServerCommand('not json', 'x'), ClientConfigError)
  assert.throws(() => jsonConfigServerCommand('[]', 'x'), ClientConfigError)
  assert.throws(
    () => jsonConfigServerCommand('{"mcpServers":{"doodle-note":{"args":[]}}}', 'x'),
    ClientConfigError
  )
  assert.throws(
    () => codexConfigServerCommand('[mcp_servers.doodle-note]\ncommand = "unterminated\n', 'x'),
    ClientConfigError
  )
})

test('AgentAccessService repoints only stale DoodleNote entries and keeps the rest', () => {
  const home = mkdtempSync(join(tmpdir(), 'dn-install-migration-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = join(home, 'AppData', 'Roaming')
  try {
    const claudeDir =
      process.platform === 'win32'
        ? join(home, 'AppData', 'Roaming', 'Claude')
        : join(home, 'Library', 'Application Support', 'Claude')
    mkdirSync(claudeDir, { recursive: true })
    mkdirSync(join(home, '.codex'), { recursive: true })
    const claudeDesktop = join(claudeDir, 'claude_desktop_config.json')
    const claudeCode = join(home, '.claude.json')
    const codex = join(home, '.codex', 'config.toml')
    const other = { command: 'npx', args: ['other-server'] }
    writeFileSync(
      claudeDesktop,
      JSON.stringify({ theme: 'dark', mcpServers: { other, 'doodle-note': spec('desktop') } })
    )
    // Already current: must not be rewritten.
    const current = JSON.stringify({ mcpServers: { 'doodle-note': spec('DoodleNote') } })
    writeFileSync(claudeCode, current)
    writeFileSync(codex, `model = "x"\n\n${codexConfigWithServer(null, spec('desktop'))}`)

    const service = new AgentAccessService(() => join(home, 'meetings'), spec('DoodleNote'), home)
    const results = service.repointStaleClients((command) =>
      isInsideFolder(command, `${programs}\\desktop`)
    )
    assert.deepEqual(results, [
      { id: 'claude-desktop', outcome: 'updated' },
      { id: 'claude-code', outcome: 'unchanged' },
      { id: 'codex', outcome: 'updated' }
    ])
    const desktopConfig = JSON.parse(readFileSync(claudeDesktop, 'utf8'))
    assert.equal(desktopConfig.theme, 'dark')
    assert.deepEqual(desktopConfig.mcpServers.other, other)
    assert.equal(desktopConfig.mcpServers['doodle-note'].command, newExe)
    assert.equal(desktopConfig.mcpServers['doodle-note'].args[0], spec('DoodleNote').args[0])
    assert.equal(readFileSync(claudeCode, 'utf8'), current)
    const codexText = readFileSync(codex, 'utf8')
    assert.match(codexText, /^model = "x"/)
    assert.equal(codexConfigServerCommand(codexText, codex), newExe)
    // Idempotent.
    assert.ok(
      service
        .repointStaleClients((command) => isInsideFolder(command, `${programs}\\desktop`))
        .every((result) => result.outcome === 'unchanged')
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    rmSync(home, { recursive: true, force: true })
  }
})

test('AgentAccessService reports unreadable or malformed client configs as failed, untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'dn-install-migration-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = join(home, 'AppData', 'Roaming')
  try {
    const claudeDir =
      process.platform === 'win32'
        ? join(home, 'AppData', 'Roaming', 'Claude')
        : join(home, 'Library', 'Application Support', 'Claude')
    // A folder where the file should be: the read fails (EISDIR), it is not absent.
    mkdirSync(join(claudeDir, 'claude_desktop_config.json'), { recursive: true })
    const claudeCode = join(home, '.claude.json')
    writeFileSync(claudeCode, '{ "mcpServers": { "doodle-note": ')
    mkdirSync(join(home, '.codex'), { recursive: true })
    const codex = join(home, '.codex', 'config.toml')
    const brokenCodex = '[mcp_servers.doodle-note]\ncommand = "C:\\unterminated\n'
    writeFileSync(codex, brokenCodex)

    const service = new AgentAccessService(() => join(home, 'meetings'), spec('DoodleNote'), home)
    const results = service.repointStaleClients(() => true)
    assert.deepEqual(
      results.map((result) => [result.id, result.outcome]),
      [
        ['claude-desktop', 'failed'],
        ['claude-code', 'failed'],
        ['codex', 'failed']
      ]
    )
    assert.ok(results.every((result) => typeof result.error === 'string' && result.error))
    assert.equal(readFileSync(claudeCode, 'utf8'), '{ "mcpServers": { "doodle-note": ')
    assert.equal(readFileSync(codex, 'utf8'), brokenCodex)
    // `only` limits the pass to what is still pending.
    assert.deepEqual(
      service.repointStaleClients(() => true, ['codex']).map((result) => result.id),
      ['codex']
    )
    // No file at all is nothing to do, not a failure.
    rmSync(join(home, '.codex'), { recursive: true, force: true })
    assert.deepEqual(
      service.repointStaleClients(() => true, ['codex']),
      [{ id: 'codex', outcome: 'unchanged' }]
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    rmSync(home, { recursive: true, force: true })
  }
})
