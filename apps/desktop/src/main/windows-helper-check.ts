/**
 * Windows, inside the speech worker (engine-win.ts): holding and checking Bark's dictation helper
 * before the app spawns it, so the main process never starts PowerShell (or anything else) to do it.
 *
 *  - hold: CreateFileW(GENERIC_READ, FILE_SHARE_READ) opens the helper with writing, renaming and
 *    deleting denied, and the handle is KEPT; the whole file is read through that handle and hashed
 *    (the signing-invariant digest from scripts/authenticode-digest.mjs, and SHA-256 of every byte).
 *  - trust: WinVerifyTrust (WINTRUST_ACTION_GENERIC_VERIFY_V2) on that same handle, offline (no
 *    revocation, cached URL retrieval only), and the signer's subject CN and SHA-1 thumbprint from the
 *    verified signer chain.
 *  - confirm: whether the hold is still open (asked after the spawn returns).
 *  - release: closes the handle (after the spawn). Holds also end after maxHoldMs, and with the
 *    worker process itself: the utilityProcess dies with the app, and Windows closes its handles.
 *
 * The Win32 entry points come through the FFI module the worker already loads (passed in, so this
 * file never loads a native module of its own; see release-packaging.test.ts).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { peLayout, stableDigest } from '../../scripts/authenticode-digest.mjs'
import { HOLD_EXPIRY_MS } from './helper-hold-timing'

type NativeFn = ((...args: unknown[]) => unknown) & {
  async: (...args: unknown[]) => void
}

/** The slice of the FFI module (Koffi) used here. */
export interface FfiLike {
  load(path: string): { func(definition: string): NativeFn }
  struct(name: string, def: Record<string, unknown>): unknown
  pointer(type: unknown): unknown
  array(type: string, length: number): unknown
  sizeof(type: unknown): number
  decode(value: unknown, offset: number, type: string): unknown
  address(value: unknown): bigint
}

export type HoldReply =
  | { ok: true; fileSha256: string; digest: string | null; signed: boolean; holdMs: number }
  | { ok: false; code: 'ENOENT' | 'EBUSY' | 'EIO' | 'UNSUPPORTED'; detail?: string }

export type TrustReply =
  | { status: 'valid'; subjectCn: string | null; thumbprint: string | null; ms: number }
  | { status: 'invalid'; code: string; ms: number }
  | { status: 'unavailable'; reason: string; ms: number }

/** Exported for tests: how one WinVerifyTrust result is treated. */
export function classifyTrustResult(
  rc: number
):
  | { status: 'valid' }
  | { status: 'invalid'; code: string }
  | { status: 'unavailable'; reason: string } {
  const code = rc >>> 0
  switch (code) {
    case 0:
      return { status: 'valid' }
    // The file's signature does not cover its bytes, or there is a table but no usable signature:
    // the image was changed after signing. Definitive.
    case 0x80096010: // TRUST_E_BAD_DIGEST
      return { status: 'invalid', code: 'HashMismatch' }
    case 0x800b0100: // TRUST_E_NOSIGNATURE
    case 0x800b0003: // TRUST_E_SUBJECT_FORM_UNKNOWN
      return { status: 'invalid', code: 'NotSigned' }
    case 0x80096004: // TRUST_E_CERT_SIGNATURE
      return { status: 'invalid', code: 'BadCertSignature' }
    // Chain trust: not proof of tampering (an offline image missing a root, an expired or
    // distrusted certificate, policy). The digest decides; nothing is persisted.
    case 0x800b0109: // CERT_E_UNTRUSTEDROOT
    case 0x800b010a: // CERT_E_CHAINING
    case 0x800b0101: // CERT_E_EXPIRED
    case 0x800b010c: // CERT_E_REVOKED
    case 0x80092010: // CRYPT_E_REVOKED
    case 0x800b0110: // CERT_E_WRONG_USAGE
    case 0x800b0111: // TRUST_E_EXPLICIT_DISTRUST
    case 0x800b0004: // TRUST_E_SUBJECT_NOT_TRUSTED
    case 0x80092026: // CRYPT_E_SECURITY_SETTINGS
    case 0x80096019: // TRUST_E_BASIC_CONSTRAINTS
      return { status: 'unavailable', reason: `NotTrusted 0x${code.toString(16)}` }
    default:
      return { status: 'unavailable', reason: `UnknownError 0x${code.toString(16)}` }
  }
}

