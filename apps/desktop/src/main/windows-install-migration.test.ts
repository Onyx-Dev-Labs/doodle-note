import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AgentAccessService, agentAccessRoots } from './agent-access-service'
import {
  ClientConfigError,
  codexConfigServerCommand,
  codexConfigWithServer,
  jsonConfigServerCommand,
  jsonConfigWithServer
} from './mcp-clients-logic'
import {
  isInsideFolder,
  PathResolutionError,
  legacyInstallFor,
  loginItemStateFromRun,
  LoginItemStateUnknown,
  startupApprovedEnabled,
  longPath,
  samePath,
  readFailureReason,
  runWindowsInstallMigration,
  runWithRetries,
  statusTime,
  type InstallMigrationDeps,
  type InstallMigrationResult,
  type LoginItemState,
  type McpRepointOutcome
} from './windows-install-migration'
import {
  electronBuilderGuid,
  clearInstallRecord,
  installMigrationIdentity,
  installStateKey,
  installStatusKey,
  parseInstallRecordValue,
  readInstallRecord,
  recordShortNameValid,
  recordTimeValid,
  RECORD_TIME_SHAPE,
  writeInstallMigrationStatus,
  type InstallMigrationRecord,
  type InstallRecordPending,
  type WindowsRegistry
} from './windows-install-record'
import { APP_IDENTITY, appIdentity } from './app-identity'
import { createRequire } from 'node:module'
import type { McpServerSpec } from '../shared/integrations-api'
import {
  installMigrationNotice,
  type InstallMigrationStatus
} from '../shared/install-migration-api'

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
  at: '2026-11-08T01:02:03Z',
  fromShortName: null
}

