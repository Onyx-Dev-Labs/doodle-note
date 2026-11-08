/**
 * Windows: is the Bark helper on disk the one this build shipped, and (when it is signed) signed by
 * the expected publisher? Checked lazily and asynchronously, immediately before EVERY spawn of the
 * helper (only once Bark is on), never at app startup and never blocking the main process.
 *
 * Policy:
 *  - The expected signing-invariant digest comes from the app itself (baked into the main bundle at
 *    build time, inside app.asar, covered by the app's own signature). The manifest beside the helper
 *    is used only by unpackaged dev runs.
 *  - Missing helper: absent. Unreadable helper, malformed PE (see peLayout), no expectation, or a
 *    digest mismatch: damaged (never ok).
 *  - A file carrying a certificate table is verified (win-authenticode.ts). Definitive tampering
 *    (HashMismatch, a broken signature, or a Valid chain with the wrong signer CN or a thumbprint the
 *    build did not record) is damaged and persisted. A chain-trust failure (NotTrusted/UnknownError,
 *    e.g. an offline image missing the root), an unavailable verifier, or the 3 s budget running out
 *    is not proof of tampering: the digest (which matched) decides, nothing is persisted, and the
 *    signature is checked again at the next spawn.
 *  - A release whose build signed the helper (thumbprints recorded) must still be signed.
 *  - Launch race: the verifier process holds the helper open with writing, renaming and deleting
 *    denied while the app hashes it and spawns it, and releases it only after the spawn (acquire()
 *    returns a lease). Where PowerShell cannot run (blocked, missing, too slow) there is no lock: the
 *    file is hashed immediately before the spawn and a same-user writer could still swap it in that
 *    window. That writer could equally replace DoodleNote.exe in the per-user install; Application
 *    Control is the real boundary against same-user tampering.
 *  - Verdicts are cached by a hash of the WHOLE file (certificate table included) together with the
 *    complete expectation (digest, CN, thumbprints), in memory and, when definitive, on disk.
 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type HelperIntegrityState = 'unchecked' | 'checking' | 'ok' | 'damaged' | 'absent'
export type HelperIntegrityVerdict = 'ok' | 'damaged' | 'absent'

export interface HelperExpectation {
  /** The signing-invariant digest (see stableHelperDigest). */
  digest: string
  /** Exact signer common name required when the helper is signed. */
  publisherCn: string | null
  /** Signer certificate thumbprints recorded when the build signed the helper; empty when unsigned. */
  thumbprints: string[]
}

export type SignatureCheck =
  | { status: 'valid'; subjectCn: string | null; thumbprint: string | null }
  | { status: 'invalid'; code: string }
  | { status: 'unavailable'; reason: string }

/** Starts the lock-and-verify process (win-authenticode.ts startVerifier); injectable for tests. */
export type VerifierFactory = (path: string) => VerifierSessionLike

export interface VerifierSessionLike {
  locked: Promise<boolean>
  check(verify: boolean): Promise<SignatureCheck>
  release(): void
  kill(): void
}

/** A verdict for one spawn; release() after the spawn so the helper file is unlocked. */
export interface HelperLease {
  verdict: HelperIntegrityVerdict
  /** Whether the file is held locked (write/rename/delete denied) until release(). */
  locked: boolean
  release(): void
}

/** The publisher CN used when the build did not sign the helper (documented build arg). */
export const DEFAULT_HELPER_PUBLISHER_CN = 'Onyx Dev Labs LLC'
/** The verifier's budget (lock + verdict) before it is ended and the digest decides. */
export const SIGNATURE_BUDGET_MS = 3_000
/** A lease that is never released is ended after this long, so no verifier process lingers. */
export const LEASE_MAX_MS = 15_000

interface PeLayout {
  checksumOffset: number
  secEntry: number
  sizeOfHeaders: number
  /** Sections with raw data, sorted by file offset. */
  sections: Array<{ pointer: number; size: number }>
  /** End of the last section's raw data (or of the headers). */
  sectionsEnd: number
  table: { va: number; size: number } | null
}

const MAX_SECTIONS = 96

/**
 * PE layout facts the digest needs, fully validated; null for a malformed image. The section table
 * must lie inside SizeOfHeaders, every section's raw range inside the file after the headers, the
 * sections must not overlap, and the certificate table must start at or after the end of the last
 * section (8-aligned, inside the file), so it can never cover headers or section data.
 */
