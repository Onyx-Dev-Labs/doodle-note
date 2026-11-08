/**
 * Windows, inside the speech worker (engine-win.ts): the app's few HKEY_CURRENT_USER reads and
 * writes for the install folder move (windows-install-record.ts), so the main process never starts
 * PowerShell, reg.exe or anything else for them:
 *
 *  - read: one REG_SZ value (RegGetValueW with RRF_RT_REG_SZ): the installer's MigrationRecord,
 *    the app's own status, or the app's own "Open at login" Run value; and one REG_BINARY value
 *    (RRF_RT_REG_BINARY, round 10): that Run value's Task Manager state in
 *    Explorer\StartupApproved\Run;
 *  - write: REG_SZ values (RegSetKeyValueW, which creates the key): only the three AppMigration
 *    values in the identity's HKCU\Software\DoodleNote-InstallStatus\<APP_GUID> key;
 *  - delete: one value (RegDeleteKeyValueW): only MigrationRecord in HKCU\Software\<APP_GUID>.
 *
 * The scope is one identity's only (appRegistryScope, for the identity the app forked the worker
 * for, on its command line): another identity's GUID, another key or another value name is refused
 * (SCOPE) before any Win32 call. All three calls use HKEY_CURRENT_USER and the default registry view (no
 * KEY_WOW64_* flag; the app and its installer are both 64-bit, so both see the 64-bit view). A
 * read is capped at 64 KiB, a written value at 1024 characters; the main process gives each request
 * 60 s (engine-host-win.ts REGISTRY_TIMEOUT_MS) before it reports reader-timeout.
 *
 * Text stays UTF-16 end to end, so a non-ASCII user folder in the record reads back exactly (reg.exe
 * prints the console's OEM code page). The Win32 entry points come through the FFI module the worker
 * already loads (passed in, so this file never loads a native module of its own; see
 * release-packaging.test.ts).
 */

import {
  APP_MIGRATION_VALUES,
  INSTALL_RECORD_VALUE,
  STARTUP_APPROVED_RUN_KEY,
  electronBuilderGuid,
  installStateKey,
  installStatusKey,
  type WindowsRegistry
} from './windows-install-record'
import type { AppIdentity } from './app-identity'

type NativeFn = (...args: unknown[]) => unknown

/** The slice of the FFI module (Koffi) used here. */
export interface RegistryFfi {
  load(path: string): { func(definition: string): NativeFn }
}

export type RegistryRequest =
  | { op: 'read'; subKey: string; name: string }
  | { op: 'readBinary'; subKey: string; name: string }
  | { op: 'write'; subKey: string; values: Array<[string, string]> }
  | { op: 'delete'; subKey: string; name: string }

/** `value`: a read's text (readBinary: its bytes as hex), or null when the key or value is not there. */
export type RegistryReply = { ok: true; value?: string | null } | { ok: false; code: string }

/** Which keys and values a request may touch. */
export interface RegistryScope {
  readable(subKey: string, name: string): boolean
  binaryReadable(subKey: string, name: string): boolean
  writable(subKey: string, name: string): boolean
  deletable(subKey: string, name: string): boolean
}

/** The per-user Run key; the app's own value is named after its appId. */
export const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'

/** The app's own AppMigration values (writeInstallMigrationStatus), and nothing else. */
const STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(APP_MIGRATION_VALUES))

/**
 * What the app of identity `appId` may do, and nothing else: read its record
 * (Software\<APP_GUID> MigrationRecord), its own status values
 * (Software\DoodleNote-InstallStatus\<APP_GUID> AppMigration*) and its own Run
 * value (its loginItemName, the appId) and that value's StartupApproved state;
 * write those status values; delete its record. Key and value names compare
 * case-insensitively, as the registry does.
 */
