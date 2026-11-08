import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  APP_REGISTRY_SCOPE,
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
import { APP_IDENTITY } from './app-identity'
import type { InstallMigrationStatus } from '../shared/install-migration-api'

const guid = 'f85f8dcf-6782-5a3e-a989-3eae169d6efb'

test('the app may read under Software, write only its status and delete only its record', () => {
  const s = APP_REGISTRY_SCOPE
  assert.ok(s.readable(`Software\\${guid}`, 'MigrationRecord'))
  assert.ok(!s.readable('SYSTEM\\CurrentControlSet', 'x'))
  assert.ok(!s.readable(`Software\\${guid}\\`, 'MigrationRecord'))
  assert.ok(!s.readable(`Software\\${guid}`, 'Migration\0Record'))
  assert.ok(s.writable(`Software\\DoodleNote-InstallStatus\\${guid}`, 'AppMigration'))
  assert.ok(s.writable(`Software\\DoodleNote-InstallStatus\\${guid}`, 'AppMigrationReason'))
  // Not the installer's own values, not another key.
  assert.ok(!s.writable(`Software\\DoodleNote-InstallStatus\\${guid}`, 'LastResult'))
  assert.ok(!s.writable(`Software\\${guid}`, 'AppMigration'))
  assert.ok(!s.writable('Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'AppMigration'))
  assert.ok(s.deletable(`Software\\${guid}`, 'MigrationRecord'))
  assert.ok(!s.deletable(`Software\\${guid}\\InstallMigration`, 'Identity'))
  assert.ok(!s.deletable(`Software\\${guid}`, 'Identity'))
})

/** A fake advapi32 over a Map, with RegGetValueW's sizing protocol. */
function fakeFfi(values: Map<string, string | number>): RegistryFfi & { calls: string[] } {
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
              if (typeof value !== 'string') return 1630
              const bytes = Buffer.from(`${value}\0`, 'utf16le')
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
  const values = new Map<string, string | number>([
    [`Software\\${guid}|MigrationRecord`, 'DNMR1|Jörg 李|😀'],
    [`Software\\${guid}|Number`, 7]
  ])
  const ffi = fakeFfi(values)
  const access = new RegistryAccess(() => ffi)
  assert.deepEqual(
    access.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
    {
      ok: true,
      value: 'DNMR1|Jörg 李|😀'
    }
  )
  assert.deepEqual(access.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'Missing' }), {
    ok: true,
    value: null
  })
  assert.deepEqual(access.handle({ op: 'read', subKey: `Software\\${guid}`, name: 'Number' }), {
    ok: false,
    code: 'TYPE'
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
  // The FFI is bound once.
  assert.equal(ffi.calls.filter((call) => call.startsWith('bind')).length, 3)
  // No FFI (not Windows, or Koffi failed to load): UNSUPPORTED, never a throw.
  const none = new RegistryAccess(() => {
    throw new Error('no koffi')
  })
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
      readable: APP_REGISTRY_SCOPE.readable,
      writable: (subKey) => subKey === statusKey,
      deletable: (subKey, name) => subKey === key && name === 'MigrationRecord'
    }
    const registry = asWindowsRegistry(new RegistryAccess(() => koffi, scope))
    const record =
      'DNMR1|x|desktop|DoodleNote|C:\\Users\\Jörg Ñandú 李雷 😀\\AppData\\Local\\Programs\\desktop|C:\\Users\\Jörg Ñandú 李雷 😀\\AppData\\Local\\Programs\\DoodleNote|2026-11-08T01:02:03Z|END'
    try {
      assert.equal(await registry.readString(key, 'MigrationRecord'), null)
      reg('add', `HKCU\\${key}`, '/v', 'MigrationRecord', '/t', 'REG_SZ', '/d', record, '/f')
      assert.equal(await registry.readString(key, 'MigrationRecord'), record)
      reg('add', `HKCU\\${key}`, '/v', 'Number', '/t', 'REG_DWORD', '/d', '7', '/f')
      await assert.rejects(registry.readString(key, 'Number'), { code: 'TYPE' })
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
        readable: APP_REGISTRY_SCOPE.readable,
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
      'DNMR1',
      identity,
      join(programs, APP_IDENTITY.legacyInstallFolder),
      join(programs, APP_IDENTITY.installFolder),
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