test('the old install comes only from an installer record naming this exe folder', () => {
  assert.deepEqual(legacyInstallFor(record, newExe), {
    dir: `${programs}\\desktop`,
    exe: oldExe,
    shortName: null
  })
  // Case and trailing separators do not matter, as on Windows.
  assert.deepEqual(
    legacyInstallFor({ ...record, to: `${programs.toUpperCase()}\\DOODLENOTE\\` }, newExe),
    { dir: `${programs}\\desktop`, exe: oldExe, shortName: null }
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

test('8.3 short names are expanded on both sides before paths are compared', () => {
  // A mocked GetFinalPathNameByHandle: what exists on this "disk", short names
  // included, and the long form Windows reports for it.
  const disk = new Map<string, string>()
  for (const [short, long] of [
    ['C:\\', 'C:\\'],
    ['C:\\Users', 'C:\\Users'],
    ['C:\\Users\\PATRIC~1', 'C:\\Users\\Patricia Long'],
    ['C:\\Users\\Patricia Long', 'C:\\Users\\Patricia Long']
  ])
    disk.set(short.toLowerCase(), long)
  const sub = ['AppData', 'Local', 'Programs']
  for (const user of ['PATRIC~1', 'Patricia Long'])
    for (let n = 1; n <= sub.length; n++)
      disk.set(
        `C:\\Users\\${user}\\${sub.slice(0, n).join('\\')}`.toLowerCase(),
        `C:\\Users\\Patricia Long\\${sub.slice(0, n).join('\\')}`
      )
  const longPrograms = 'C:\\Users\\Patricia Long\\AppData\\Local\\Programs'
  for (const [short, long] of [
    ['DOODLE~1', 'DoodleNote'],
    ['DoodleNote', 'DoodleNote'],
    ['DOODLE~1\\DOODLE~1.EXE', 'DoodleNote\\DoodleNote.exe'],
    ['DoodleNote\\DoodleNote.exe', 'DoodleNote\\DoodleNote.exe']
  ])
    for (const user of ['PATRIC~1', 'Patricia Long'])
      disk.set(
        `C:\\Users\\${user}\\AppData\\Local\\Programs\\${short}`.toLowerCase(),
        `${longPrograms}\\${long}`
      )
  const realPath = (path: string): string => {
    const found = disk.get(path.toLowerCase())
    if (found === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' })
    return found
  }
  const shortPrograms = 'C:\\Users\\PATRIC~1\\AppData\\Local\\Programs'
  const longRecord: InstallMigrationRecord = {
    from: `${longPrograms}\\desktop`,
    to: `${longPrograms}\\DoodleNote`,
    at: '2026-11-08T01:02:03Z',
    fromShortName: null
  }
  const expected = {
    dir: `${longPrograms}\\desktop`,
    exe: `${longPrograms}\\desktop\\DoodleNote.exe`,
    shortName: null
  }
  const production = appIdentity('production')

  // The old folder is gone: only its existing parent is expanded.
  assert.equal(
    longPath(`${shortPrograms}\\desktop\\DoodleNote.exe`, realPath),
    `${longPrograms}\\desktop\\DoodleNote.exe`
  )
  assert.equal(longPath('C:\\', realPath), 'C:\\')
  assert.ok(samePath(`${shortPrograms}\\DOODLE~1\\`, `${longPrograms}\\DoodleNote`, realPath))
  assert.ok(!samePath(`${shortPrograms}\\DOODLE~1`, `${longPrograms}\\desktop`, realPath))

  // An exe started through a fully short path matches a record written long...
  for (const exe of [
    `${shortPrograms}\\DOODLE~1\\DOODLE~1.EXE`,
    `${shortPrograms}\\DoodleNote\\DoodleNote.exe`,
    `${longPrograms}\\DOODLE~1\\DoodleNote.exe`
  ])
    assert.deepEqual(legacyInstallFor(longRecord, exe, production, realPath), expected, exe)
  // ...and a record written short matches the exe started long.
  assert.deepEqual(
    legacyInstallFor(
      { ...longRecord, from: `${shortPrograms}\\desktop`, to: `${shortPrograms}\\DOODLE~1` },
      `${longPrograms}\\DoodleNote\\DoodleNote.exe`,
      production,
      realPath
    ),
    expected
  )
  // Before the fix this compared the short form as written: the record was ignored for good.
  assert.ok(
    'reason' in
      legacyInstallFor(longRecord, `${shortPrograms}\\DOODLE~1\\DOODLE~1.EXE`, production, () => {
        throw Object.assign(new Error('no expansion'), { code: 'ENOENT' })
      })
  )
  // Expansion never makes another folder match.
  assert.ok(
    'reason' in
      legacyInstallFor(
        { ...longRecord, to: `${longPrograms}\\DoodleNote QA` },
        `${shortPrograms}\\DOODLE~1\\DOODLE~1.EXE`,
        production,
        realPath
      )
  )
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
    'Software\\f85f8dcf-6782-5a3e-a989-3eae169d6efb'
  )
  // The installer's DN_STATUS_KEY (build/windows-installer.nsh), where the app adds AppMigration.
  assert.equal(
    installStatusKey(appIdentity('qa').appId),
    'Software\\DoodleNote-InstallStatus\\320d0756-c91c-52c4-9287-55a7f514978d'
  )
})

test('the install record is one value naming this identity, complete or pending', () => {
  const identity = installMigrationIdentity(APP_IDENTITY)
  assert.equal(identity, 'f85f8dcf-6782-5a3e-a989-3eae169d6efb|desktop|DoodleNote')
  assert.equal(
    installMigrationIdentity(appIdentity('qa')),
    '320d0756-c91c-52c4-9287-55a7f514978d|desktop-qa|DoodleNote QA'
  )
  const value = (fields: string[]): string => fields.join('|')
  const whole = ['DNMR2', identity, record.from, record.to, '', record.at, 'END']
  assert.deepEqual(parseInstallRecordValue(value(whole), identity), record)
  // Identity and folder names compare as Windows does (case-insensitive).
  assert.deepEqual(parseInstallRecordValue(value(whole), identity.toUpperCase()), record)
  assert.equal(parseInstallRecordValue('', identity), null)
  // Anything less than complete is pending: not acted on and not cleared.
  const pending: Array<[string, string]> = [
    // Cut short anywhere (the installer writes it in one go; a copy could be damaged).
    ...whole.map((_, n): [string, string] => [value(whole.slice(0, n)), `first ${n} fields`]),
    [value(whole).slice(0, -1), 'END cut short'],
    [`${value(whole)}|extra`, 'a field too many'],
    [value(['DNMR2', identity, '', record.to, '', record.at, 'END']), 'no old folder'],
    [value(['DNMR2', identity, record.from, '  ', '', record.at, 'END']), 'no new folder'],
    [value(['DNMR2', identity, record.from, record.to, '', '', 'END']), 'no time'],
    [value(['DNMR2', identity, record.from, record.to, '', '2026-11-08', 'END']), 'not a UTC time'],
    [value(['DNMR2', identity, record.from, record.to, 'DESKTOP', record.at, 'END']), 'no ~'],
    [value(['DNMR2', identity, record.from, record.to, 'A\\B~1', record.at, 'END']), 'a path'],
    // Another identity's record (QA vs production, or the GUID of a different appId).
    [value(['DNMR2', installMigrationIdentity(appIdentity('qa')), ...whole.slice(2)]), 'qa'],
    [
      value([
        'DNMR2',
        'f85f8dcf-6782-5a3e-a989-3eae169d6efb|desktop|DoodleNote QA',
        ...whole.slice(2)
      ]),
      'folder'
    ],
    // A newer (or older) format this build does not read; DNMR1 (no 8.3 name)
    // was written only by this PR's builds before round 9.
    [value(['DNMR3', ...whole.slice(1)]), 'version'],
    [value(['DNMR1', identity, record.from, record.to, record.at, 'END']), 'DNMR1'],
    [`${record.from}|${record.to}|${record.at}`, 'the three-value form of earlier test builds']
  ]
  for (const [input, label] of pending.filter(([input]) => input !== '')) {
    const parsed = parseInstallRecordValue(input, identity)
    assert.ok(parsed && 'pending' in parsed, `${label}: ${JSON.stringify(parsed)}`)
  }
  // Each pending record names why, for the app's status (AppMigrationReason).
  const code = (input: string): string =>
    (parseInstallRecordValue(input, identity) as InstallRecordPending).code
  assert.equal(code(value(whole.slice(0, 5))), 'record-incomplete')
  assert.equal(
    code(value(['DNMR2', installMigrationIdentity(appIdentity('qa')), ...whole.slice(2)])),
    'record-foreign'
  )
  assert.equal(code(value(['DNMR3', ...whole.slice(1)])), 'record-format')
  assert.equal(
    code(value(['DNMR1', identity, record.from, record.to, record.at, 'END'])),
    'record-format'
  )
  assert.equal(
    code(value(['DNMR2', identity, record.from, record.to, 'DESKTOP', record.at, 'END'])),
    'record-format'
  )
  assert.equal(
    code(value(['DNMR2', identity, record.from, record.to, '', '2026-11-08', 'END'])),
    'record-time'
  )
  // The 8.3 name, when there is one, is the record's.
  assert.deepEqual(
    parseInstallRecordValue(
      value(['DNMR2', identity, record.from, record.to, 'DESKTO~1', record.at, 'END']),
      identity
    ),
    { ...record, fromShortName: 'DESKTO~1' }
  )
})

test('the record is read, cleared and the status written through the registry, not a process', async () => {
  const identity = installMigrationIdentity(APP_IDENTITY)
  const key = installStateKey(APP_IDENTITY.appId)
  const values = new Map<string, string>()
  const writes: string[] = []
  const registry: WindowsRegistry = {
    readString: async (subKey, name) => values.get(`${subKey}|${name}`) ?? null,
    readBinary: async () => null,
    writeStrings: async (subKey, pairs) => {
      for (const [name, data] of pairs) {
        writes.push(name)
        values.set(`${subKey}|${name}`, data)
      }
    },
    deleteValue: async (subKey, name) => {
      values.delete(`${subKey}|${name}`)
    }
  }
  assert.equal(await readInstallRecord(registry, key, identity), null)
  values.set(
    `${key}|MigrationRecord`,
    ['DNMR2', identity, record.from, record.to, '', record.at, 'END'].join('|')
  )
  assert.deepEqual(await readInstallRecord(registry, key, identity), record)
  await clearInstallRecord(registry, key)
  assert.equal(await readInstallRecord(registry, key, identity), null)
  // A MigrationRecord of another type (not REG_SZ) is not a record this app reads.
  const typed: WindowsRegistry = {
    ...registry,
    readString: async () => {
      throw Object.assign(new Error('type'), { code: 'TYPE' })
    }
  }
  assert.deepEqual(await readInstallRecord(typed, key, identity), {
    pending: 'not a record this app reads',
    code: 'record-format'
  })
  // Any other failure is a failed read (the caller records read-failed).
  const broken: WindowsRegistry = {
    ...registry,
    readString: async () => {
      throw Object.assign(new Error('no worker'), { code: 'reader-unavailable' })
    }
  }
  await assert.rejects(readInstallRecord(broken, key, identity), /no worker/)
  // The state is written last, after its reason and time.
  const statusKey = installStatusKey(APP_IDENTITY.appId)
  await writeInstallMigrationStatus(registry, statusKey, {
    state: 'read-failed',
    at: '2026-11-08T01:02:03Z',
    reason: 'reader-unavailable'
  })
  assert.deepEqual(writes, ['AppMigrationReason', 'AppMigrationLastAttempt', 'AppMigration'])
  assert.equal(values.get(`${statusKey}|AppMigration`), 'read-failed')
  // No child process anywhere in the record's path.
  const source = readFileSync(new URL('./windows-install-record.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:child_process|execFile|spawn\(/)
})

test('folder containment follows Windows rules and does not match siblings', () => {
  assert.ok(isInsideFolder(oldExe, `${programs}\\desktop`))
  assert.ok(isInsideFolder(oldExe.toUpperCase(), `${programs}\\desktop\\`))
  assert.ok(isInsideFolder(`${programs}/desktop/DoodleNote.exe`, `${programs}\\desktop`))
  assert.ok(!isInsideFolder(`${programs}\\desktop-old\\DoodleNote.exe`, `${programs}\\desktop`))
  assert.ok(!isInsideFolder(newExe, `${programs}\\desktop`))
})

/**
 * A mocked GetFinalPathNameByHandle after a move, for a profile reached through
 * its short name (C:\Users\PATRIC~1): the old folders are gone, the new ones
 * (production DoodleNote, QA "DoodleNote QA") exist with their short aliases.
 */
const SHORT_PROGRAMS = 'C:\\Users\\PATRIC~1\\AppData\\Local\\Programs'
const LONG_PROGRAMS = 'C:\\Users\\Patricia Long\\AppData\\Local\\Programs'
function movedDisk(): (path: string) => string {
  const disk = new Map<string, string>()
  const add = (short: string, long: string): void => void disk.set(short.toLowerCase(), long)
  add('C:\\', 'C:\\')
  add('C:\\Users', 'C:\\Users')
  for (const user of ['PATRIC~1', 'Patricia Long']) {
    add(`C:\\Users\\${user}`, 'C:\\Users\\Patricia Long')
    for (const sub of ['AppData', 'AppData\\Local', 'AppData\\Local\\Programs'])
      add(`C:\\Users\\${user}\\${sub}`, `C:\\Users\\Patricia Long\\${sub}`)
    const programs = `C:\\Users\\${user}\\AppData\\Local\\Programs`
    for (const [short, long] of [
      ['DoodleNote', 'DoodleNote'],
      ['DoodleNote\\DoodleNote.exe', 'DoodleNote\\DoodleNote.exe'],
      ['DoodleNote\\DOODLE~1.EXE', 'DoodleNote\\DoodleNote.exe'],
      ['DOODLE~1', 'DoodleNote QA'],
      ['DoodleNote QA', 'DoodleNote QA'],
      ['DOODLE~1\\DOODLE~1.EXE', 'DoodleNote QA\\DoodleNote QA.exe'],
      ['DoodleNote QA\\DoodleNote QA.exe', 'DoodleNote QA\\DoodleNote QA.exe']
    ])
      add(`${programs}\\${short}`, `${LONG_PROGRAMS}\\${long}`)
  }
  return (path) => {
    const found = disk.get(path.toLowerCase())
    if (found === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' })
    return found
  }
}
const noExpansion = (): string => {
  throw Object.assign(new Error('no expansion'), { code: 'ENOENT' })
}

test('stale-entry detection expands 8.3 names: MCP commands and Run values written through a short path', () => {
  const realPath = movedDisk()
  const legacy = `${LONG_PROGRAMS}\\desktop`
  const legacyQa = `${LONG_PROGRAMS}\\desktop-qa`
  // The old app was started through the profile's short name: its folder is gone,
  // but the parent still exists, so it expands.
  const shortOld = `${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe`
  assert.ok(isInsideFolder(shortOld, legacy, realPath))
  assert.ok(isInsideFolder(`${SHORT_PROGRAMS}\\desktop\\DOODLE~1.EXE`, legacy, realPath))
  // Before the fix the strings were compared as written: never recognised.
  assert.ok(!isInsideFolder(shortOld, legacy, noExpansion))
  // QA: the old folder's own short name cannot expand any more; the record's alias
  // is accepted in its place, and only that one.
  assert.ok(
    isInsideFolder(`${SHORT_PROGRAMS}\\DESKTO~1\\DOODLE~1.EXE`, legacyQa, realPath, 'DESKTO~1')
  )
  assert.ok(
    isInsideFolder(`${SHORT_PROGRAMS}\\deskto~1\\DOODLE~1.EXE`, legacyQa, realPath, 'DESKTO~1')
  )
  assert.ok(!isInsideFolder(`${SHORT_PROGRAMS}\\DESKTO~1\\DOODLE~1.EXE`, legacyQa, realPath))
  assert.ok(isInsideFolder(`${SHORT_PROGRAMS}\\desktop-qa\\DoodleNote QA.exe`, legacyQa, realPath))
  // The new folders exist, so their short names expand to themselves: never stale.
  assert.ok(!isInsideFolder(`${SHORT_PROGRAMS}\\DOODLE~1\\DOODLE~1.EXE`, legacyQa, realPath))
  assert.ok(!isInsideFolder(`${SHORT_PROGRAMS}\\DOODLE~1\\DOODLE~1.EXE`, legacy, realPath))
  assert.ok(!isInsideFolder(`${SHORT_PROGRAMS}\\DoodleNote\\DOODLE~1.EXE`, legacy, realPath))
  assert.ok(!isInsideFolder(`${SHORT_PROGRAMS}\\OTHERA~1\\x.exe`, legacyQa, realPath))
  // An alias counts only in the old folder's own place.
  assert.ok(!isInsideFolder(`C:\\DESKTO~1\\DoodleNote QA.exe`, legacyQa, realPath, 'DESKTO~1'))
})

test('8.3 aliases: only the one the installer recorded, and an unresolvable path is no answer', () => {
  const legacyQa = `${LONG_PROGRAMS}\\desktop-qa`
  const exact = `${SHORT_PROGRAMS}\\DESKTO~1\\DoodleNote QA.exe`
  const collider = `${SHORT_PROGRAMS}\\DESKTO~2\\DoodleNote QA.exe`
  // Exact alias: the record says the old folder was DESKTO~1 and it is gone.
  assert.ok(isInsideFolder(exact, legacyQa, movedDisk(), 'DESKTO~1'))
  // Collider missing: DESKTO~2 (another removed folder, e.g. desktop-qb) is not
  // the old folder just because it could have been its alias.
  assert.ok(!isInsideFolder(collider, legacyQa, movedDisk(), 'DESKTO~1'))
  // No alias recorded (a valid 8.3 name, or 8.3 names off): none is accepted.
  assert.ok(!isInsideFolder(exact, legacyQa, movedDisk(), null))
  // Collider unresolvable: DESKTO~1 exists but cannot be resolved (access denied):
  // it may be another folder, so it is no answer at all, not "missing".
  const denied = (path: string): string => {
    if (/\\DESKTO~1/i.test(path)) throw Object.assign(new Error(`EPERM ${path}`), { code: 'EPERM' })
    return movedDisk()(path)
  }
  assert.throws(() => isInsideFolder(exact, legacyQa, denied, 'DESKTO~1'), PathResolutionError)
  assert.throws(() => longPath(exact, denied), /could not resolve .*DESKTO~1/)
  // An existing folder that now holds the alias expands to its own long name.
  const reused = (path: string): string =>
    /\\DESKTO~1$/i.test(path) ? `${LONG_PROGRAMS}\\desktop-new` : movedDisk()(path)
  assert.ok(!isInsideFolder(exact, legacyQa, reused, 'DESKTO~1'))
  // Missing stays missing: ENOTDIR (a file where a folder would be) too.
  const notDir = (path: string): string => {
    if (/\\DESKTO~1/i.test(path))
      throw Object.assign(new Error(`ENOTDIR ${path}`), { code: 'ENOTDIR' })
    return movedDisk()(path)
  }
  assert.ok(isInsideFolder(exact, legacyQa, notDir, 'DESKTO~1'))
})

test('an unresolvable Run value or MCP command stays pending: not repointed, record not consumed', async () => {
  const legacyQaRecord: InstallMigrationRecord = {
    from: `${LONG_PROGRAMS}\\desktop`,
    to: `${LONG_PROGRAMS}\\DoodleNote`,
    at: '2026-11-08T01:02:03Z',
    fromShortName: 'DESKTO~1'
  }
  const stale = `${SHORT_PROGRAMS}\\DESKTO~1\\DoodleNote.exe`
  const flaky = { denied: true }
  const disk = movedDisk()
  const realPath = (path: string): string => {
    if (flaky.denied && /\\DESKTO~1/i.test(path))
      throw Object.assign(new Error(`EACCES ${path}`), { code: 'EACCES' })
    return disk(path)
  }
  const repointed: string[] = []
  const deps = fakeDeps({
    execPath: `${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`,
    realPath,
    loginItem: {
      stateFor: (isLegacyPath) => ({ registered: isLegacyPath(stale), enabled: true }),
      registerCurrent: (enabled) => {
        deps.registered.push(enabled)
      }
    },
    repointMcpClients: (isLegacy) => {
      try {
        if (isLegacy(stale)) repointed.push('codex')
        return [{ id: 'codex', outcome: isLegacy(stale) ? 'updated' : 'unchanged' }]
      } catch (error) {
        return [{ id: 'codex', outcome: 'failed', error: (error as Error).message }]
      }
    }
  })
  deps.record = legacyQaRecord
  deps.files = new Set([`${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`])
  const first = await runWindowsInstallMigration(deps)
  assert.deepEqual(first.pending, ['login-item', 'codex'])
  assert.equal(first.retry, true)
  assert.deepEqual(deps.registered, [])
  assert.deepEqual(repointed, [])
  assert.notEqual(deps.record, null)
  assert.deepEqual(first.status, {
    state: 'pending',
    at: '2026-11-08T07:08:09Z',
    reason: 'steps-pending:login-item,codex'
  })
  // Once it resolves (missing: the old folder is gone), both steps finish.
  flaky.denied = false
  const second = await runWindowsInstallMigration(deps)
  assert.deepEqual(second.pending, [])
  assert.deepEqual(deps.registered, [true])
  assert.deepEqual(repointed, ['codex'])
  assert.equal(deps.record, null)
})

/**
 * Round 11: the old folder is still on disk (in part) and holds `linked`, a junction.
 * `junction` is where it leads (null: it cannot be resolved, access denied); the
 * record's folders resolve normally.
 */
function legacyWithJunction(junction: string | null): (path: string) => string {
  const disk = movedDisk()
  const legacyDir = `${LONG_PROGRAMS}\\desktop`.toLowerCase()
  return (path) => {
    const lower = path.toLowerCase()
    if (lower === legacyDir) return `${LONG_PROGRAMS}\\desktop`
    if (lower === `${legacyDir}\\linked` || lower.startsWith(`${legacyDir}\\linked\\`)) {
      if (junction === null) throw Object.assign(new Error(`EACCES ${path}`), { code: 'EACCES' })
      return junction + path.slice(`${legacyDir}\\linked`.length)
    }
    return disk(path)
  }
}

test('round 11: a long-form path inside the old folder is resolved before it counts', () => {
  const legacy = `${LONG_PROGRAMS}\\desktop`
  const tool = `${legacy}\\linked\\tool.exe`
  // Unresolvable (EACCES): no answer, as for the short-form ones, however it is written.
  assert.throws(() => isInsideFolder(tool, legacy, legacyWithJunction(null)), PathResolutionError)
  assert.throws(
    () => isInsideFolder(tool.toUpperCase(), legacy, legacyWithJunction(null), 'DESKTO~1'),
    PathResolutionError
  )
  // A nested junction whose destination lies outside the old folder: not inside.
  assert.ok(!isInsideFolder(tool, legacy, legacyWithJunction('D:\\Tools\\linked')))
  assert.ok(!isInsideFolder(tool, legacy, legacyWithJunction(`${LONG_PROGRAMS}\\desktop-old`)))
  // One whose destination is inside it still is.
  assert.ok(isInsideFolder(tool, legacy, legacyWithJunction(`${legacy}\\resources`)))
  // A path that resolves normally, or whose old part is gone, is inside as before.
  assert.ok(isInsideFolder(`${legacy}\\DoodleNote.exe`, legacy, legacyWithJunction(null)))
  assert.ok(isInsideFolder(`${legacy}\\gone\\x.exe`, legacy, movedDisk()))
})

test('round 11: an unresolvable long-form Run value or MCP command stays pending, record kept', async () => {
  const tool = `${LONG_PROGRAMS}\\desktop\\linked\\tool.exe`
  const junction: { to: string | null } = { to: null }
  const disk = legacyWithJunction(null)
  const realPath = (path: string): string =>
    junction.to === null ? disk(path) : legacyWithJunction(junction.to)(path)
  const resolved: string[] = []
  const repointed: string[] = []
  const deps = fakeDeps({
    execPath: `${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`,
    realPath: (path) => {
      resolved.push(path)
      return realPath(path)
    },
    loginItem: {
      stateFor: (isLegacyPath) => ({ registered: isLegacyPath(tool), enabled: true }),
      registerCurrent: (enabled) => {
        deps.registered.push(enabled)
      }
    },
    repointMcpClients: (isLegacy) => {
      try {
        if (isLegacy(tool)) repointed.push('codex')
        return [{ id: 'codex', outcome: isLegacy(tool) ? 'updated' : 'unchanged' }]
      } catch (error) {
        return [{ id: 'codex', outcome: 'failed', error: (error as Error).message }]
      }
    }
  })
  deps.record = { ...record, from: `${LONG_PROGRAMS}\\desktop`, to: `${LONG_PROGRAMS}\\DoodleNote` }
  deps.files = new Set([`${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`])
  const first = await runWindowsInstallMigration(deps)
  // The candidate itself was resolved (before round 11: never), and it failed.
  assert.ok(resolved.some((path) => /\\desktop\\linked\\tool\.exe$/i.test(path)))
  assert.deepEqual(first.pending, ['login-item', 'codex'])
  assert.equal(first.retry, true)
  assert.deepEqual(deps.registered, [])
  assert.deepEqual(repointed, [])
  assert.notEqual(deps.record, null)
  assert.deepEqual(first.status, {
    state: 'pending',
    at: '2026-11-08T07:08:09Z',
    reason: 'steps-pending:login-item,codex'
  })
  // Resolvable now, but the junction leads outside the old folder: nothing of ours,
  // so nothing is repointed or registered; the steps are done, the record consumed.
  junction.to = 'D:\\Tools\\linked'
  const second = await runWindowsInstallMigration(deps)
  assert.deepEqual(second.pending, [])
  assert.deepEqual(deps.registered, [])
  assert.deepEqual(repointed, [])
  assert.equal(deps.record, null)
  assert.equal(second.status?.reason, 'repointed')
})

test('a record whose folders cannot be resolved now is left for the next try', async () => {
  const deps = fakeDeps({
    realPath: () => {
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    }
  })
  deps.record = record
  const result = await runWindowsInstallMigration(deps)
  assert.equal(result.ran, false)
  assert.equal(result.retry, true)
  assert.equal(result.status?.reason, 'path-unresolved')
  assert.notEqual(deps.record, null)
})

test('the login item: the Run value is read as written and matched 8.3-aware', async () => {
  const realPath = movedDisk()
  const legacy = `${LONG_PROGRAMS}\\desktop`
  const isLegacy = (path: string): boolean => isInsideFolder(path, legacy, realPath)
  const asked: string[] = []
  // StartupApproved unreadable here: Electron's answer decides (cases below for the rest).
  const state = (value: string | null, enabled?: boolean): Promise<LoginItemState> =>
    loginItemStateFromRun(
      async () => value,
      async () => {
        throw Object.assign(new Error('no worker'), { code: 'reader-unavailable' })
      },
      (program) => {
        asked.push(program)
        return enabled ?? true
      },
      isLegacy
    )
  const shortOld = `${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe`
  assert.deepEqual(await state(`"${shortOld}"`, false), {
    registered: true,
    enabled: false,
    source: 'electron'
  })
  // Electron is asked with the program exactly as the Run value has it.
  assert.deepEqual(asked, [shortOld])
  assert.deepEqual(await state(`"${shortOld}" --hidden`), {
    registered: true,
    enabled: true,
    source: 'electron'
  })
  // Unquoted: the first word (Electron always quotes).
  assert.deepEqual(await state(`${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe --hidden`), {
    registered: true,
    enabled: true,
    source: 'electron'
  })
  for (const value of [
    null,
    '',
    '""',
    `"${SHORT_PROGRAMS}\\DoodleNote\\DoodleNote.exe"`,
    `"${SHORT_PROGRAMS}\\DOODLE~1\\DOODLE~1.EXE"`
  ])
    assert.deepEqual(await state(value), { registered: false, enabled: true }, String(value))
  assert.equal(asked.length, 3)
})

test('round 10: a login item turned off in Task Manager stays off, an unknown state is never guessed', async () => {
  const realPath = movedDisk()
  const legacy = `${LONG_PROGRAMS}\\desktop`
  const isLegacy = (path: string): boolean => isInsideFolder(path, legacy, realPath)
  const shortOld = `"${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe"`
  const off = Buffer.from('030000000102030405060708', 'hex')
  const on = Buffer.from('020000000000000000000000', 'hex')
  const unreadable = async (): Promise<Buffer | null> => {
    throw Object.assign(new Error('TYPE'), { code: 'TYPE' })
  }
  const state = (
    approved: () => Promise<Buffer | null>,
    electron: boolean | undefined
  ): Promise<LoginItemState> =>
    loginItemStateFromRun(
      async () => shortOld,
      approved,
      () => electron,
      isLegacy
    )
  // Round 11: the answer names what told it.
  const approved = (enabled: boolean): LoginItemState => ({
    registered: true,
    enabled,
    source: 'startup-approved'
  })
  const electron = (enabled: boolean): LoginItemState => ({
    registered: true,
    enabled,
    source: 'electron'
  })
  // The case the review found: Electron cannot match the 8.3 program (undefined), the
  // item is disabled: it stays disabled (before: undefined -> true, re-enabled).
  assert.deepEqual(await state(async () => off, undefined), approved(false))
  // StartupApproved decides when it can be read, whatever Electron says.
  assert.deepEqual(await state(async () => off, true), approved(false))
  assert.deepEqual(await state(async () => on, false), approved(true))
  // No StartupApproved value: never toggled, enabled.
  assert.deepEqual(await state(async () => null, undefined), approved(true))
  // Unreadable: Electron's answer, when it has one.
  assert.deepEqual(await state(unreadable, false), electron(false))
  assert.deepEqual(await state(unreadable, true), electron(true))
  // Neither knows (unreadable or an empty value, and no Electron match): never guessed.
  await assert.rejects(state(unreadable, undefined), LoginItemStateUnknown)
  await assert.rejects(
    state(async () => Buffer.alloc(0), undefined),
    LoginItemStateUnknown
  )
  // A Run value that is not the old install's: not asked at all.
  assert.deepEqual(
    await loginItemStateFromRun(
      async () => `"${SHORT_PROGRAMS}\\DoodleNote\\DoodleNote.exe"`,
      async () => assert.fail('not asked'),
      () => assert.fail('not asked'),
      isLegacy
    ),
    { registered: false, enabled: true }
  )
  // The byte rule: even enabled (0x02, 0x06), odd disabled (0x01, 0x03, 0x07).
  for (const [first, enabled] of [
    [0x02, true],
    [0x06, true],
    [0x00, true],
    [0x01, false],
    [0x03, false],
    [0x07, false]
  ] as const)
    assert.equal(startupApprovedEnabled(Buffer.from([first, 0, 0, 0])), enabled, String(first))
  assert.equal(startupApprovedEnabled(null), true)
  assert.equal(startupApprovedEnabled(Buffer.alloc(0)), undefined)
  // In the move: an unknown state leaves the step pending (retried), nothing registered.
  const registered: boolean[] = []
  let reads = 0
  const deps = fakeDeps({
    loginItem: {
      stateFor: async (isLegacyPath) => {
        reads++
        return loginItemStateFromRun(
          async () => `"${oldExe}"`,
          reads === 1 ? unreadable : async () => off,
          () => undefined,
          isLegacyPath
        )
      },
      registerCurrent: (enabled) => registered.push(enabled)
    }
  })
  const first = await runWindowsInstallMigration(deps)
  assert.deepEqual(first.pending, ['login-item'])
  assert.equal(first.retry, true)
  assert.deepEqual(registered, [])
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, [])
  assert.deepEqual(registered, [false], 'registered again, still disabled')
  // Round 11: what decided is logged and kept in the marker (the e2e asserts it).
  assert.equal(JSON.parse(deps.marker!).loginItemSource, 'startup-approved')
  assert.ok(
    deps.logs.some((line) =>
      /login item moved to .*\(disabled; state from startup-approved\)/.test(line)
    ),
    deps.logs.join('\n')
  )
  // The app wires StartupApproved for its own login item name through the worker.
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(
    index,
    /\(\) => registry\.readBinary\(STARTUP_APPROVED_RUN_KEY, APP_IDENTITY\.loginItemName\)/
  )
})

test('round 11 (disclosed): an empty StartupApproved value and an 8.3 Run program stay pending, untouched', async () => {
  const realPath = movedDisk()
  const shortOld = `"${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe"`
  const approved = { value: Buffer.alloc(0) }
  const registered: boolean[] = []
  const deps = fakeDeps({
    execPath: `${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`,
    realPath,
    loginItem: {
      stateFor: (isLegacyPath) =>
        loginItemStateFromRun(
          async () => shortOld,
          async () => approved.value,
          // Electron compares plain strings: an 8.3 program never matches.
          () => undefined,
          isLegacyPath
        ),
      registerCurrent: (enabled) => registered.push(enabled)
    }
  })
  deps.record = { ...record, from: `${LONG_PROGRAMS}\\desktop`, to: `${LONG_PROGRAMS}\\DoodleNote` }
  deps.files = new Set([`${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`])
  // Every launch: pending, no login-item rewrite, the record kept; only the status
  // and the progress marker are written.
  for (let launch = 0; launch < 3; launch++) {
    const result = await runWindowsInstallMigration(deps)
    assert.deepEqual(result.pending, ['login-item'])
    assert.equal(result.status?.reason, 'steps-pending:login-item')
    assert.deepEqual(registered, [])
    assert.notEqual(deps.record, null)
    assert.equal(JSON.parse(deps.marker!).loginItemDone, false)
  }
  assert.equal(deps.statuses.length, 3)
  // Toggled in Task Manager (Windows writes its 12 bytes): resolved, still off.
  approved.value = Buffer.from('030000000102030405060708', 'hex')
  assert.deepEqual((await runWindowsInstallMigration(deps)).pending, [])
  assert.deepEqual(registered, [false])
  assert.equal(deps.record, null)
})

test('a launch through the short path: the record is consumed, and the marker is recognised', async () => {
  const realPath = movedDisk()
  const shortNewExe = `${SHORT_PROGRAMS}\\DoodleNote\\DOODLE~1.EXE`
  const longNewExe = `${LONG_PROGRAMS}\\DoodleNote\\DoodleNote.exe`
  const longRecord: InstallMigrationRecord = {
    from: `${LONG_PROGRAMS}\\desktop`,
    to: `${LONG_PROGRAMS}\\DoodleNote`,
    at: '2026-11-08T01:02:03Z',
    fromShortName: null
  }
  const staleCommand = `${SHORT_PROGRAMS}\\desktop\\DoodleNote.exe`
  let seen: ((command: string) => boolean) | null = null
  const deps = fakeDeps({
    execPath: shortNewExe,
    realPath,
    loginItem: {
      stateFor: (isLegacyPath) => ({ registered: isLegacyPath(staleCommand), enabled: true }),
      registerCurrent: (enabled) => {
        deps.registered.push(enabled)
      }
    },
    repointMcpClients: (isLegacy) => {
      seen = isLegacy
      return [{ id: 'codex', outcome: 'updated' }]
    }
  })
  deps.record = longRecord
  deps.files = new Set([longNewExe])
  const first = await runWindowsInstallMigration(deps)
  assert.equal(first.loginItem, true)
  assert.deepEqual(first.mcpClients, ['codex'])
  assert.equal(first.status?.state, 'complete')
  assert.ok(seen!(staleCommand))
  assert.ok(!seen!(shortNewExe))

  // The marker of a run started long is recognised by a run started short (and
  // the reverse): progress is not redone, the record is only cleared.
  for (const [written, running] of [
    [longNewExe, shortNewExe],
    [shortNewExe, longNewExe]
  ]) {
    const again = fakeDeps({
      execPath: running,
      realPath,
      ...untouchableSteps
    })
    again.record = longRecord
    again.files = new Set([longNewExe])
    again.marker =
      JSON.stringify({
        version: 2,
        from: `${LONG_PROGRAMS}\\desktop\\DoodleNote.exe`,
        to: written,
        migratedAt: longRecord.at,
        loginItemDone: true,
        mcpPending: [],
        complete: true
      }) + '\n'
    const result = await runWindowsInstallMigration(again)
    assert.equal(result.ran, false, `${written} -> ${running}`)
    assert.equal(result.status?.reason, 'repointed')
    assert.equal(again.record, null)
  }
})

const untouchableSteps = {
  loginItem: { stateFor: () => assert.fail(), registerCurrent: () => assert.fail() },
  repointMcpClients: () => assert.fail()
}

function fakeDeps(overrides: Partial<InstallMigrationDeps> = {}): InstallMigrationDeps & {
  marker: string | null
  record: InstallMigrationRecord | InstallRecordPending | null
  files: Set<string>
  logs: string[]
  registered: boolean[]
  statuses: InstallMigrationStatus[]
} {
  const deps = {
    platform: 'win32' as NodeJS.Platform,
    isPackaged: true,
    execPath: newExe,
    marker: null as string | null,
    record: { ...record } as InstallMigrationRecord | InstallRecordPending | null,
    files: new Set<string>([newExe]),
    logs: [] as string[],
    registered: [] as boolean[],
    statuses: [] as InstallMigrationStatus[],
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
      stateFor: (isLegacyPath: (path: string) => boolean): LoginItemState => ({
        registered: isLegacyPath(oldExe) && !isLegacyPath(newExe),
        enabled: true
      }),
      registerCurrent: (enabled: boolean) => {
        deps.registered.push(enabled)
      }
    },
    repointMcpClients: (): McpRepointOutcome[] => [],
    readStatus: () => deps.statuses.at(-1) ?? null,
    writeStatus: async (status: InstallMigrationStatus) => {
      deps.statuses.push(status)
    },
    now: () => new Date('2026-11-08T07:08:09.123Z'),
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
    pending: [],
    status: { state: 'complete', at: '2026-11-08T07:08:09Z', reason: 'repointed' },
    retry: false
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

test('a record that is there but incomplete is neither acted on nor cleared', async () => {
  for (const [reason, code] of [
    ['incomplete', 'record-incomplete'],
    ['for another app identity', 'record-foreign'],
    ['not a record this app reads', 'record-format'],
    ['no valid time', 'record-time']
  ] as const) {
    let cleared = false
    const deps = fakeDeps({
      ...untouchable,
      clearRecord: async () => {
        cleared = true
      }
    })
    deps.record = { pending: reason, code }
    const result = await runWindowsInstallMigration(deps)
    assert.equal(result.ran, false)
    assert.equal(cleared, false)
    assert.equal(deps.marker, null)
    assert.deepEqual(deps.record, { pending: reason, code })
    assert.match(deps.logs.join('\n'), new RegExp(`left for the installer: ${reason}`))
    // Recorded durably: pending, with the reason; not retried in-session (the installer repairs it).
    assert.deepEqual(deps.statuses, [
      { state: 'pending', at: '2026-11-08T07:08:09Z', reason: code }
    ])
    assert.equal(result.retry, false)
  }
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

test('round 12: a marker whose login item source is not a known one counts as none recorded', async () => {
  for (const [source, kept] of [
    ['startup-approved', 'startup-approved'],
    ['electron', 'electron'],
    ['registry', null],
    [42, null],
    [{ from: 'startup-approved' }, null],
    [null, null]
  ] as const) {
    const deps = fakeDeps()
    deps.marker = JSON.stringify({
      version: 2,
      from: oldExe,
      to: newExe,
      migratedAt: record.at,
      loginItemDone: true,
      loginItemSource: source,
      mcpPending: 'all',
      complete: false
    })
    const result = await runWindowsInstallMigration(deps)
    // The rest of the progress stands: the login item is not redone.
    assert.deepEqual(result.pending, [], String(source))
    assert.deepEqual(deps.registered, [], String(source))
    assert.equal(JSON.parse(deps.marker!).loginItemSource, kept, String(source))
  }
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
  assert.deepEqual(deps.statuses.at(-1)?.reason, 'steps-pending:claude-code')
  assert.deepEqual(await runWindowsInstallMigration(deps), {
    ran: true,
    loginItem: false,
    mcpClients: ['claude-code'],
    pending: [],
    status: { state: 'complete', at: '2026-11-08T07:08:09Z', reason: 'repointed' },
    retry: false
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
  // A quoted key in an inline table is the same command: it is repaired, not skipped.
  const quotedInline = `[mcp_servers]\ndoodle-note = { "command" = ${JSON.stringify(oldExe)} }\n`
  assert.equal(codexConfigServerCommand(quotedInline, 'x'), oldExe)
  assert.equal(
    codexConfigServerCommand(codexConfigWithServer(quotedInline, spec('DoodleNote')), 'x'),
    spec('DoodleNote').command
  )
})

test('AgentAccessService repoints only stale DoodleNote entries and keeps the rest', () => {
  const home = mkdtempSync(join(tmpdir(), 'dn-install-migration-'))
  const previousAppData = process.env.APPDATA
  process.env.APPDATA = join(home, 'AppData', 'Roaming')
  try {
    // The service gets Windows roots (repointing is the strict, Windows-only code).
    const claudeDir = join(home, 'AppData', 'Roaming', 'Claude')
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

    const service = new AgentAccessService(
      () => join(home, 'meetings'),
      spec('DoodleNote'),
      agentAccessRoots({ platform: 'win32', env: {}, home, sandbox: { home, identity: '' } })
    )
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
    // The service gets Windows roots (repointing is the strict, Windows-only code).
    const claudeDir = join(home, 'AppData', 'Roaming', 'Claude')
    // A folder where the file should be: the read fails (EISDIR), it is not absent.
    mkdirSync(join(claudeDir, 'claude_desktop_config.json'), { recursive: true })
    const claudeCode = join(home, '.claude.json')
    writeFileSync(claudeCode, '{ "mcpServers": { "doodle-note": ')
    mkdirSync(join(home, '.codex'), { recursive: true })
    const codex = join(home, '.codex', 'config.toml')
    const brokenCodex = '[mcp_servers.doodle-note]\ncommand = "C:\\unterminated\n'
    writeFileSync(codex, brokenCodex)

    const service = new AgentAccessService(
      () => join(home, 'meetings'),
      spec('DoodleNote'),
      agentAccessRoots({ platform: 'win32', env: {}, home, sandbox: { home, identity: '' } })
    )
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

const at = '2026-11-08T07:08:09Z'

test('every attempt that finds a record or cannot read it records a status', async () => {
  // Complete: repointed and cleared.
  const done = fakeDeps()
  await runWindowsInstallMigration(done)
  assert.deepEqual(done.statuses, [{ state: 'complete', at, reason: 'repointed' }])
  // Complete, but the record could not be removed: recorded as such (the next launch removes it).
  const sticky = fakeDeps({
    clearRecord: async () => {
      throw new Error('access denied')
    }
  })
  await runWindowsInstallMigration(sticky)
  assert.deepEqual(sticky.statuses, [{ state: 'complete', at, reason: 'record-not-cleared' }])
  // A step left for later: pending with the steps, and retried in this session.
  const partial = fakeDeps({
    repointMcpClients: () => [{ id: 'codex', outcome: 'failed', error: 'EBUSY' }]
  })
  const partialResult = await runWindowsInstallMigration(partial)
  assert.deepEqual(partial.statuses, [{ state: 'pending', at, reason: 'steps-pending:codex' }])
  assert.equal(partialResult.retry, true)
  // A record for another folder, or with the old exe still there: pending, not retried.
  const elsewhere = fakeDeps({ ...untouchable, execPath: 'D:\\Copies\\DoodleNote\\DoodleNote.exe' })
  const elsewhereResult = await runWindowsInstallMigration(elsewhere)
  assert.deepEqual(elsewhere.statuses, [{ state: 'pending', at, reason: 'record-other-folder' }])
  assert.equal(elsewhereResult.retry, false)
  const oldThere = fakeDeps(untouchable)
  oldThere.files.add(oldExe)
  await runWindowsInstallMigration(oldThere)
  assert.deepEqual(oldThere.statuses, [{ state: 'pending', at, reason: 'old-exe-present' }])
  // No record and nothing recorded before: nothing is written (most launches).
  const quiet = fakeDeps(untouchable)
  quiet.record = null
  assert.deepEqual(await runWindowsInstallMigration(quiet), {
    ran: false,
    loginItem: false,
    mcpClients: [],
    pending: [],
    status: null,
    retry: false
  })
  assert.deepEqual(quiet.statuses, [])
  // No record after a pending or read-failed one: that state is ended ("none"), once.
  for (const state of ['pending', 'read-failed'] as const) {
    const ended = fakeDeps(untouchable)
    ended.record = null
    ended.statuses.push({ state, at: '2026-11-01T00:00:00Z', reason: 'x' })
    await runWindowsInstallMigration(ended)
    assert.deepEqual(ended.statuses.at(-1), { state: 'none', at, reason: 'no-record' })
    await runWindowsInstallMigration(ended)
    assert.equal(ended.statuses.length, 2)
  }
  // A status that cannot be written is logged; the migration itself still completes.
  const unwritable = fakeDeps({
    writeStatus: async () => {
      throw new Error('registry denied')
    }
  })
  assert.equal((await runWindowsInstallMigration(unwritable)).pending.length, 0)
  assert.match(unwritable.logs.join('\n'), /status not recorded: registry denied/)
})

test('a record that cannot be read is recorded durably, left alone, and consumed on a retry', async () => {
  // As when the reader (the speech worker) cannot start: nothing is known, nothing repointed.
  let readerUp = false
  let reads = 0
  const deps = fakeDeps({
    readRecord: async () => {
      reads++
      if (!readerUp)
        throw Object.assign(new Error('the speech worker could not be started'), {
          code: 'reader-unavailable'
        })
      return deps.record
    }
  })
  const first = await runWindowsInstallMigration(deps)
  assert.equal(first.ran, false)
  assert.equal(first.retry, true)
  assert.deepEqual(deps.statuses, [{ state: 'read-failed', at, reason: 'reader-unavailable' }])
  assert.deepEqual(deps.record, record, 'the record is not consumed')
  assert.deepEqual(deps.registered, [])
  assert.equal(deps.marker, null)
  // Settings says so.
  assert.match(installMigrationNotice(deps.statuses[0])?.title ?? '', /Couldn't finish/)
  // The reader is back: the retry consumes it.
  readerUp = true
  const second = await runWindowsInstallMigration(deps)
  assert.equal(second.ran, true)
  assert.deepEqual(deps.statuses.at(-1), { state: 'complete', at, reason: 'repointed' })
  assert.equal(deps.record, null)
  assert.deepEqual(deps.registered, [true])
  assert.equal(installMigrationNotice(deps.statuses.at(-1)), null)
  assert.equal(reads, 2)
  // Reason codes from the reader's errors.
  assert.equal(readFailureReason({ code: 'reader-timeout' }), 'reader-timeout')
  assert.equal(readFailureReason({ code: 'UNSUPPORTED' }), 'reader-unsupported')
  assert.equal(readFailureReason({ code: 'WIN32_5' }), 'reader-win32-5')
  assert.equal(readFailureReason(new Error('x')), 'reader-error')
  assert.equal(statusTime(new Date('2026-11-08T07:08:09.999Z')), at)
})

test('failed attempts are retried in the session with backoff, and stop once one succeeds', async () => {
  const delays: number[] = []
  const queue: Array<() => void> = []
  const results: Array<Partial<InstallMigrationResult>> = [
    { retry: true },
    { retry: true },
    { retry: false }
  ]
  let attempts = 0
  await runWithRetries(
    async () => ({ ...(results[attempts++] ?? { retry: false }) }) as InstallMigrationResult,
    (run, ms) => {
      delays.push(ms)
      queue.push(run)
    },
    () => {},
    [10, 20, 30]
  )
  while (queue.length) {
    queue.shift()!()
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [10, 20])
  // Never more than the schedule, and a thrown attempt counts as a failure.
  const capped: number[] = []
  const pending: Array<() => void> = []
  let thrown = 0
  await runWithRetries(
    async () => {
      thrown++
      throw new Error('boom')
    },
    (run, ms) => {
      capped.push(ms)
      pending.push(run)
    },
    () => {},
    [1, 2]
  )
  while (pending.length) {
    pending.shift()!()
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(thrown, 3)
  assert.deepEqual(capped, [1, 2])
})

test('Settings shows the move only while it is unfinished, with what to expect', () => {
  assert.equal(installMigrationNotice(null), null)
  assert.equal(installMigrationNotice({ state: 'complete', at, reason: 'repointed' }), null)
  assert.equal(installMigrationNotice({ state: 'none', at, reason: 'no-record' }), null)
  const failed = installMigrationNotice({ state: 'read-failed', at, reason: 'reader-unavailable' })
  assert.match(failed?.title ?? '', /Couldn't finish the Windows upgrade/)
  assert.match(failed?.detail ?? '', /reader-unavailable[\s\S]*tries again[\s\S]*Open at login/)
  const steps = installMigrationNotice({ state: 'pending', at, reason: 'steps-pending:codex' })
  assert.match(steps?.title ?? '', /Finishing the Windows upgrade/)
  assert.match(steps?.detail ?? '', /tries again/)
  const installer = installMigrationNotice({ state: 'pending', at, reason: 'record-incomplete' })
  assert.match(installer?.detail ?? '', /running the DoodleNote installer again/)
})

test('the app and the installer accept exactly the same 8.3 names in a record', () => {
  const names = JSON.parse(
    readFileSync(new URL('./fixtures/install-record-short-names.json', import.meta.url), 'utf8')
  ) as { valid: string[]; invalid: string[] }
  const identity = installMigrationIdentity(APP_IDENTITY)
  const value = (name: string): string =>
    ['DNMR2', identity, record.from, record.to, name, record.at, 'END'].join('|')
  for (const name of names.valid) {
    assert.ok(recordShortNameValid(name), name)
    assert.deepEqual(parseInstallRecordValue(value(name), identity), {
      ...record,
      fromShortName: name === '' ? null : name
    })
  }
  for (const name of names.invalid) {
    assert.ok(!recordShortNameValid(name), JSON.stringify(name))
    assert.deepEqual(parseInstallRecordValue(value(name), identity), {
      pending: 'no valid 8.3 name',
      code: 'record-format'
    })
  }
  // The installer's rule (dnShortNameCheck): the same limits, checked in every
  // record it trusts and before it writes one; the name is captured before removal.
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const rule = guards.slice(guards.indexOf('Function dnShortNameCheck'))
  assert.match(rule, /\$\{elseif\} \$1 > 12\n/)
  for (const ch of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', ' '])
    assert.ok(
      rule.slice(0, rule.indexOf('FunctionEnd')).includes(`== ${ch === '"' ? "'\"'" : `"${ch}"`}`),
      ch
    )
  assert.match(rule, /\$\{if\} \$3 < 32\n/)
  assert.match(rule, /\$\{if\} \$6 == "~"\n/)
  const check = guards.slice(guards.indexOf('Function dnRecordCheck'))
  assert.ok(check.indexOf('Call dnShortNameCheck') > 0)
  assert.ok(check.indexOf('Call dnShortNameCheck') < check.indexOf('Call dnTimeCheck'))
  const write = guards.slice(guards.indexOf('Function dnWriteRecord'))
  assert.match(
    write,
    /ReadRegStr \$R3 HKCU \$dnJournalKey "LegacyShortName"\n\s+Push \$R3\n\s+Call dnShortNameCheck/
  )
  const finish = guards.slice(guards.indexOf('Function dnFinishMigration'))
  assert.ok(finish.indexOf('Call dnShortName\n') < finish.indexOf('Call dnRemoveLegacyDir'))
  assert.ok(
    finish.indexOf('WriteRegStr HKCU $dnJournalKey "LegacyShortName" $2') <
      finish.indexOf('Call dnRemoveLegacyDir')
  )
  assert.ok(guards.includes('!define DN_RECORD_VERSION "DNMR2"'))
})

test('the app and the installer accept exactly the same record times', () => {
  const times = JSON.parse(
    readFileSync(new URL('./fixtures/install-record-times.json', import.meta.url), 'utf8')
  ) as { valid: string[]; invalid: string[] }
  const identity = installMigrationIdentity(APP_IDENTITY)
  const value = (time: string): string =>
    ['DNMR2', identity, record.from, record.to, '', time, 'END'].join('|')
  for (const time of times.valid) {
    assert.ok(recordTimeValid(time), time)
    assert.deepEqual(parseInstallRecordValue(value(time), identity), { ...record, at: time })
  }
  for (const time of times.invalid) {
    assert.ok(!recordTimeValid(time), time)
    const parsed = parseInstallRecordValue(value(time), identity)
    assert.ok(parsed && 'pending' in parsed, time)
  }
  // The installer's rule is the same shape, character for character.
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  )
  assert.ok(guards.includes(`!define DN_RECORD_TIME_SHAPE "${RECORD_TIME_SHAPE}"`))
  // It checks the time of every record it trusts (dnRecordCheck), before the folders.
  const check = guards.slice(guards.indexOf('Function dnRecordCheck'))
  assert.ok(check.indexOf('Call dnTimeCheck') > 0)
  assert.ok(check.indexOf('StrCpy $0 "time"') < check.indexOf('StrCpy $0 "folders"'))
})
