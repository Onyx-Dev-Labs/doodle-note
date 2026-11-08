import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
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
 * or replaces it from its recovery copy.
 */
export interface InstallRecordPending {
  pending: string
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

/** The per-identity installer state key, as reg.exe and the Registry:: provider name it. */
export function installStateKey(appId: string): string {
  return `HKEY_CURRENT_USER\\Software\\${electronBuilderGuid(appId)}`
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
  if (parts[0] !== INSTALL_RECORD_VERSION) return { pending: 'not a record this app reads' }
  if (parts.length !== 8 || parts[7] !== 'END') return { pending: 'incomplete' }
  if (parts.slice(1, 4).join('|').toLowerCase() !== identity.toLowerCase())
    return { pending: 'for another app identity' }
  const [from, to, at] = parts.slice(4, 7)
  if (!from.trim() || !to.trim()) return { pending: 'incomplete' }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { pending: 'no valid time' }
  return { from, to, at }
}

/** Parses the PowerShell reader's JSON line (READ_SCRIPT); see parseInstallRecordValue. */
export function parseInstallRecord(
  output: string,
  identity: string
): InstallMigrationRecord | InstallRecordPending | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    return { pending: 'unreadable' }
  }
  if (!parsed || typeof parsed !== 'object') return { pending: 'unreadable' }
  const { record } = parsed as Record<string, unknown>
  if (record === null || record === undefined || record === '') return null
  if (typeof record !== 'string') return { pending: 'unreadable' }
  return parseInstallRecordValue(record, identity)
}

/** Windows PowerShell 5.1 from System32, never whichever powershell.exe is first on PATH. */
function systemPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.SystemRoot || env.windir || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
}

/** Windows PowerShell 5.1 must not inherit PowerShell 7's module path (it fails to load its modules). */
function powerShellEnv(key: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (name.toUpperCase() !== 'PSMODULEPATH') env[name] = value
  }
  env.DN_REG_KEY = key
  return env
}

// The key reaches the script as data (DN_REG_KEY), never through its text. UTF-8
// output, so a non-ASCII user folder survives (reg.exe prints the OEM code page).
const READ_SCRIPT =
  "$ErrorActionPreference = 'Stop';" +
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false;' +
  "$p = Get-ItemProperty -LiteralPath ('Registry::' + $env:DN_REG_KEY);" +
  '[pscustomobject]@{ record = [string]$p.MigrationRecord } | ConvertTo-Json -Compress'

const run = (file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10000, env }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout))
    )
  })

const regExe = (): string =>
  join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe')

/**
 * Reads the record for `identity` (installMigrationIdentity), or null when there
 * is none. Most launches have none: a quick reg.exe presence check, and
 * PowerShell only when the value exists.
 */
export async function readInstallRecord(
  key: string,
  identity: string
): Promise<InstallMigrationRecord | InstallRecordPending | null> {
  try {
    await run(regExe(), ['query', key, '/v', INSTALL_RECORD_VALUE])
  } catch (error) {
    // reg.exe exits 1 when the key or value does not exist.
    if ((error as { code?: unknown }).code === 1) return null
    throw error
  }
  const output = await run(
    systemPowerShell(),
    ['-NoProfile', '-NonInteractive', '-Command', READ_SCRIPT],
    powerShellEnv(key)
  )
  return parseInstallRecord(output, identity)
}

/** Removes the record once everything it asked for is done (the journal subkey is untouched). */
export async function clearInstallRecord(key: string): Promise<void> {
  try {
    await run(regExe(), ['delete', key, '/v', INSTALL_RECORD_VALUE, '/f'])
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) throw error
  }
}