const GENERIC_READ = 0x80000000
const FILE_SHARE_READ = 0x1
const OPEN_EXISTING = 3
const FILE_ATTRIBUTE_NORMAL = 0x80
const INVALID_HANDLE = 0xffffffffffffffffn
const WTD_UI_NONE = 2
const WTD_REVOKE_NONE = 0
const WTD_CHOICE_FILE = 1
const WTD_STATEACTION_VERIFY = 1
const WTD_STATEACTION_CLOSE = 2
const WTD_REVOCATION_CHECK_NONE = 0x10
const WTD_CACHE_ONLY_URL_RETRIEVAL = 0x1000
const CERT_NAME_ATTR_TYPE = 3
const CERT_SHA1_HASH_PROP_ID = 3
/** WINTRUST_ACTION_GENERIC_VERIFY_V2 {00AAC56B-CD44-11d0-8CC2-00C04FC295EE}. */
const VERIFY_V2 = {
  Data1: 0x00aac56b,
  Data2: 0xcd44,
  Data3: 0x11d0,
  Data4: [0x8c, 0xc2, 0x00, 0xc0, 0x4f, 0xc2, 0x95, 0xee]
}
/** The helper is ~200 KB; anything far larger is not it. */
const MAX_HELPER_BYTES = 64 * 1024 * 1024

interface Win32 {
  CreateFileW: NativeFn
  CloseHandle: NativeFn
  GetFileSizeEx: NativeFn
  ReadFile: NativeFn
  WinVerifyTrust: NativeFn
  ProvData: NativeFn
  ProvSigner: NativeFn
  ProvCert: NativeFn
  CertGetNameStringW: NativeFn
  CertGetProp: NativeFn
  DataType: unknown
  FileInfoType: unknown
}

function bind(ffi: FfiLike): Win32 {
  const kernel32 = ffi.load('kernel32.dll')
  const wintrust = ffi.load('wintrust.dll')
  const crypt32 = ffi.load('crypt32.dll')
  ffi.struct('DN_GUID', {
    Data1: 'uint32',
    Data2: 'uint16',
    Data3: 'uint16',
    Data4: ffi.array('uint8', 8)
  })
  const FileInfoType = ffi.struct('DN_WINTRUST_FILE_INFO', {
    cbStruct: 'uint32',
    pcwszFilePath: 'str16',
    hFile: 'void *',
    pgKnownSubject: 'void *'
  })
  const DataType = ffi.struct('DN_WINTRUST_DATA', {
    cbStruct: 'uint32',
    pPolicyCallbackData: 'void *',
    pSIPClientData: 'void *',
    dwUIChoice: 'uint32',
    fdwRevocationChecks: 'uint32',
    dwUnionChoice: 'uint32',
    pFile: ffi.pointer(FileInfoType),
    dwStateAction: 'uint32',
    hWVTStateData: 'void *',
    pwszURLReference: 'str16',
    dwProvFlags: 'uint32',
    dwUIContext: 'uint32',
    pSignatureSettings: 'void *'
  })
  return {
    CreateFileW: kernel32.func(
      'void * __stdcall CreateFileW(str16 path, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)'
    ),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *handle)'),
    GetFileSizeEx: kernel32.func('bool __stdcall GetFileSizeEx(void *handle, _Out_ int64_t *size)'),
    ReadFile: kernel32.func(
      'bool __stdcall ReadFile(void *handle, void *buffer, uint32 count, _Out_ uint32_t *read, void *overlapped)'
    ),
    WinVerifyTrust: wintrust.func(
      'int32 __stdcall WinVerifyTrust(void *hwnd, DN_GUID *action, _Inout_ DN_WINTRUST_DATA *data)'
    ),
    ProvData: wintrust.func('void * __stdcall WTHelperProvDataFromStateData(void *state)'),
    ProvSigner: wintrust.func(
      'void * __stdcall WTHelperGetProvSignerFromChain(void *prov, uint32 signer, int counterSigner, uint32 counterIndex)'
    ),
    ProvCert: wintrust.func(
      'void * __stdcall WTHelperGetProvCertFromChain(void *signer, uint32 index)'
    ),
    CertGetNameStringW: crypt32.func(
      'uint32 __stdcall CertGetNameStringW(void *cert, uint32 type, uint32 flags, const char *para, _Out_ uint16_t *name, uint32 count)'
    ),
    CertGetProp: crypt32.func(
      'int __stdcall CertGetCertificateContextProperty(void *cert, uint32 id, _Out_ uint8_t *data, _Inout_ uint32_t *size)'
    ),
    DataType,
    FileInfoType
  }
}

