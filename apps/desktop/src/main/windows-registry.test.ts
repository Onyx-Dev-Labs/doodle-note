import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  appRegistryScope,
  NO_REGISTRY_SCOPE,
  RegistryAccess,
  asWindowsRegistry,
  type RegistryFfi,
  type RegistryScope
} from './windows-registry'
import {
  installMigrationIdentity,
  readInstallRecord,
  clearInstallRecord,
  writeInstallMigrationStatus
} from './windows-install-record'
import { runWindowsInstallMigration } from './windows-install-migration'
import { workerIdentityArgs, workerIdentityFrom } from './speech-worker-env'
import { APP_IDENTITY, appIdentity } from './app-identity'
import type { InstallMigrationStatus } from '../shared/install-migration-api'

const guid = 'f85f8dcf-6782-5a3e-a989-3eae169d6efb'

test("the worker's scope is its own identity: its record, its status, its Run value", () => {
  const s = appRegistryScope(APP_IDENTITY)
  const state = `Software\\${guid}`
  const status = `Software\\DoodleNote-InstallStatus\\${guid}`
  const run = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  // Allowed: exactly these.
  assert.ok(s.readable(state, 'MigrationRecord'))
  assert.ok(s.readable(state.toUpperCase(), 'migrationrecord'))
  for (const name of ['AppMigration', 'AppMigrationReason', 'AppMigrationLastAttempt']) {
    assert.ok(s.readable(status, name), name)
    assert.ok(s.writable(status, name), name)
  }
  assert.ok(s.readable(run, 'com.doodlenote.desktop'))
  assert.ok(s.deletable(state, 'MigrationRecord'))
  // Round 10: binary reads, only its own Run value's StartupApproved state.
  const approved = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  assert.ok(s.binaryReadable(approved, 'com.doodlenote.desktop'))
  assert.ok(s.binaryReadable(approved.toLowerCase(), 'COM.DOODLENOTE.DESKTOP'))
  for (const [subKey, name] of [
    [approved, 'com.doodlenote.desktop.qa'],
    [approved, 'OneDrive'],
    [approved, 'com.doodlenote'],
    [`${approved}32`, 'com.doodlenote.desktop'],
    [
      'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
      'com.doodlenote.desktop'
    ],
    [run, 'com.doodlenote.desktop'],
    [state, 'MigrationRecord']
  ])
    assert.ok(!s.binaryReadable(subKey, name), `${subKey} ${name}`)
  // ... and the string scope never covers it: no other op reaches StartupApproved.
  assert.ok(!s.readable(approved, 'com.doodlenote.desktop'))
  assert.ok(!s.writable(approved, 'com.doodlenote.desktop'))
  assert.ok(!s.deletable(approved, 'com.doodlenote.desktop'))
  // Refused: another identity's keys (QA's GUID; any other syntactically valid GUID).
  const qa = '320d0756-c91c-52c4-9287-55a7f514978d'
  const other = '00000000-0000-0000-0000-000000000000'
  for (const g of [qa, other]) {
    assert.ok(!s.readable(`Software\\${g}`, 'MigrationRecord'), g)
    assert.ok(!s.readable(`Software\\DoodleNote-InstallStatus\\${g}`, 'AppMigration'), g)
    assert.ok(!s.writable(`Software\\DoodleNote-InstallStatus\\${g}`, 'AppMigration'), g)
    assert.ok(!s.deletable(`Software\\${g}`, 'MigrationRecord'), g)
  }
  // Refused: other values in its own keys (the installer's, the journal's), other keys.
  assert.ok(!s.readable(state, 'InstallLocation'))
  assert.ok(!s.readable(`${state}\\InstallMigration`, 'SourceDir'))
  assert.ok(!s.readable(status, 'LastResult'))
  assert.ok(!s.readable(status, 'AppMigrationX'))
  assert.ok(!s.readable('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'x'))
  assert.ok(!s.readable('SYSTEM\\CurrentControlSet', 'x'))
  assert.ok(!s.readable(`${state}\\`, 'MigrationRecord'))
  assert.ok(!s.readable(state, 'Migration\0Record'))
  // Refused: another app's Run value (QA's, a prefix, a longer name).
  assert.ok(!s.readable(run, 'com.doodlenote.desktop.qa'))
  assert.ok(!s.readable(run, 'com.doodlenote'))
  assert.ok(!s.readable(run, 'com.doodlenote.desktop\0x'))
  assert.ok(!s.readable(run, 'OneDrive'))
  assert.ok(!s.readable(state, 'com.doodlenote.desktop'))
  // Writes: only the three status values in its own status key.
  assert.ok(!s.writable(status, 'LastResult'))
  assert.ok(!s.writable(status, 'AppMigrationX'))
  assert.ok(!s.writable(state, 'AppMigration'))
  assert.ok(!s.writable(run, 'com.doodlenote.desktop'))
  assert.ok(!s.writable(run, 'AppMigration'))
  // Deletes: only its own record.
  assert.ok(!s.deletable(run, 'com.doodlenote.desktop'))
  assert.ok(!s.deletable(`${state}\\InstallMigration`, 'Identity'))
  assert.ok(!s.deletable(state, 'Identity'))
  assert.ok(!s.deletable(status, 'AppMigration'))
  // The QA identity's scope is QA's alone.
  const q = appRegistryScope(appIdentity('qa'))
  assert.ok(q.readable(`Software\\${qa}`, 'MigrationRecord'))
  assert.ok(q.readable(run, 'com.doodlenote.desktop.qa'))
  assert.ok(!q.readable(state, 'MigrationRecord'))
  assert.ok(!q.readable(run, 'com.doodlenote.desktop'))
  assert.ok(q.binaryReadable(approved, 'com.doodlenote.desktop.qa'))
  assert.ok(!q.binaryReadable(approved, 'com.doodlenote.desktop'))
  assert.ok(!q.writable(status, 'AppMigration'))
  assert.ok(!q.deletable(state, 'MigrationRecord'))
  assert.throws(() => appRegistryScope({ appId: '..\\x', loginItemName: '..\\x' }), /not an app id/)
  // The worker builds its scope from the identity on its command line, which the host
  // sets (never a message or the environment); without one it may touch nothing.
  assert.equal(workerIdentityFrom(workerIdentityArgs(APP_IDENTITY.appId)), APP_IDENTITY.appId)
  assert.equal(workerIdentityFrom(['node', 'engine-win.js']), null)
  assert.equal(
    workerIdentityFrom([...workerIdentityArgs('com.a'), ...workerIdentityArgs('com.b')]),
    null
  )
  assert.equal(workerIdentityFrom(['--doodlenote-registry-identity=..\\x']), null)
  assert.throws(() => workerIdentityArgs('a b'), /not an app id/)
  for (const name of ['production', 'qa'] as const)
    assert.equal(appIdentity(name).loginItemName, appIdentity(name).appId)
  for (const op of ['readable', 'binaryReadable', 'writable', 'deletable'] as const)
    assert.equal(NO_REGISTRY_SCOPE[op](`Software\\${guid}`, 'MigrationRecord'), false)
  const read = (name: string): string =>
    readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const worker = read('./engine-win.ts')
  assert.match(worker, /const workerAppId = workerIdentityFrom\(process\.argv\)\n/)
  assert.match(
    worker,
    /workerAppId\s*\?\s*appRegistryScope\(\{ appId: workerAppId, loginItemName: workerAppId \}\)\s*:\s*NO_REGISTRY_SCOPE/
  )
  // The worker module carries no identity (its bundle is the same in every package).
  assert.doesNotMatch(worker, /from '\.\/app-identity'|APP_IDENTITY|__DOODLENOTE_IDENTITY__/)
  assert.match(
    read('./engine-host-win.ts'),
    /utilityProcess\.fork\(\s*join\(__dirname, 'engine-win\.js'\),\s*workerIdentityArgs\(APP_IDENTITY\.appId\),/
  )
})

/** A fake advapi32 over a Map, with RegGetValueW's sizing protocol. */
function fakeFfi(values: Map<string, string | number | Buffer>): RegistryFfi & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    load: (dll) => {
      assert.equal(dll, 'advapi32.dll')
      return {
        func: (definition) => {
          const name = /__stdcall (\w+)\(/.exec(definition)![1]
          calls.push(`bind ${name}`)
          return (...args: unknown[]) => {
            assert.equal(args[0], -2147483647, 'HKEY_CURRENT_USER')
            const key = `${String(args[1])}|${String(args[2])}`
            if (name === 'RegGetValueW') {
              const value = values.get(key)
              if (value === undefined) return 2
              // RRF_RT_REG_SZ (2) or RRF_RT_REG_BINARY (8): any other type is 1630.
              const binary = args[3] === 8
              if (binary ? !Buffer.isBuffer(value) : typeof value !== 'string') return 1630
              const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${value}\0`, 'utf16le')
              const size = args[6] as number[]
              const data = args[5] as Buffer | null
              if (!data) {
                size[0] = bytes.length
                return 0
              }
              if (data.length < bytes.length) {
                size[0] = bytes.length
                return 234
              }
              bytes.copy(data)
              size[0] = bytes.length
              return 0
            }
            if (name === 'RegSetKeyValueW') {
              values.set(key, (args[4] as Buffer).toString('utf16le').replace(/\0$/, ''))
              return 0
            }
            if (name === 'RegDeleteKeyValueW') return values.delete(key) ? 0 : 2
            throw new Error(name)
          }
        }
      }
    }
  }
}

test('registry requests: exact text, absent is null, wrong type and out-of-scope refused', () => {
  const approved = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  const disabled = Buffer.from('030000000102030405060708', 'hex')
  const values = new Map<string, string | number | Buffer>([
    [`Software\\${guid}|MigrationRecord`, 'DNMR1|Jörg 李|😀'],
    [`Software\\${guid}|Number`, 7],
    [`${approved}|com.doodlenote.desktop`, disabled],
    [`${approved}|com.doodlenote.desktop.qa`, disabled]
  ])
  const ffi = fakeFfi(values)
  const access = new RegistryAccess(() => ffi, appRegistryScope(APP_IDENTITY))
  // The protocol (sizes, absent, types) over a scope that allows these names too.
  const wide = new RegistryAccess(() => ffi, {
    readable: (subKey) => subKey === `Software\\${guid}`,
    binaryReadable: (subKey) => subKey === `Software\\${guid}` || subKey === approved,
    writable: () => false,
    deletable: () => false
  })
  assert.deepEqual(
    access.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
    {
      ok: true,
      value: 'DNMR1|Jörg 李|😀'
    }
  )
  assert.deepEqual(wide.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'Missing' }), {
    ok: true,
    value: null
  })
  assert.deepEqual(wide.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'Number' }), {
    ok: false,
    code: 'TYPE'
  })
  // Round 10: REG_BINARY reads come back as hex; a string value is TYPE, absent is null.
  assert.deepEqual(
    access.handle({ op: 'readBinary', subKey: approved, name: 'com.doodlenote.desktop' }),
    { ok: true, value: disabled.toString('hex') }
  )
  assert.deepEqual(wide.handle({ op: 'readBinary', subKey: approved, name: 'Missing' }), {
    ok: true,
    value: null
  })
  assert.deepEqual(
    wide.handle({ op: 'readBinary', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
    { ok: false, code: 'TYPE' }
  )
  assert.deepEqual(
    access.handle({ op: 'readBinary', subKey: approved, name: 'com.doodlenote.desktop.qa' }),
    { ok: false, code: 'SCOPE' }
  )
  assert.deepEqual(
    access.handle({ op: 'read', subKey: approved, name: 'com.doodlenote.desktop' }),
    { ok: false, code: 'SCOPE' }
  )
  // The app's scope refuses those names (SCOPE, not TYPE: before any Win32 call).
  assert.deepEqual(access.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'Number' }), {
    ok: false,
    code: 'SCOPE'
  })
  assert.deepEqual(access.handle({ op: 'read', subKey: 'SYSTEM\\Setup', name: 'x' }), {
    ok: false,
    code: 'SCOPE'
  })
  // A write naming one value outside the scope writes none of them.
  const statusKey = `Software\\DoodleNote-InstallStatus\\${guid}`
  assert.deepEqual(
    access.handle({
      op: 'write',
      subKey: statusKey,
      values: [
        ['AppMigration', 'pending'],
        ['LastResult', 'forged']
      ]
    }),
    { ok: false, code: 'SCOPE' }
  )
  assert.equal(values.has(`${statusKey}|AppMigration`), false)
  assert.deepEqual(
    access.handle({ op: 'write', subKey: statusKey, values: [['AppMigration', 'complete']] }),
    { ok: true }
  )
  assert.equal(values.get(`${statusKey}|AppMigration`), 'complete')
  assert.deepEqual(
    access.handle({ op: 'delete', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
    { ok: true }
  )
  // Deleting what is not there is fine.
  assert.deepEqual(
    access.handle({ op: 'delete', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
    { ok: true }
  )
  assert.deepEqual(access.handle({ op: 'delete', subKey: `Software\\${guid}`, name: 'Identity' }), {
    ok: false,
    code: 'SCOPE'
  })
  // The FFI is bound once per access.
  assert.equal(ffi.calls.filter((call) => call.startsWith('bind')).length, 6)
  // No FFI (not Windows, or Koffi failed to load): UNSUPPORTED, never a throw.
  const none = new RegistryAccess(() => {
    throw new Error('no koffi')
  }, appRegistryScope(APP_IDENTITY))
  assert.deepEqual(none.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'x' }), {
    ok: false,
    code: 'UNSUPPORTED'
  })
})

const windows = process.platform === 'win32'
const reg = (...args: string[]): void => {
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), args, {
    stdio: 'ignore'
  })
}

test(
  'Windows: the real registry round-trips a non-ASCII record exactly',
  { skip: !windows },
  async () => {
    const koffi = createRequire(import.meta.url)('koffi') as RegistryFfi
    const key = `Software\\DoodleNoteRegistryTest-${process.pid}`
    const statusKey = `${key}-status`
    const scope: RegistryScope = {
      readable: (subKey) => subKey === key || subKey === statusKey,
      binaryReadable: (subKey) => subKey === key,
      writable: (subKey) => subKey === statusKey,
      deletable: (subKey, name) => subKey === key && name === 'MigrationRecord'
    }
    const registry = asWindowsRegistry(new RegistryAccess(() => koffi, scope))
    const record =
      'DNMR2|x|desktop|DoodleNote|C:\\Users\\Jörg Ñandú 李雷 😀\\AppData\\Local\\Programs\\desktop|C:\\Users\\Jörg Ñandú 李雷 😀\\AppData\\Local\\Programs\\DoodleNote||2026-11-08T01:02:03Z|END'
    try {
      assert.equal(await registry.readString(key, 'MigrationRecord'), null)
      reg('add', `HKCU\\${key}`, '/v', 'MigrationRecord', '/t', 'REG_SZ', '/d', record, '/f')
      assert.equal(await registry.readString(key, 'MigrationRecord'), record)
      reg('add', `HKCU\\${key}`, '/v', 'Number', '/t', 'REG_DWORD', '/d', '7', '/f')
      await assert.rejects(registry.readString(key, 'Number'), { code: 'TYPE' })
      // Round 10: a REG_BINARY value (a StartupApproved-shaped one, in the test key).
      assert.equal(await registry.readBinary(key, 'Approved'), null)
      reg(
        'add',
        `HKCU\\${key}`,
        '/v',
        'Approved',
        '/t',
        'REG_BINARY',
        '/d',
        '030000000102030405060708',
        '/f'
      )
      assert.equal(
        (await registry.readBinary(key, 'Approved'))?.toString('hex'),
        '030000000102030405060708'
      )
      await assert.rejects(registry.readBinary(key, 'MigrationRecord'), { code: 'TYPE' })
      await registry.writeStrings(statusKey, [
        ['AppMigration', 'pending'],
        ['AppMigrationReason', 'Jörg']
      ])
      assert.equal(await registry.readString(statusKey, 'AppMigrationReason'), 'Jörg')
      await registry.deleteValue(key, 'MigrationRecord')
      assert.equal(await registry.readString(key, 'MigrationRecord'), null)
      await registry.deleteValue(key, 'MigrationRecord')
    } finally {
      for (const k of [key, statusKey]) {
        try {
          reg('delete', `HKCU\\${k}`, '/f')
        } catch {
          // Not created.
        }
      }
    }
  }
)

test(
  'Windows: an unreadable record is recorded as read-failed, left alone, and consumed on the retry',
  { skip: !windows },
  async () => {
    const koffi = createRequire(import.meta.url)('koffi') as RegistryFfi
    const key = `Software\\DoodleNoteRegistryTest-${process.pid}-move`
    const statusKey = `${key}-status`
    const registry = asWindowsRegistry(
      new RegistryAccess(() => koffi, {
        readable: (subKey) => subKey === key || subKey === statusKey,
        binaryReadable: () => false,
        writable: (subKey) => subKey === statusKey,
        deletable: (subKey, name) => subKey === key && name === 'MigrationRecord'
      })
    )
    const root = mkdtempSync(join(tmpdir(), 'dn-move Jörg 李-'))
    const programs = join(root, 'Programs')
    const exe = join(programs, APP_IDENTITY.installFolder, 'DoodleNote.exe')
    mkdirSync(join(programs, APP_IDENTITY.installFolder), { recursive: true })
    writeFileSync(exe, 'new')
    const identity = installMigrationIdentity(APP_IDENTITY)
    const value = [
      'DNMR2',
      identity,
      join(programs, APP_IDENTITY.legacyInstallFolder),
      join(programs, APP_IDENTITY.installFolder),
      '',
      '2026-11-08T01:02:03Z',
      'END'
    ].join('|')
    let readerUp = false
    let last: InstallMigrationStatus | null = null
    const statusValue = async (): Promise<[string | null, string | null]> => [
      await registry.readString(statusKey, 'AppMigration'),
      await registry.readString(statusKey, 'AppMigrationReason')
    ]
    const run = (): ReturnType<typeof runWindowsInstallMigration> =>
      runWindowsInstallMigration({
        platform: 'win32',
        isPackaged: true,
        execPath: exe,
        readRecord: () =>
          readerUp
            ? readInstallRecord(registry, key, identity)
            : Promise.reject(
                Object.assign(new Error('worker down'), { code: 'reader-unavailable' })
              ),
        clearRecord: () => clearInstallRecord(registry, key),
        exists: () => false,
        readMarker: () => null,
        writeMarker: () => {},
        loginItem: {
          stateFor: () => ({ registered: false, enabled: true }),
          registerCurrent: () => {}
        },
        repointMcpClients: () => [],
        readStatus: () => last,
        writeStatus: async (status) => {
          last = status
          await writeInstallMigrationStatus(registry, statusKey, status)
        },
        log: () => {}
      })
    try {
      reg('add', `HKCU\\${key}`, '/v', 'MigrationRecord', '/t', 'REG_SZ', '/d', value, '/f')
      const failed = await run()
      assert.equal(failed.ran, false)
      assert.equal(failed.retry, true)
      assert.deepEqual(await statusValue(), ['read-failed', 'reader-unavailable'])
      assert.equal(await registry.readString(key, 'MigrationRecord'), value, 'not consumed')
      readerUp = true
      const retried = await run()
      assert.equal(retried.ran, true)
      assert.deepEqual(await statusValue(), ['complete', 'repointed'])
      assert.equal(await registry.readString(key, 'MigrationRecord'), null)
    } finally {
      for (const k of [key, statusKey]) {
        try {
          reg('delete', `HKCU\\${k}`, '/f')
        } catch {
          // Not created.
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  }
)
