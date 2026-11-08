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
import {
  electronBuilderGuid,
  installStateKey,
  parseInstallRecord,
  type InstallMigrationRecord
} from './windows-install-record'
import { APP_IDENTITY, appIdentity } from './app-identity'
import { createRequire } from 'node:module'
import type { McpServerSpec } from '../shared/integrations-api'

const programs = 'C:\\Users\\Pat\\AppData\\Local\\Programs'
const newExe = `${programs}\\DoodleNote\\DoodleNote.exe`
const oldExe = `${programs}\\desktop\\DoodleNote.exe`

const spec = (dir: string): McpServerSpec => ({
  command: `${programs}\\${dir}\\DoodleNote.exe`,
  args: [`${programs}\\${dir}\\resources\\mcp\\cli.js`],
  env: { ELECTRON_RUN_AS_NODE: '1' }
})

const record: InstallMigrationRecord = {
  from: `${programs}\\desktop`,
  to: `${programs}\\DoodleNote`,
  at: '2026-11-08T01:02:03Z'
}

test('the old install comes only from an installer record naming this exe folder', () => {
  assert.deepEqual(legacyInstallFor(record, newExe), { dir: `${programs}\\desktop`, exe: oldExe })
  // Case and trailing separators do not matter, as on Windows.
  assert.deepEqual(
    legacyInstallFor({ ...record, to: `${programs.toUpperCase()}\\DOODLENOTE\\` }, newExe),
    { dir: `${programs}\\desktop`, exe: oldExe }
  )
  // A record for another folder (another copy, another user profile) does not apply.
  assert.match(
    (legacyInstallFor(record, 'D:\\Captures\\DoodleNote\\DoodleNote.exe') as { reason: string })
      .reason,
    /is for /
  )
  // Not the identity's sibling folders.
  assert.ok('reason' in legacyInstallFor({ ...record, from: 'C:\\Elsewhere\\desktop' }, newExe))
  assert.ok('reason' in legacyInstallFor({ ...record, from: `${programs}\\other` }, newExe))
  const qa = appIdentity('qa')
  assert.ok('reason' in legacyInstallFor(record, newExe, qa))
})

test('APP_GUID and the record key match what electron-builder derives from the appId', () => {
  const require = createRequire(import.meta.url)
  const runtime = createRequire(require.resolve('electron-updater'))('builder-util-runtime') as {
    UUID: { v5(name: string, namespace: Buffer): string; parse(input: string): Buffer }
  }
  const ns = runtime.UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')
  for (const name of ['production', 'qa'] as const) {
    const appId = appIdentity(name).appId
    assert.equal(electronBuilderGuid(appId), runtime.UUID.v5(appId, ns))
  }
  // The values the packaged installers were built with (evidence/step5-fix/qa-nsis-defines.log).
  assert.equal(
    electronBuilderGuid('com.doodlenote.desktop'),
    'f85f8dcf-6782-5a3e-a989-3eae169d6efb'
  )
  assert.equal(
    electronBuilderGuid('com.doodlenote.desktop.qa'),
    '320d0756-c91c-52c4-9287-55a7f514978d'
  )
  assert.equal(
    installStateKey(APP_IDENTITY.appId),
    'HKEY_CURRENT_USER\\Software\\f85f8dcf-6782-5a3e-a989-3eae169d6efb'
  )
})

