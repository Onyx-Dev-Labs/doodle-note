// Used by test-windows-installer-guards.cjs (Windows only): runs the app's own
// install-record handling (windows-install-migration.ts with the real registry
// reader and clearer from windows-install-record.ts) against the record the NSIS
// harness left in a throwaway HKCU key, as a packaged app launched from EXE would.
// Login item and MCP clients are stubs: only the record's path through the app is
// under test. Prints the result as JSON; exit 0 when the migration ran and the
// record was cleared.
//
//   tsx scripts/consume-install-record.ts <HKEY_CURRENT_USER\...> <exe path>
import {
  runWindowsInstallMigration,
  type InstallMigrationResult
} from '../src/main/windows-install-migration'
import { clearInstallRecord, readInstallRecord } from '../src/main/windows-install-record'
import { existsSync } from 'node:fs'

async function main(): Promise<void> {
  const [key, exe] = process.argv.slice(2)
  if (!key || !exe) throw new Error('usage: consume-install-record.ts <key> <exe>')
  const record = await readInstallRecord(key)
  let marker: string | null = null
  const log: string[] = []
  const result: InstallMigrationResult = await runWindowsInstallMigration({
    platform: 'win32',
    isPackaged: true,
    execPath: exe,
    readRecord: () => readInstallRecord(key),
    clearRecord: () => clearInstallRecord(key),
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
    log: (message) => log.push(message)
  })
  const after = await readInstallRecord(key)
  console.log(JSON.stringify({ record, result, after, log }))
  process.exit(result.ran && after === null ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
