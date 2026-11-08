/**
 * Windows: is the Bark helper on disk the one this build shipped, and (when it is signed) signed by
 * the expected publisher? Checked lazily and asynchronously, immediately before the helper is
 * spawned (only once Bark is on), never at app startup and never blocking the main process.
 *
 * Policy:
 *  - The expected signing-invariant digest comes from the app itself (baked into the main bundle at
 *    build time, inside app.asar, covered by the app's own signature). The manifest beside the helper
 *    is used only by unpackaged dev runs, so a replaced helper plus a regenerated manifest is not
 *    trusted in a packaged build.
 *  - Missing helper: absent. Unreadable helper, malformed PE, no expectation, or a digest mismatch:
 *    damaged (never ok).
 *  - A file carrying a certificate table must pass Authenticode verification (win-authenticode.ts:
 *    signature and chain to a trusted root) with the exact expected signer common name and, when
 *    the build recorded them, one of its thumbprints; a definitive failure is damaged. When the
 *    verifier itself is unavailable (PowerShell missing or blocked, an error) or exceeds its 3 s
 *    budget, the result falls back to the digest (fail open; the digest still has to match).
 *  - A release whose build signed the helper (thumbprints recorded) must still be signed.
 *  - Verdicts are cached per file (path + size + mtime + digest) in memory and, when definitive, on
 *    disk, so the signature check runs once per install, and is re-run whenever the file changes.
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

export type SignatureVerifier = (path: string) => Promise<SignatureCheck>

/** The publisher CN used when the build did not sign the helper (documented build arg). */
export const DEFAULT_HELPER_PUBLISHER_CN = 'Onyx Dev Labs LLC'
/** The signature check's budget before falling back to the digest. */
export const SIGNATURE_BUDGET_MS = 3_000

interface PeLayout {
  checksumOffset: number
  secEntry: number
  table: { va: number; size: number } | null
}