test('the install record is complete or nothing', () => {
  assert.deepEqual(parseInstallRecord(JSON.stringify(record)), record)
  assert.equal(parseInstallRecord(JSON.stringify({ ...record, at: '' })), null)
  assert.equal(parseInstallRecord(JSON.stringify({ from: record.from, to: record.to })), null)
  assert.equal(parseInstallRecord('not json'), null)
  assert.equal(parseInstallRecord('null'), null)
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
  record: InstallMigrationRecord | null
  files: Set<string>
  logs: string[]
  registered: boolean[]
} {
  const deps = {
    platform: 'win32' as NodeJS.Platform,
    isPackaged: true,
    execPath: newExe,
    marker: null as string | null,
    record: { ...record } as InstallMigrationRecord | null,
    files: new Set<string>([newExe]),
    logs: [] as string[],
    registered: [] as boolean[],
    readRecord: async () => deps.record,
    clearRecord: async () => {
      deps.record = null
    },
    exists: (path: string) => deps.files.has(path),
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

test('the first launch from the new folder moves the login item and MCP clients, once', async () => {
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
  assert.deepEqual(await runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: true,
    mcpClients: ['claude-desktop'],
    pending: []
  })
  assert.deepEqual(deps.registered, [true])
  assert.ok(seen!(oldExe))
  assert.ok(!seen!(newExe))
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, true)
  assert.equal(JSON.parse(deps.marker ?? '{}').migratedAt, record.at)
  // Done: the installer's record is removed, and the next launch does nothing.
  assert.equal(deps.record, null)
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.deepEqual(deps.registered, [true])
})

const untouchable = {
  loginItem: { stateFor: () => assert.fail(), registerCurrent: () => assert.fail() },
  repointMcpClients: () => assert.fail()
}

test('without an installer record nothing is repointed, whatever the folder is called', async () => {
  // e.g. a copy of the real exe started from a folder named DoodleNote for a DPI capture.
  const deps = fakeDeps(untouchable)
  deps.record = null
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.equal(deps.marker, null)
})

test('a record that names another folder changes nothing', async () => {
  for (const execPath of [
    'D:\\Captures\\DoodleNote\\DoodleNote.exe',
    'C:\\Users\\Pat\\Desktop\\DoodleNote\\DoodleNote.exe'
  ]) {
    const deps = fakeDeps({ ...untouchable, execPath })
    deps.files.add(execPath)
    assert.equal((await runWindowsInstallMigration(deps)).ran, false)
    assert.equal(deps.marker, null)
    assert.notEqual(deps.record, null)
    assert.match(deps.logs.join('\n'), /ignoring the install record: it is for /)
  }
})

test('a record whose old exe still exists changes nothing', async () => {
  const deps = fakeDeps(untouchable)
  deps.files.add(oldExe)
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.equal(deps.marker, null)
  assert.notEqual(deps.record, null)
  assert.match(deps.logs.join('\n'), /still exists; nothing repointed/)
})

test('an unreadable record changes nothing', async () => {
  const deps = fakeDeps({
    ...untouchable,
    readRecord: async () => {
      throw new Error('reg.exe blocked')
    }
  })
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.match(deps.logs.join('\n'), /install record not read: reg.exe blocked/)
})

test('a record that cannot be cleared is cleared on a later launch without redoing the work', async () => {
  let clears = 0
  let repoints = 0
  const deps = fakeDeps({
    clearRecord: async () => {
      clears++
      if (clears === 1) throw new Error('access denied')
      deps.record = null
    },
    repointMcpClients: () => {
      repoints++
      return []
    }
  })
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, [])
  assert.match(deps.logs.join('\n'), /install record not cleared: access denied/)
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.equal(deps.record, null)
  assert.equal(repoints, 1)
  assert.deepEqual(deps.registered, [true])
})

test('a later move (a new record) is new work even after a completed one', async () => {
  const deps = fakeDeps()
  await runWindowsInstallMigration(deps)
  deps.record = { ...record, at: '2027-01-01T00:00:00Z' }
  assert.equal((await runWindowsInstallMigration(deps)).ran, true)
  assert.deepEqual(deps.registered, [true, true])
})

test('a login item the user disabled in Task Manager stays disabled', async () => {
  const deps = fakeDeps({
    loginItem: {
      stateFor: () => ({ registered: true, enabled: false }),
      registerCurrent: (enabled) => deps.registered.push(enabled)
    }
  })
  await runWindowsInstallMigration(deps)
  assert.deepEqual(deps.registered, [false])
})

