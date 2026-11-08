import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { systemPowerShell } from './win-authenticode'

/**
 * The record the Windows installer writes when it has really moved an install
 * from Programs\<package> to Programs\<product> (build/windows-install-guards.nsh,
 * dnFinishMigration): HKCU\Software\<APP_GUID> MigratedFrom / MigratedTo /
 * MigratedAt. The app repoints its login item and MCP client entries only on the
 * strength of this record (windows-install-migration.ts), never on a folder name.
 */
export interface InstallMigrationRecord {
  /** The old install folder, now removed. */
  from: string
  /** The folder the installer moved the app to. */
  to: string
  /** When (UTC); identifies this move, so a later move is new work. */
  at: string
}

export const INSTALL_RECORD_VALUES = ['MigratedFrom', 'MigratedTo', 'MigratedAt'] as const

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

/** Parses the PowerShell reader's JSON line; null unless all three values are present. */
export function parseInstallRecord(output: string): InstallMigrationRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim())
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { from, to, at } = parsed as Record<string, unknown>
  if (typeof from !== 'string' || typeof to !== 'string' || typeof at !== 'string') return null
  if (!from.trim() || !to.trim() || !at.trim()) return null
  return { from, to, at }
}

/** Windows PowerShell 5.1 must not inherit PowerShell 7's module path (see win-authenticode.ts). */
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
  '[pscustomobject]@{ from = [string]$p.MigratedFrom; to = [string]$p.MigratedTo; at = [string]$p.MigratedAt } | ConvertTo-Json -Compress'

const run = (file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10000, env }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout))
    )
  })

const regExe = (): string =>
  join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe')

/**
 * Reads the record, or null when there is none. Most launches have none: a quick
 * reg.exe presence check, and PowerShell only when MigratedTo exists.
 */
export async function readInstallRecord(key: string): Promise<InstallMigrationRecord | null> {
  try {
    await run(regExe(), ['query', key, '/v', 'MigratedTo'])
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
  return parseInstallRecord(output)
}

/** Removes the record once everything it asked for is done (the journal subkey is untouched). */
export async function clearInstallRecord(key: string): Promise<void> {
  for (const name of INSTALL_RECORD_VALUES) {
    try {
      await run(regExe(), ['delete', key, '/v', name, '/f'])
    } catch (error) {
      if ((error as { code?: unknown }).code !== 1) throw error
    }
  }
}