/** PE layout facts the digest needs, validated; null for a malformed image. */
export function peLayout(buffer: Buffer): PeLayout | null {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null
  const pe = buffer.readUInt32LE(0x3c)
  if (pe < 0x40 || pe + 24 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return null
  const sizeOfOptional = buffer.readUInt16LE(pe + 20)
  const optional = pe + 24
  if (optional + 2 > buffer.length) return null
  const magic = buffer.readUInt16LE(optional)
  if (magic !== 0x10b && magic !== 0x20b) return null
  const countOffset = optional + (magic === 0x20b ? 108 : 92)
  const dataDir = optional + (magic === 0x20b ? 112 : 96)
  const checksumOffset = optional + 64
  const secEntry = dataDir + 4 * 8
  if (secEntry + 8 > optional + sizeOfOptional || secEntry + 8 > buffer.length) return null
  if (buffer.readUInt32LE(countOffset) < 5) return null
  const certVa = buffer.readUInt32LE(secEntry)
  const certSize = buffer.readUInt32LE(secEntry + 4)
  let table: PeLayout['table'] = null
  if (certVa !== 0 || certSize !== 0) {
    if (certVa === 0 || certSize === 0) return null
    if (certVa % 8 !== 0 || certVa < secEntry + 8 || certVa + certSize > buffer.length) return null
    table = { va: certVa, size: certSize }
  }
  return { checksumOffset, secEntry, table }
}

/**
 * SHA-256 over the PE following the Authenticode exclusion rules: the CheckSum, the certificate
 * table directory entry and the certificate table itself are excluded; bytes after the table are
 * hashed; an unsigned file is hashed with the zero padding to 8 bytes that signing adds. The value
 * is therefore identical before and after signing, and any other change (including trailing bytes
 * appended to a signed file) changes it. Null for a malformed image. Twin of
 * scripts/authenticode-digest.cjs (kept in agreement by helper-integrity.test.ts).
 */
export function stableHelperDigest(buffer: Buffer): string | null {
  try {
    const layout = peLayout(buffer)
    if (!layout) return null
    const { checksumOffset, secEntry, table } = layout
    const hash = createHash('sha256')
    hash.update(buffer.subarray(0, checksumOffset))
    hash.update(buffer.subarray(checksumOffset + 4, secEntry))
    if (table) {
      hash.update(buffer.subarray(secEntry + 8, table.va))
      hash.update(buffer.subarray(table.va + table.size))
    } else {
      hash.update(buffer.subarray(secEntry + 8))
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
  size: number
  mtimeMs: number
  digest: string
  verdict: HelperIntegrityVerdict
  /** Which branch decided: digest only, or the signature as well. */
  branch: 'digest' | 'signature'
}

export interface HelperIntegrityOptions {
  helperPath: string
  /** Re-read on each check so a dev rebuild is picked up. */
  expectation: () => HelperExpectation | null
  verify: SignatureVerifier
  /** Where definitive verdicts persist across launches; null keeps them in memory only. */
  cachePath: string | null
  budgetMs?: number
  log?: (line: string) => void
}

/** Lazy, asynchronous, cached helper integrity; see the module comment for the policy. */
export class HelperIntegrity {
  private current: HelperIntegrityState = 'unchecked'
  private inflight: Promise<HelperIntegrityVerdict> | null = null
  private memo: CacheEntry | null = null
  private diskLoaded = false
  private readonly listeners = new Set<(state: HelperIntegrityState) => void>()
  /** The branch that decided the last verdict, for diagnostics and evidence. */
  lastBranch: 'digest' | 'signature' | 'signature-unavailable' | 'none' = 'none'

  constructor(private readonly options: HelperIntegrityOptions) {}

  state(): HelperIntegrityState {
    return this.current
  }

  onChange(listener: (state: HelperIntegrityState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Check now (or join the check in flight). Called immediately before every spawn: the file is
   * re-read and re-hashed each time, and the signature is re-verified whenever path, size, mtime
   * or digest differ from the cached verdict.
   */
  ensure(): Promise<HelperIntegrityVerdict> {
    if (this.inflight) return this.inflight
    const run = this.check().then(
      (verdict) => {
        this.inflight = null
        this.set(verdict)
        return verdict
      },
      () => {
        this.inflight = null
        this.set('damaged')
        return 'damaged' as const
      }
    )
    this.inflight = run
    if (this.current === 'unchecked') this.set('checking')
    return run
  }

  private set(state: HelperIntegrityState): void {
    if (state === this.current) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private log(line: string): void {
    this.options.log?.(`helper integrity: ${line}`)
  }

  private async check(): Promise<HelperIntegrityVerdict> {
    const { helperPath } = this.options
    let size: number
    let mtimeMs: number
    let buffer: Buffer
    try {
      const stat = await fs.stat(helperPath)
      size = stat.size
      mtimeMs = stat.mtimeMs
      buffer = await fs.readFile(helperPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 'absent'
      this.log(`unreadable (${(error as NodeJS.ErrnoException)?.code ?? 'error'})`)
      return 'damaged'
    }
    const expectation = this.options.expectation()
    if (!expectation) {
      this.log('no expected digest for this build')
      this.lastBranch = 'none'
      return 'damaged'
    }
    const digest = stableHelperDigest(buffer)
    if (!digest || digest !== expectation.digest) {
      this.log(digest ? 'digest mismatch' : 'not a valid PE image')
      this.lastBranch = 'digest'
      return 'damaged'
    }
    const cached = await this.cached(size, mtimeMs, digest)
    if (cached) {
      this.lastBranch = cached.branch
      return cached.verdict
    }
    const signed = peHasCertificateTable(buffer)
    if (!signed) {
      // A build that signed its helper must ship it signed.
      const verdict: HelperIntegrityVerdict = expectation.thumbprints.length > 0 ? 'damaged' : 'ok'
      if (verdict === 'damaged') this.log('the build signed the helper but this file is unsigned')
      this.lastBranch = 'digest'
      await this.remember({ size, mtimeMs, digest, verdict, branch: 'digest' }, true)
      return verdict
    }
    const check = await this.verifyWithBudget(helperPath)
    if (check.status === 'unavailable') {
      // Fail open to the digest (which matched): never turn a signed release off because the
      // verifier could not run. Not persisted, so the next launch tries again.
      this.log(`signature check unavailable (${check.reason}); digest matched`)
      this.lastBranch = 'signature-unavailable'
      await this.remember({ size, mtimeMs, digest, verdict: 'ok', branch: 'digest' }, false)
      return 'ok'
    }
    let verdict: HelperIntegrityVerdict = 'ok'
    if (check.status === 'invalid') {
      this.log(`signature invalid (${check.code})`)
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
    await this.remember({ size, mtimeMs, digest, verdict, branch: 'signature' }, true)
    return verdict
  }

  private async verifyWithBudget(path: string): Promise<SignatureCheck> {
    const budget = this.options.budgetMs ?? SIGNATURE_BUDGET_MS
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<SignatureCheck>((resolve) => {
      // Not unref'd: it is always cleared in finally, and it must fire even when nothing else is pending.
      timer = setTimeout(() => resolve({ status: 'unavailable', reason: 'timeout' }), budget)
    })
    try {
      return await Promise.race([
        this.options.verify(path).catch((error: unknown): SignatureCheck => ({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'error'
        })),
        timeout
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private matches(
    entry: CacheEntry | undefined | null,
    size: number,
    mtimeMs: number,
    digest: string
  ): boolean {
    return !!entry && entry.size === size && entry.mtimeMs === mtimeMs && entry.digest === digest
  }

  private async cached(size: number, mtimeMs: number, digest: string): Promise<CacheEntry | null> {
    if (this.matches(this.memo, size, mtimeMs, digest)) return this.memo
    const { cachePath, helperPath } = this.options
    if (!cachePath || this.diskLoaded) return null
    this.diskLoaded = true
    try {
      const all = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, CacheEntry>
      const entry = all[helperPath]
      if (entry && this.matches(entry, size, mtimeMs, digest)) {
        this.memo = entry
        return entry
      }
    } catch {
      // No cache yet, or unreadable: verify afresh.
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
      await fs.writeFile(cachePath, JSON.stringify(all))
    } catch {
      // Best-effort: the in-memory verdict still applies for this launch.
    }
  }
}