interface Hold {
  path: string
  handle: unknown
  timer: NodeJS.Timeout
}

/** One per worker. Not thread-safe beyond the worker's single event loop (it needs none). */
export class HelperChecker {
  private win: Win32 | null = null
  private readonly holds = new Map<number, Hold>()

  constructor(
    private readonly ffi: () => FfiLike,
    private readonly maxHoldMs = HOLD_EXPIRY_MS,
    /** Told when a hold ends by expiry (not by release), so the app sees it at once. */
    private readonly onExpire: (id: number) => void = () => {}
  ) {}

  private api(): Win32 {
    this.win ??= bind(this.ffi())
    return this.win
  }

  /** Open and hold the helper, read it through the held handle, and hash it. */
  hold(id: number, path: string): HoldReply {
    const started = Date.now()
    let win: Win32
    try {
      win = this.api()
    } catch (error) {
      return { ok: false, code: 'UNSUPPORTED', detail: String((error as Error)?.message ?? error) }
    }
    const handle = win.CreateFileW(
      path,
      GENERIC_READ,
      FILE_SHARE_READ,
      null,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      null
    )
    if (
      !handle ||
      this.ffi().address(handle) === INVALID_HANDLE ||
      this.ffi().address(handle) === 0n
    ) {
      // Absent, or someone holds it open for writing (or deleting) right now.
      return { ok: false, code: existsSync(path) ? 'EBUSY' : 'ENOENT' }
    }
    let keep = false
    try {
      const size = [0]
      if (!win.GetFileSizeEx(handle, size)) return { ok: false, code: 'EIO' }
      const length = Number(size[0])
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_HELPER_BYTES)
        return { ok: false, code: 'EIO', detail: 'size' }
      const buffer = Buffer.alloc(length)
      let offset = 0
      while (offset < length) {
        const read = [0]
        const chunk = Math.min(length - offset, 1 << 20)
        if (!win.ReadFile(handle, buffer.subarray(offset, offset + chunk), chunk, read, null))
          return { ok: false, code: 'EIO' }
        const got = Number(read[0])
        if (got <= 0) return { ok: false, code: 'EIO', detail: 'short read' }
        offset += got
      }
      const fileSha256 = createHash('sha256').update(buffer).digest('hex')
      const digest = stableDigest(buffer)
      const signed = peLayout(buffer)?.table != null
      this.release(id)
      const timer = setTimeout(() => {
        if (!this.holds.has(id)) return
        this.release(id)
        this.onExpire(id)
      }, this.maxHoldMs)
      timer.unref?.()
      this.holds.set(id, { path, handle, timer })
      keep = true
      return { ok: true, fileSha256, digest, signed, holdMs: Date.now() - started }
    } catch (error) {
      return { ok: false, code: 'EIO', detail: String((error as Error)?.message ?? error) }
    } finally {
      if (!keep) win.CloseHandle(handle)
    }
  }

  /** WinVerifyTrust on the held handle (asynchronous: it runs on a native thread). */
  trust(id: number): Promise<TrustReply> {
    const started = Date.now()
    const hold = this.holds.get(id)
    if (!hold) return Promise.resolve({ status: 'unavailable', reason: 'not held', ms: 0 })
    let win: Win32
    try {
      win = this.api()
    } catch (error) {
      return Promise.resolve({ status: 'unavailable', reason: String(error), ms: 0 })
    }
    const data: Record<string, unknown> = {
      cbStruct: this.ffi().sizeof(win.DataType),
      pPolicyCallbackData: null,
      pSIPClientData: null,
      dwUIChoice: WTD_UI_NONE,
      fdwRevocationChecks: WTD_REVOKE_NONE,
      dwUnionChoice: WTD_CHOICE_FILE,
      pFile: {
        cbStruct: this.ffi().sizeof(win.FileInfoType),
        pcwszFilePath: hold.path,
        hFile: hold.handle,
        pgKnownSubject: null
      },
      dwStateAction: WTD_STATEACTION_VERIFY,
      hWVTStateData: null,
      pwszURLReference: null,
      dwProvFlags: WTD_REVOCATION_CHECK_NONE | WTD_CACHE_ONLY_URL_RETRIEVAL,
      dwUIContext: 0,
      pSignatureSettings: null
    }
    return new Promise<TrustReply>((resolve) => {
      win.WinVerifyTrust.async(null, VERIFY_V2, data, (error: unknown, rc: number) => {
        const ms = Date.now() - started
        try {
          if (error) {
            resolve({ status: 'unavailable', reason: String(error), ms })
            return
          }
          const verdict = classifyTrustResult(rc)
          if (verdict.status !== 'valid') {
            resolve({ ...verdict, ms })
            return
          }
          const signer = this.signer(win, data.hWVTStateData)
          if (!signer) resolve({ status: 'unavailable', reason: 'signer unreadable', ms })
          else resolve({ status: 'valid', ...signer, ms })
        } catch (caught) {
          resolve({ status: 'unavailable', reason: String(caught), ms })
        } finally {
          if (data.hWVTStateData) {
            data.dwStateAction = WTD_STATEACTION_CLOSE
            try {
              win.WinVerifyTrust(null, VERIFY_V2, data)
            } catch {
              // The state is freed with the process at worst.
            }
          }
        }
      })
    })
  }

  private signer(
    win: Win32,
    state: unknown
  ): { subjectCn: string | null; thumbprint: string | null } | null {
    if (!state) return null
    const provider = win.ProvData(state)
    const signer = provider ? win.ProvSigner(provider, 0, 0, 0) : null
    const providerCert = signer ? win.ProvCert(signer, 0) : null
    // CRYPT_PROVIDER_CERT: { DWORD cbStruct; PCCERT_CONTEXT pCert; ... } (pCert at offset 8 on x64).
    const cert = providerCert ? this.ffi().decode(providerCert, 8, 'void *') : null
    if (!cert) return null
    const name = new Uint16Array(512)
    const count = Number(win.CertGetNameStringW(cert, CERT_NAME_ATTR_TYPE, 0, '2.5.4.3', name, 512))
    const subjectCn =
      count > 1 ? Buffer.from(name.buffer).toString('utf16le', 0, (count - 1) * 2) : null
    const hash = new Uint8Array(20)
    const size = [20]
    const thumbprint = win.CertGetProp(cert, CERT_SHA1_HASH_PROP_ID, hash, size)
      ? Buffer.from(hash.subarray(0, Number(size[0])))
          .toString('hex')
          .toUpperCase()
      : null
    return { subjectCn, thumbprint }
  }

  /** Whether the hold is still open. */
  held(id: number): boolean {
    return this.holds.has(id)
  }

  release(id: number): void {
    const hold = this.holds.get(id)
    if (!hold) return
    this.holds.delete(id)
    clearTimeout(hold.timer)
    try {
      this.api().CloseHandle(hold.handle)
    } catch {
      // Closed with the process at worst.
    }
  }

  releaseAll(): void {
    for (const id of [...this.holds.keys()]) this.release(id)
  }
}