export function appRegistryScope(
  identity: Pick<AppIdentity, 'appId' | 'loginItemName'>
): RegistryScope {
  const { appId, loginItemName } = identity
  for (const name of [appId, loginItemName])
    if (!/^[A-Za-z][A-Za-z0-9.-]{0,127}$/.test(name)) throw new Error(`not an app id: ${name}`)
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  const state = installStateKey(appId)
  const status = installStatusKey(appId)
  const statusValue = (name: string): boolean =>
    [...STATUS_VALUES].some((value) => same(value, name))
  // Sanity: both keys end in this identity's GUID (electron-builder's derivation).
  if (!state.endsWith(electronBuilderGuid(appId))) throw new Error('identity key mismatch')
  return {
    readable: (subKey, name) =>
      (same(subKey, state) && same(name, INSTALL_RECORD_VALUE)) ||
      (same(subKey, status) && statusValue(name)) ||
      (same(subKey, RUN_KEY) && same(name, loginItemName)),
    binaryReadable: (subKey, name) =>
      same(subKey, STARTUP_APPROVED_RUN_KEY) && same(name, loginItemName),
    writable: (subKey, name) => same(subKey, status) && statusValue(name),
    deletable: (subKey, name) => same(subKey, state) && same(name, INSTALL_RECORD_VALUE)
  }
}

/** A worker started without an identity may touch nothing. */
export const NO_REGISTRY_SCOPE: RegistryScope = {
  readable: () => false,
  binaryReadable: () => false,
  writable: () => false,
  deletable: () => false
}

/** (HKEY)(ULONG_PTR)(LONG)0x80000001, sign-extended as Windows defines it. */
const HKEY_CURRENT_USER = -2147483647
const REG_SZ = 1
const RRF_RT_REG_SZ = 0x2
const RRF_RT_REG_BINARY = 0x8
/** A StartupApproved value is 12 bytes. */
const MAX_BINARY_BYTES = 256
const ERROR_SUCCESS = 0
const ERROR_FILE_NOT_FOUND = 2
const ERROR_MORE_DATA = 234
const ERROR_UNSUPPORTED_TYPE = 1630
/** Far more than any value the app reads (a MigrationRecord is a few hundred bytes). */
const MAX_VALUE_BYTES = 64 * 1024
const MAX_WRITE_CHARS = 1024

interface Win32 {
  RegGetValueW: NativeFn
  RegSetKeyValueW: NativeFn
  RegDeleteKeyValueW: NativeFn
}

export class RegistryAccess {
  private win: Win32 | null = null

  /** `scope`: appRegistryScope(the running identity's appId) in the app; tests pass their own. */
  constructor(
    private readonly ffi: () => RegistryFfi,
    private readonly scope: RegistryScope
  ) {}

  private api(): Win32 {
    if (!this.win) {
      const advapi32 = this.ffi().load('advapi32.dll')
      this.win = {
        RegGetValueW: advapi32.func(
          'int32 __stdcall RegGetValueW(intptr hkey, str16 subKey, str16 value, uint32 flags, _Out_ uint32_t *type, void *data, _Inout_ uint32_t *size)'
        ),
        RegSetKeyValueW: advapi32.func(
          'int32 __stdcall RegSetKeyValueW(intptr hkey, str16 subKey, str16 value, uint32 type, void *data, uint32 size)'
        ),
        RegDeleteKeyValueW: advapi32.func(
          'int32 __stdcall RegDeleteKeyValueW(intptr hkey, str16 subKey, str16 value)'
        )
      }
    }
    return this.win
  }

  handle(request: RegistryRequest): RegistryReply {
    let win: Win32
    try {
      win = this.api()
    } catch {
      return { ok: false, code: 'UNSUPPORTED' }
    }
    switch (request.op) {
      case 'read':
        if (!this.scope.readable(request.subKey, request.name)) return { ok: false, code: 'SCOPE' }
        return this.read(win, request.subKey, request.name)
      case 'readBinary':
        if (!this.scope.binaryReadable(request.subKey, request.name))
          return { ok: false, code: 'SCOPE' }
        return this.readBinary(win, request.subKey, request.name)
      case 'write':
        for (const [name, data] of request.values) {
          if (!this.scope.writable(request.subKey, name) || data.length > MAX_WRITE_CHARS)
            return { ok: false, code: 'SCOPE' }
        }
        for (const [name, data] of request.values) {
          const bytes = Buffer.from(`${data}\0`, 'utf16le')
          const rc = Number(
            win.RegSetKeyValueW(
              HKEY_CURRENT_USER,
              request.subKey,
              name,
              REG_SZ,
              bytes,
              bytes.length
            )
          )
          if (rc !== ERROR_SUCCESS) return { ok: false, code: `WIN32_${rc}` }
        }
        return { ok: true }
      case 'delete': {
        if (!this.scope.deletable(request.subKey, request.name)) return { ok: false, code: 'SCOPE' }
        const rc = Number(win.RegDeleteKeyValueW(HKEY_CURRENT_USER, request.subKey, request.name))
        if (rc === ERROR_SUCCESS || rc === ERROR_FILE_NOT_FOUND) return { ok: true }
        return { ok: false, code: `WIN32_${rc}` }
      }
      default:
        return { ok: false, code: 'SCOPE' }
    }
  }

