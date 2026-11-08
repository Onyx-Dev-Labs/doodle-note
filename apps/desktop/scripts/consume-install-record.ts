// Used by test-windows-installer-guards.cjs (Windows only): runs the app's own
// install-record handling (windows-install-migration.ts with the record reader and
// clearer from windows-install-record.ts, over the same registry code the app's
// speech worker runs, windows-registry.ts) against the record the NSIS harness left
// in a throwaway HKCU key, as a packaged app launched from EXE would. Login item and
// MCP clients are stubs: only the record's path through the app is under test.
// Prints the result as JSON; exit 0 when the migration ran and the record was cleared.
//
//   tsx scripts/consume-install-record.ts <HKEY_CURRENT_USER\...> <exe path> <identity> [<status key>] [--reader-fails]
//
// <identity>: the harness's DN_MIGRATION_IDENTITY (a packaged app uses
// installMigrationIdentity(APP_IDENTITY)). Exit 0 needs a complete record; a
// pending one (cut short, another identity's) must be left exactly as it was.
// <status key> (HKCU-relative, throwaway): where AppMigration* are written (the
// app's InstallStatus key); without it they are not written. --reader-fails: the
// record reader is unavailable (as when the speech worker cannot start): the
// record must be left untouched and AppMigration = read-failed recorded.
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import type { InstallMigrationStatus } from '../src/shared/install-migration-api'
import {
  runWindowsInstallMigration,
  type InstallMigrationResult
} from '../src/main/windows-install-migration'
import {
  clearInstallRecord,
  readInstallRecord,
  writeInstallMigrationStatus,
  INSTALL_RECORD_VALUE
} from '../src/main/windows-install-record'
import { RegistryAccess, asWindowsRegistry, type RegistryFfi } from '../src/main/windows-registry'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const readerFails = args.includes('--reader-fails')
  const [fullKey, exe, identity, statusKey] = args.filter((arg) => arg !== '--reader-fails')
  if (!fullKey || !exe || !identity)
    throw new Error(
      'usage: consume-install-record.ts <key> <exe> <identity> [<status key>] [--reader-fails]'
    )
  const key = fullKey.replace(/^HKEY_CURRENT_USER\\/i, '')
  const koffi = createRequire(__filename)('koffi') as RegistryFfi
  // The app's scope (appRegistryScope), for the harness's throwaway keys instead of an identity's.
  const registry = asWindowsRegistry(
    new RegistryAccess(() => koffi, {
      readable: (subKey, name) =>
        (subKey === key && name === INSTALL_RECORD_VALUE) ||
        (subKey === statusKey && /^AppMigration/.test(name)),
      writable: (subKey, name) => subKey === statusKey && /^AppMigration/.test(name),
      deletable: (subKey, name) => subKey === key && name === INSTALL_RECORD_VALUE
    })
  )
  const record = await readInstallRecord(registry, key, identity)
  let marker: string | null = null
  let status: InstallMigrationStatus | null = null
  const log: string[] = []
  const result: InstallMigrationResult = await runWindowsInstallMigration({
    platform: 'win32',
    isPackaged: true,
    execPath: exe,
    readRecord: () =>
      readerFails
        ? Promise.reject(
            Object.assign(new Error('the speech worker could not be started'), {
              code: 'reader-unavailable'
            })
          )
        : readInstallRecord(registry, key, identity),
    clearRecord: () => clearInstallRecord(registry, key),
    exists: existsSync,
    readMarker: () => marker,
    writeMarker: (contents) => {
      marker = contents
    },
    loginItem: {
      stateFor: () => ({ registered: false, enabled: false }),
      registerCurrent: () => {}
    },
    repointMcpClients: () => [],
    readStatus: () => status,
    writeStatus: async (next) => {
      status = next
      if (statusKey) await writeInstallMigrationStatus(registry, statusKey, next)
    },
    log: (message) => log.push(message)
  })
  const after = await readInstallRecord(registry, key, identity)
  console.log(JSON.stringify({ record, result, after, log }))
  process.exit(result.ran && after === null ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
