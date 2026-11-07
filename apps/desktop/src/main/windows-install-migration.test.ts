import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AgentAccessService } from './agent-access-service'
import {
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
  type LoginItemState
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
    repointMcpClients: () => [] as string[],
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
    repointMcpClients: (isLegacy) => {
      seen = isLegacy
      return ['claude-desktop']
    }
  })
  assert.deepEqual(runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: true,
    mcpClients: ['claude-desktop']
  })
  assert.deepEqual(deps.registered, [true])
  assert.ok(seen!(oldExe))
  assert.ok(!seen!(newExe))
  assert.match(deps.marker ?? '', /"to":/)
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
  assert.equal(runWindowsInstallMigration(deps).loginItem, true)
  assert.equal(deps.marker, null)
  assert.match(deps.logs.join('\n'), /not repointed: EBUSY/)
  runWindowsInstallMigration(deps)
  assert.equal(attempts, 2)
  assert.notEqual(deps.marker, null)
})

test('a marker for another exe (moved again) or a damaged marker re-runs the migration', () => {
  const deps = fakeDeps()
  deps.marker = JSON.stringify({ version: 1, to: 'C:\\Elsewhere\\DoodleNote.exe' })
  assert.equal(runWindowsInstallMigration(deps).ran, true)
  deps.marker = '{oops'
  assert.equal(runWindowsInstallMigration(deps).ran, true)
})

test('the MCP server command is read back from both client dialects', () => {
  assert.equal(jsonConfigServerCommand(jsonConfigWithServer(null, spec('desktop'), 'x')), oldExe)
  assert.equal(codexConfigServerCommand(codexConfigWithServer(null, spec('desktop'))), oldExe)
  assert.equal(jsonConfigServerCommand('{"mcpServers":{}}'), null)
  assert.equal(jsonConfigServerCommand('not json'), null)
  assert.equal(codexConfigServerCommand('[mcp_servers.other]\ncommand = "x"\n'), null)
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
    const updated = service.repointStaleClients((command) =>
      isInsideFolder(command, `${programs}\\desktop`)
    )
    assert.deepEqual(updated.sort(), ['claude-desktop', 'codex'])
    const desktopConfig = JSON.parse(readFileSync(claudeDesktop, 'utf8'))
    assert.equal(desktopConfig.theme, 'dark')
    assert.deepEqual(desktopConfig.mcpServers.other, other)
    assert.equal(desktopConfig.mcpServers['doodle-note'].command, newExe)
    assert.equal(desktopConfig.mcpServers['doodle-note'].args[0], spec('DoodleNote').args[0])
    assert.equal(readFileSync(claudeCode, 'utf8'), current)
    const codexText = readFileSync(codex, 'utf8')
    assert.match(codexText, /^model = "x"/)
    assert.equal(codexConfigServerCommand(codexText), newExe)
    // Idempotent.
    assert.deepEqual(
      service.repointStaleClients((command) => isInsideFolder(command, `${programs}\\desktop`)),
      []
    )
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = previousAppData
    rmSync(home, { recursive: true, force: true })
  }
})