  private read(win: Win32, subKey: string, name: string): RegistryReply {
    // Sized first; a value that grows in between is read again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const size = [0]
      let rc = Number(
        win.RegGetValueW(HKEY_CURRENT_USER, subKey, name, RRF_RT_REG_SZ, [0], null, size)
      )
      if (rc === ERROR_FILE_NOT_FOUND) return { ok: true, value: null }
      if (rc === ERROR_UNSUPPORTED_TYPE) return { ok: false, code: 'TYPE' }
      if (rc !== ERROR_SUCCESS) return { ok: false, code: `WIN32_${rc}` }
      const length = Number(size[0])
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_VALUE_BYTES)
        return { ok: false, code: 'SIZE' }
      const buffer = Buffer.alloc(Math.max(length, 2))
      const got = [buffer.length]
      rc = Number(
        win.RegGetValueW(HKEY_CURRENT_USER, subKey, name, RRF_RT_REG_SZ, [0], buffer, got)
      )
      if (rc === ERROR_MORE_DATA) continue
      if (rc === ERROR_FILE_NOT_FOUND) return { ok: true, value: null }
      if (rc === ERROR_UNSUPPORTED_TYPE) return { ok: false, code: 'TYPE' }
      if (rc !== ERROR_SUCCESS) return { ok: false, code: `WIN32_${rc}` }
      const text = buffer.subarray(0, Number(got[0]) & ~1).toString('utf16le')
      return { ok: true, value: text.replace(/\0+$/, '') }
    }
    return { ok: false, code: 'SIZE' }
  }

  private readBinary(win: Win32, subKey: string, name: string): RegistryReply {
    const buffer = Buffer.alloc(MAX_BINARY_BYTES)
    const got = [buffer.length]
    const rc = Number(
      win.RegGetValueW(HKEY_CURRENT_USER, subKey, name, RRF_RT_REG_BINARY, [0], buffer, got)
    )
    if (rc === ERROR_FILE_NOT_FOUND) return { ok: true, value: null }
    if (rc === ERROR_UNSUPPORTED_TYPE) return { ok: false, code: 'TYPE' }
    if (rc === ERROR_MORE_DATA) return { ok: false, code: 'SIZE' }
    if (rc !== ERROR_SUCCESS) return { ok: false, code: `WIN32_${rc}` }
    const length = Number(got[0])
    if (!Number.isSafeInteger(length) || length < 0 || length > buffer.length)
      return { ok: false, code: 'SIZE' }
    return { ok: true, value: buffer.subarray(0, length).toString('hex') }
  }
}

/** The WindowsRegistry (windows-install-record.ts) over a RegistryAccess in this process (tests, scripts). */
export function asWindowsRegistry(access: RegistryAccess): WindowsRegistry {
  const run = (request: RegistryRequest): RegistryReply & { ok: true } => {
    const reply = access.handle(request)
    if (!reply.ok)
      throw Object.assign(new Error(`the registry request failed (${reply.code})`), {
        code: reply.code
      })
    return reply
  }
  return {
    readString: async (subKey, name) => run({ op: 'read', subKey, name }).value ?? null,
    readBinary: async (subKey, name) => {
      const value = run({ op: 'readBinary', subKey, name }).value
      return typeof value === 'string' ? Buffer.from(value, 'hex') : null
    },
    writeStrings: async (subKey, values) => {
      run({ op: 'write', subKey, values: values.map(([name, data]) => [name, data]) })
    },
    deleteValue: async (subKey, name) => {
      run({ op: 'delete', subKey, name })
    }
  }
}