test('no login item is created when the old install had none', async () => {
  const deps = fakeDeps({
    loginItem: {
      stateFor: () => ({ registered: false, enabled: false }),
      registerCurrent: () => assert.fail()
    }
  })
  assert.equal((await runWindowsInstallMigration(deps)).loginItem, false)
})

test('nothing runs on macOS, in unpackaged runs, or from the old folder', async () => {
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
    assert.equal((await runWindowsInstallMigration(deps)).ran, false)
    assert.equal(deps.marker, null)
  }
})

test('a failed step is retried on the next launch and does not block the other step', async () => {
  let attempts = 0
  const deps = fakeDeps({
    repointMcpClients: () => {
      attempts++
      if (attempts === 1) throw new Error('EBUSY')
      return []
    }
  })
  const first = await runWindowsInstallMigration(deps)
  assert.equal(first.loginItem, true)
  assert.deepEqual(first.pending, ['mcp-clients'])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, false)
  assert.match(deps.logs.join('\n'), /not repointed: EBUSY/)
  // The login item is done and is not redone.
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, [])
  assert.equal(attempts, 2)
  assert.deepEqual(deps.registered, [true])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, true)
})

test('a client whose config could not be read is retried on its own until it succeeds', async () => {
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
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, ['claude-code'])
  assert.equal(JSON.parse(deps.marker ?? '{}').complete, false)
  assert.match(deps.logs.join('\n'), /claude-code not repointed: EBUSY/)
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, ['claude-code'])
  assert.deepEqual(await runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: false,
    mcpClients: ['claude-code'],
    pending: []
  })
  assert.deepEqual(calls, [null, ['claude-code'], ['claude-code']])
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.equal(calls.length, 3)
})

test('a login item that could not be read is retried without redoing the MCP clients', async () => {
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
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, ['login-item'])
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, [])
  assert.equal(reads, 2)
  assert.equal(repoints, 1)
  assert.deepEqual(deps.registered, [true])
})

test('a marker for another exe or move, a damaged or unreadable one, or a version 1 one re-runs it', async () => {
  const deps = fakeDeps()
  const done = { version: 2, from: oldExe, to: newExe, loginItemDone: true, mcpPending: [] }
  for (const marker of [
    JSON.stringify({
      ...done,
      to: 'C:\\Elsewhere\\DoodleNote.exe',
      migratedAt: record.at,
      complete: true
    }),
    // Progress of an earlier move does not cover this one.
    JSON.stringify({ ...done, migratedAt: '2025-01-01T00:00:00Z', complete: true }),
    '{oops',
    // Version 1 could say "done" after a config failed to read.
    JSON.stringify({ version: 1, from: oldExe, to: newExe })
  ]) {
    deps.marker = marker
    deps.record = { ...record }
    assert.equal((await runWindowsInstallMigration(deps)).ran, true, marker)
  }
  // The marker of this very move short-circuits (and clears the leftover record).
  deps.record = { ...record }
  assert.equal((await runWindowsInstallMigration(deps)).ran, false)
  assert.equal(deps.record, null)
  const unreadable = fakeDeps({
    readMarker: () => {
      throw new Error('EACCES')
    }
  })
  assert.equal((await runWindowsInstallMigration(unreadable)).ran, true)
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
  // Our key without a command (an HTTP-transport entry): nothing to repoint.
  assert.equal(jsonConfigServerCommand('{"mcpServers":{"doodle-note":{"args":[]}}}', 'x'), null)
  assert.equal(
    jsonConfigServerCommand('{"mcpServers":{"doodle-note":{"url":"http://127.0.0.1:1/mcp"}}}', 'x'),
    null
  )
  assert.equal(
    codexConfigServerCommand('[mcp_servers.doodle-note]\nurl = "http://127.0.0.1:1/mcp"\n', 'x'),
    null
  )
  assert.equal(jsonConfigServerCommand('\uFEFF{"mcpServers":{}}', 'x'), null)
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
