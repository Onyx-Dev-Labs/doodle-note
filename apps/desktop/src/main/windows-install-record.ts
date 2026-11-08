import { createHash } from 'node:crypto'
import type { InstallMigrationStatus } from '../shared/install-migration-api'
import type { AppIdentity } from './app-identity'

/**
 * The record the Windows installer writes when it has really moved an install
 * from Programs\<package> to Programs\<product> (build/windows-install-guards.nsh,
 * dnWriteRecord): one value, HKCU\Software\<APP_GUID> MigrationRecord, so it is
 * written (and restored from the installer's recovery copy) in a single step:
 *
 *   DNMR1|<APP_GUID>|<package>|<product>|<old folder>|<new folder>|<UTC>|END
 *
 * The app repoints its login item and MCP client entries only on the strength of
 * this record (windows-install-migration.ts), never on a folder name.
 */
export interface InstallMigrationRecord {
  /** The old install folder, now removed. */
  from: string
  /** The folder the installer moved the app to. */
  to: string
  /** When (UTC); identifies this move, so a later move is new work. */
  at: string
}

/**
 * A record value that is there but not a complete record for this identity (cut
 * short, another identity's, a newer format). The app acts on nothing less than a
 * complete record and leaves this one where it is: a later installer run repairs
 * or replaces it from its recovery copy. `code` is what the app's status records
 * (AppMigrationReason, see writeInstallMigrationStatus).
 */
export interface InstallRecordPending {
  pending: string
  code: 'record-format' | 'record-incomplete' | 'record-foreign' | 'record-time'
}

/**
 * HKEY_CURRENT_USER access for the record and the app's status. In the app the
 * speech worker does it through the FFI it already loads (WinEngineHost.registry,
 * windows-registry.ts), so no PowerShell or reg.exe is started. Keys are relative
 * to HKEY_CURRENT_USER. A failed request rejects with an Error whose `code` says why.
 */
export interface WindowsRegistry {
  /** A REG_SZ value's text, or null when the key or value is not there. */
  readString(subKey: string, name: string): Promise<string | null>
  /** Writes REG_SZ values in order (the key is created if needed). */
  writeStrings(subKey: string, values: ReadonlyArray<readonly [string, string]>): Promise<void>
  /** Deletes one value; resolves when it is gone or was never there. */
  deleteValue(subKey: string, name: string): Promise<void>
}

export const INSTALL_RECORD_VALUE = 'MigrationRecord'
export const INSTALL_RECORD_VERSION = 'DNMR1'

/** electron-builder's namespace for APP_GUID (app-builder-lib NsisTarget). */
const ELECTRON_BUILDER_NS = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')

/**
 * The NSIS APP_GUID electron-builder derives from an appId (UUID v5 in its own
 * namespace; no nsis.guid is configured), which names Software\<APP_GUID>.
 */
export function electronBuilderGuid(appId: string): string {
  const hash = createHash('sha1').update(ELECTRON_BUILDER_NS).update(appId).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** The per-identity installer state key (HKCU\\Software\\<APP_GUID>), holding the record. */
export function installStateKey(appId: string): string {
  return `Software\\${electronBuilderGuid(appId)}`
}

/**
 * The per-identity status key the installer records its decisions in (DN_STATUS_KEY,
 * build/windows-installer.nsh), where the app adds its own AppMigration values.
 */
export function installStatusKey(appId: string): string {
  return `Software\\DoodleNote-InstallStatus\\${electronBuilderGuid(appId)}`
}

/**
 * What the installer's DN_MIGRATION_IDENTITY is for this app: APP_GUID, APP_FILENAME
 * (the package name, the old folder) and PRODUCT_FILENAME (the new folder).
 */
export function installMigrationIdentity(
  identity: Pick<AppIdentity, 'appId' | 'legacyInstallFolder' | 'installFolder'>
): string {
  return `${electronBuilderGuid(identity.appId)}|${identity.legacyInstallFolder}|${identity.installFolder}`
}

/**
 * The record's time: exactly this shape, D an ASCII digit. The installer checks the
 * same shape (DN_RECORD_TIME_SHAPE, dnTimeCheck in build/windows-install-guards.nsh),
 * so a record one of them calls complete the other does too
 * (src/main/fixtures/install-record-times.json).
 */
export const RECORD_TIME_SHAPE = 'DDDD-DD-DDTDD:DD:DDZ'

export function recordTimeValid(at: string): boolean {
  if (at.length !== RECORD_TIME_SHAPE.length) return false
  for (let i = 0; i < RECORD_TIME_SHAPE.length; i++) {
    const want = RECORD_TIME_SHAPE[i]
    const got = at[i]
    if (want === 'D' ? got < '0' || got > '9' : got !== want) return false
  }
  return true
}

/**
 * Parses a MigrationRecord value for `identity` (installMigrationIdentity): the
 * record when it is complete, null when there is none, `{ pending }` when it is
 * there but anything less than complete for this identity.
 */
export function parseInstallRecordValue(
  value: string,
  identity: string
): InstallMigrationRecord | InstallRecordPending | null {
  if (!value) return null
  const parts = value.split('|')
  if (parts[0] !== INSTALL_RECORD_VERSION)
    return { pending: 'not a record this app reads', code: 'record-format' }
  if (parts.length !== 8 || parts[7] !== 'END')
    return { pending: 'incomplete', code: 'record-incomplete' }
  if (parts.slice(1, 4).join('|').toLowerCase() !== identity.toLowerCase())
    return { pending: 'for another app identity', code: 'record-foreign' }
  const [from, to, at] = parts.slice(4, 7)
  if (!from.trim() || !to.trim()) return { pending: 'incomplete', code: 'record-incomplete' }
  if (!recordTimeValid(at)) return { pending: 'no valid time', code: 'record-time' }
  return { from, to, at }
}

/**
 * Reads the record for `identity` (installMigrationIdentity) from `key`
 * (installStateKey), or null when there is none. A value of another type than
 * REG_SZ is not a record this app reads (pending, left alone).
 */
export async function readInstallRecord(
  registry: WindowsRegistry,
  key: string,
  identity: string
): Promise<InstallMigrationRecord | InstallRecordPending | null> {
  let value: string | null
  try {
    value = await registry.readString(key, INSTALL_RECORD_VALUE)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'TYPE')
      return { pending: 'not a record this app reads', code: 'record-format' }
    throw error
  }
  return value === null ? null : parseInstallRecordValue(value, identity)
}

/** Removes the record once everything it asked for is done (the journal subkey is untouched). */
export async function clearInstallRecord(registry: WindowsRegistry, key: string): Promise<void> {
  await registry.deleteValue(key, INSTALL_RECORD_VALUE)
}

/** The app's own status values in the identity's status key (installStatusKey). */
export const APP_MIGRATION_VALUES = {
  state: 'AppMigration',
  at: 'AppMigrationLastAttempt',
  reason: 'AppMigrationReason'
} as const

/**
 * Records the app's side of the move beside the installer's LastStep/LastResult:
 * AppMigrationReason and AppMigrationLastAttempt first, AppMigration (the state)
 * last, so a state is never shown with an older attempt's reason.
 */
export async function writeInstallMigrationStatus(
  registry: WindowsRegistry,
  statusKey: string,
  status: InstallMigrationStatus
): Promise<void> {
  await registry.writeStrings(statusKey, [
    [APP_MIGRATION_VALUES.reason, status.reason],
    [APP_MIGRATION_VALUES.at, status.at],
    [APP_MIGRATION_VALUES.state, status.state]
  ])
}
