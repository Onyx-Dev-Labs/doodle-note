/**
 * Windows, inside the speech worker (engine-win.ts): the app's few HKEY_CURRENT_USER reads and
 * writes for the install folder move (windows-install-record.ts), so the main process never starts
 * PowerShell, reg.exe or anything else for them:
 *
 *  - read: one REG_SZ value (RegGetValueW), e.g. the installer's MigrationRecord or the app's
 *    own "Open at login" Run value;
 *  - write: REG_SZ values (RegSetKeyValueW, which creates the key), only under the identity's
 *    HKCU\Software\DoodleNote-InstallStatus\<APP_GUID> key (the app's AppMigration status);
 *  - delete: one value (RegDeleteKeyValueW), only MigrationRecord in HKCU\Software\<APP_GUID>.
 *
 * Text stays UTF-16 end to end, so a non-ASCII user folder in the record reads back exactly (reg.exe
 * prints the console's OEM code page). The Win32 entry points come through the FFI module the worker
 * already loads (passed in, so this file never loads a native module of its own; see
 * release-packaging.test.ts).
 */

import type { WindowsRegistry } from './windows-install-record'

type NativeFn = (...args: unknown[]) => unknown

/** The slice of the FFI module (Koffi) used here. */
export interface RegistryFfi {
  load(path: string): { func(definition: string): NativeFn }
}

export type RegistryRequest =
  | { op: 'read'; subKey: string; name: string }
  | { op: 'write'; subKey: string; values: Array<[string, string]> }
  | { op: 'delete'; subKey: string; name: string }

/** `value`: a read's text, or null when the key or value is not there. */
export type RegistryReply = { ok: true; value?: string | null } | { ok: false; code: string }

/** Which keys and values a request may touch. */
export interface RegistryScope {
  readable(subKey: string, name: string): boolean
  writable(subKey: string, name: string): boolean
  deletable(subKey: string, name: string): boolean
}

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/

/** The per-user Run key, whose value names are app ids (`com.doodlenote.desktop`). */
const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RUN_NAME = /^[A-Za-z][A-Za-z0-9.-]{0,127}$/

/**
 * What the app itself may do: read under Software (and its own login item's Run
 * value, whose name has dots), write its status, delete its record.
 */
export const APP_REGISTRY_SCOPE: RegistryScope = {
  readable: (subKey, name) =>
    /^Software\\[^\\\0]+(\\[^\\\0]+)*$/.test(subKey) &&
    subKey.length < 256 &&
    (NAME.test(name) || (subKey.toLowerCase() === RUN_KEY.toLowerCase() && RUN_NAME.test(name))),
  writable: (subKey, name) =>
    new RegExp(`^Software\\\\DoodleNote-InstallStatus\\\\${GUID}$`, 'i').test(subKey) &&
    /^AppMigration[A-Za-z]*$/.test(name),
  deletable: (subKey, name) =>
    new RegExp(`^Software\\\\${GUID}$`, 'i').test(subKey) && name === 'MigrationRecord'
}

/** (HKEY)(ULONG_PTR)(LONG)0x80000001, sign-extended as Windows defines it. */
const HKEY_CURRENT_USER = -2147483647
const REG_SZ = 1
const RRF_RT_REG_SZ = 0x2
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

  constructor(
    private readonly ffi: () => RegistryFfi,
    private readonly scope: RegistryScope = APP_REGISTRY_SCOPE
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
    writeStrings: async (subKey, values) => {
      run({ op: 'write', subKey, values: values.map(([name, data]) => [name, data]) })
    },
    deleteValue: async (subKey, name) => {
      run({ op: 'delete', subKey, name })
    }
  }
}