export function peLayout(buffer: Buffer): PeLayout | null {
  const length = buffer.length
  if (length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null
  const pe = buffer.readUInt32LE(0x3c)
  if (pe < 0x40 || pe + 24 > length || buffer.readUInt32LE(pe) !== 0x00004550) return null
  const sectionCount = buffer.readUInt16LE(pe + 6)
  const sizeOfOptional = buffer.readUInt16LE(pe + 20)
  if (sectionCount === 0 || sectionCount > MAX_SECTIONS) return null
  const optional = pe + 24
  if (optional + sizeOfOptional > length || sizeOfOptional < 2) return null
  const magic = buffer.readUInt16LE(optional)
  if (magic !== 0x10b && magic !== 0x20b) return null
  const countOffset = optional + (magic === 0x20b ? 108 : 92)
  const dataDir = optional + (magic === 0x20b ? 112 : 96)
  const checksumOffset = optional + 64
  const secEntry = dataDir + 4 * 8
  if (secEntry + 8 > optional + sizeOfOptional) return null
  if (buffer.readUInt32LE(countOffset) < 5) return null
  const sizeOfHeaders = buffer.readUInt32LE(optional + 60)
  const sectionTable = optional + sizeOfOptional
  const sectionTableEnd = sectionTable + 40 * sectionCount
  if (sectionTableEnd > length || sizeOfHeaders < sectionTableEnd || sizeOfHeaders > length)
    return null
  const sections: PeLayout['sections'] = []
  for (let i = 0; i < sectionCount; i++) {
    const base = sectionTable + 40 * i
    const size = buffer.readUInt32LE(base + 16)
    const pointer = buffer.readUInt32LE(base + 20)
    if (size === 0) continue
    if (pointer < sizeOfHeaders || pointer + size > length) return null
    sections.push({ pointer, size })
  }
  sections.sort((a, b) => a.pointer - b.pointer)
  for (let i = 1; i < sections.length; i++) {
    const previous = sections[i - 1]!
    if (previous.pointer + previous.size > sections[i]!.pointer) return null
  }
  const last = sections[sections.length - 1]
  const sectionsEnd = last ? last.pointer + last.size : sizeOfHeaders
  const certVa = buffer.readUInt32LE(secEntry)
  const certSize = buffer.readUInt32LE(secEntry + 4)
  let table: PeLayout['table'] = null
  if (certVa !== 0 || certSize !== 0) {
    if (certVa === 0 || certSize === 0) return null
    if (
      certVa % 8 !== 0 ||
      certVa < sectionsEnd ||
      certVa < sizeOfHeaders ||
      certVa + certSize > length
    )
      return null
    table = { va: certVa, size: certSize }
  }
  return { checksumOffset, secEntry, sizeOfHeaders, sections, sectionsEnd, table }
}

/**
 * SHA-256 over the PE in the Authenticode hashing order: the headers without the CheckSum and the
 * certificate table directory entry; each section's raw data by file offset; then the data after the
 * last section without the certificate table (bytes after the table are hashed; an unsigned file is
 * hashed with the zero padding to 8 bytes that signing adds). Identical before and after signing;
 * any change to headers, sections or trailing data changes it. Null for a malformed image (see
 * peLayout). Twin of scripts/authenticode-digest.cjs (kept in agreement by helper-integrity.test.ts).
 */
export function stableHelperDigest(buffer: Buffer): string | null {
  try {
    const layout = peLayout(buffer)
    if (!layout) return null
    const { checksumOffset, secEntry, sizeOfHeaders, sections, sectionsEnd, table } = layout
    const hash = createHash('sha256')
    hash.update(buffer.subarray(0, checksumOffset))
    hash.update(buffer.subarray(checksumOffset + 4, secEntry))
    hash.update(buffer.subarray(secEntry + 8, sizeOfHeaders))
    for (const section of sections)
      hash.update(buffer.subarray(section.pointer, section.pointer + section.size))
    if (table) {
      hash.update(buffer.subarray(sectionsEnd, table.va))
      hash.update(buffer.subarray(table.va + table.size))
    } else {
      hash.update(buffer.subarray(sectionsEnd))
      const pad = (8 - (buffer.length % 8)) % 8
      if (pad) hash.update(Buffer.alloc(pad))
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

/** Whether a PE carries an Authenticode certificate table (false for malformed images too). */
export function peHasCertificateTable(buffer: Buffer): boolean {
  try {
    return peLayout(buffer)?.table != null
  } catch {
    return false
  }
}

function asExpectation(value: unknown): HelperExpectation | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const digest = record.digest ?? record.authenticodeSha256
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return null
  const thumbprints = Array.isArray(record.thumbprints)
    ? record.thumbprints
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toUpperCase())
    : []
  return {
    digest,
    publisherCn: typeof record.publisherCn === 'string' ? record.publisherCn : null,
    thumbprints
  }
}

declare const __DOODLENOTE_HELPER_INTEGRITY__: unknown

/** The expectation baked into this build's main bundle, or null (dev builds without a helper). */
export function bakedHelperExpectation(): HelperExpectation | null {
  try {
    return typeof __DOODLENOTE_HELPER_INTEGRITY__ === 'undefined'
      ? null
      : asExpectation(__DOODLENOTE_HELPER_INTEGRITY__)
  } catch {
    return null
  }
}

/**
 * What the helper must match. Packaged: only the baked value (the external manifest is ignored).
 * Unpackaged dev run: the manifest beside the helper (rebuilt with it), else the baked value.
 */
export function resolveHelperExpectation(
  helperPath: string,
  packaged: boolean,
  baked: HelperExpectation | null = bakedHelperExpectation()
): HelperExpectation | null {
  if (packaged) return baked
  const manifestPath = join(dirname(helperPath), 'dictation-helper.manifest.json')
  if (existsSync(manifestPath)) {
    try {
      return asExpectation(JSON.parse(readFileSync(manifestPath, 'utf8')))
    } catch {
      return null
    }
  }
  return baked
}

interface CacheEntry {
  /** SHA-256 of the whole file, certificate table included. */
  fileSha256: string
  /** The complete expectation the verdict was reached under. */
  expectation: string
  verdict: HelperIntegrityVerdict
  /** Which branch decided: digest only, or the signature as well. */
  branch: 'digest' | 'signature'
}

export interface HelperIntegrityOptions {
  helperPath: string
  /** Re-read on each check so a dev rebuild is picked up. */
  expectation: () => HelperExpectation | null
  verifier: VerifierFactory
  /** Where definitive verdicts persist across launches; null keeps them in memory only. */
  cachePath: string | null
  budgetMs?: number
  leaseMaxMs?: number
  log?: (line: string) => void
}

function expectationKey(expectation: HelperExpectation): string {
  return JSON.stringify({
    digest: expectation.digest,
    publisherCn: expectation.publisherCn,
    thumbprints: [...expectation.thumbprints].sort()
  })
}

/** Resolves with the promise's value, or with `fallback` once `ms` passes. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), Math.max(0, ms))
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

const NO_RELEASE = (): void => {}

/** Lazy, asynchronous, cached helper integrity; see the module comment for the policy. */
export class HelperIntegrity {
  private current: HelperIntegrityState = 'unchecked'
  private memo: CacheEntry | null = null
  private diskLoaded = false
  private disk: Record<string, CacheEntry> | null = null
  private readonly listeners = new Set<(state: HelperIntegrityState) => void>()
  /** The branch that decided the last verdict, for diagnostics and evidence. */
  lastBranch: 'digest' | 'signature' | 'signature-unavailable' | 'none' = 'none'
  /** Whether the last verdict was reached while the verifier held the file locked. */
  lastLocked = false

  constructor(private readonly options: HelperIntegrityOptions) {}

  state(): HelperIntegrityState {
    return this.current
  }

  onChange(listener: (state: HelperIntegrityState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Check without spawning (the lease is released at once). */
  async ensure(): Promise<HelperIntegrityVerdict> {
    const lease = await this.acquire()
    lease.release()
    return lease.verdict
  }

  /**
   * Check immediately before a spawn. The file is (when PowerShell can run) held locked from before
   * it is read until the returned lease is released, which the caller does right after the spawn.
   */
  async acquire(): Promise<HelperLease> {
    if (this.current === 'unchecked') this.set('checking')
    let lease: HelperLease
    try {
      lease = await this.check()
    } catch {
      lease = { verdict: 'damaged', locked: false, release: NO_RELEASE }
    }
    this.lastLocked = lease.locked
    this.set(lease.verdict)
    return lease
  }

  private set(state: HelperIntegrityState): void {
    if (state === this.current) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private log(line: string): void {
    this.options.log?.(`helper integrity: ${line}`)
  }

  private async check(): Promise<HelperLease> {
    const { helperPath } = this.options
    const budget = this.options.budgetMs ?? SIGNATURE_BUDGET_MS
    const started = Date.now()
    const remaining = (): number => budget - (Date.now() - started)

    // Lock first, read second: the bytes hashed below are the bytes that will be spawned.
    let session: VerifierSessionLike | null = null
    let locked = false
    try {
      session = this.options.verifier(helperPath)
      locked = await within(session.locked, remaining(), false)
    } catch {
      locked = false
    }
    if (!locked && session) {
      session.kill()
      session = null
    }
    let released = false
    let leaseTimer: NodeJS.Timeout | null = null
    const release = (): void => {
      if (released) return
      released = true
      if (leaseTimer) clearTimeout(leaseTimer)
      session?.release()
    }
    const finish = (verdict: HelperIntegrityVerdict): HelperLease => {
      if (verdict !== 'ok' || !session) {
        release()
        return { verdict, locked: false, release: NO_RELEASE }
      }
      // Never let a forgotten lease keep the verifier (and the lock) alive.
      leaseTimer = setTimeout(() => {
        released = true
        session?.kill()
      }, this.options.leaseMaxMs ?? LEASE_MAX_MS)
      leaseTimer.unref?.()
      return { verdict, locked: true, release }
    }

    let buffer: Buffer
    try {
      buffer = await fs.readFile(helperPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return finish('absent')
      this.log(`unreadable (${(error as NodeJS.ErrnoException)?.code ?? 'error'})`)
      return finish('damaged')
    }
    const expectation = this.options.expectation()
    if (!expectation) {
      this.log('no expected digest for this build')
      this.lastBranch = 'none'
      return finish('damaged')
    }
    const digest = stableHelperDigest(buffer)
    if (!digest || digest !== expectation.digest) {
      this.log(digest ? 'digest mismatch' : 'not a valid PE image')
      this.lastBranch = 'digest'
      return finish('damaged')
    }
    const fileSha256 = createHash('sha256').update(buffer).digest('hex')
    const key = expectationKey(expectation)
    const signed = peHasCertificateTable(buffer)
    const cached = await this.cached(fileSha256, key)
    if (cached) {
      this.lastBranch = cached.branch
      if (session) await within(session.check(false), remaining(), null)
      return finish(cached.verdict)
    }
    if (!signed) {
      const verdict: HelperIntegrityVerdict = expectation.thumbprints.length > 0 ? 'damaged' : 'ok'
      if (verdict === 'damaged') this.log('the build signed the helper but this file is unsigned')
      this.lastBranch = 'digest'
      if (session) await within(session.check(false), remaining(), null)
      await this.remember({ fileSha256, expectation: key, verdict, branch: 'digest' }, true)
      return finish(verdict)
    }
    const check: SignatureCheck = session
      ? await within(session.check(true), remaining(), {
          status: 'unavailable',
          reason: 'timeout'
        } as SignatureCheck)
      : { status: 'unavailable', reason: 'verifier not running' }
    if (check.status === 'unavailable') {
      // Not proof of tampering: the digest (which matched) decides; nothing is persisted, so the
      // signature is checked again at the next spawn. A verifier past its budget is ended.
      this.log(`signature not verified (${check.reason}); digest matched`)
      this.lastBranch = 'signature-unavailable'
      if (check.reason === 'timeout' && session) {
        session.kill()
        session = null
      }
      return finish('ok')
    }
    let verdict: HelperIntegrityVerdict = 'ok'
    if (check.status === 'invalid') {
      this.log(`signature broken (${check.code})`)
      verdict = 'damaged'
    } else if (!expectation.publisherCn || check.subjectCn !== expectation.publisherCn) {
      this.log(`unexpected signer "${check.subjectCn ?? ''}"`)
      verdict = 'damaged'
    } else if (
      expectation.thumbprints.length > 0 &&
      !expectation.thumbprints.includes((check.thumbprint ?? '').toUpperCase())
    ) {
      this.log('signer certificate is not one this build used')
      verdict = 'damaged'
    }
    this.lastBranch = 'signature'
    await this.remember({ fileSha256, expectation: key, verdict, branch: 'signature' }, true)
    return finish(verdict)
  }

  private async cached(fileSha256: string, key: string): Promise<CacheEntry | null> {
    const match = (entry: CacheEntry | null | undefined): entry is CacheEntry =>
      !!entry && entry.fileSha256 === fileSha256 && entry.expectation === key
    if (match(this.memo)) return this.memo
    const { cachePath, helperPath } = this.options
    if (!cachePath) return null
    if (!this.diskLoaded) {
      this.diskLoaded = true
      try {
        this.disk = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, CacheEntry>
      } catch {
        this.disk = null
      }
    }
    const entry = this.disk?.[helperPath]
    if (match(entry)) {
      this.memo = entry
      return entry
    }
    return null
  }

  private async remember(entry: CacheEntry, persist: boolean): Promise<void> {
    this.memo = entry
    const { cachePath, helperPath } = this.options
    if (!persist || !cachePath) return
    try {
      let all: Record<string, CacheEntry> = {}
      try {
        all = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, CacheEntry>
      } catch {
        all = {}
      }
      all[helperPath] = entry
      this.disk = all
      await fs.writeFile(cachePath, JSON.stringify(all))
    } catch {
      // Best-effort: the in-memory verdict still applies for this launch.
    }
  }
}
