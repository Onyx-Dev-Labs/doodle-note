/**
 * Windows: is the Bark helper on disk the one this build shipped, and (when it is signed) signed by
 * the expected publisher? Checked lazily and asynchronously, immediately before EVERY spawn of the
 * helper (only once Bark is on), never at app startup and never blocking the main process.
 *
 * Policy:
 *  - The expected signing-invariant digest comes from the app itself (baked into the main bundle at
 *    build time, inside app.asar, covered by the app's own signature). The manifest beside the helper
 *    is used only by unpackaged dev runs.
 *  - Missing helper: absent. Unreadable helper, malformed or non-contiguous PE (see
 *    scripts/authenticode-digest.mjs), no expectation, or a digest mismatch: damaged (never ok).
 *  - The check runs in the Windows speech worker (windows-helper-check.ts), never in a PowerShell
 *    process: the worker opens the helper with writing, renaming and deleting denied and KEEPS the
 *    handle, hashes the bytes it read through that handle, verifies the signature with WinVerifyTrust
 *    on the same handle, and closes it only when the app releases the lease after the spawn (or when
 *    the worker ends; it dies with the app). The main process reads nothing by path while a hold works.
 *  - A file carrying a certificate table is verified. Definitive tampering (HashMismatch, a broken
 *    signature, or a Valid chain with the wrong signer CN or a thumbprint the build did not record) is
 *    damaged and persisted. A chain-trust failure (untrusted root, chaining, expiry, distrust), an
 *    unreadable signer or the 3 s budget running out is not proof of tampering: the digest (which
 *    matched) decides, nothing is persisted, and the signature is checked again at the next spawn.
 *  - A release whose build signed the helper (thumbprints recorded) must still be signed.
 *  - The lease is valid only while the hold is: if the worker ends (or the hold is lost) before the
 *    spawn, the check runs again with a fresh hold; locked is never reported unless the worker answers
 *    confirm() (asked after the spawn returns) with the hold still open. If no hold can be had within
 *    the budget (the worker cannot start), the file is hashed by path right before the spawn and the
 *    verdict says locked:false: a same-user writer could still swap it in that window (it could equally
 *    replace DoodleNote.exe in the per-user install; Application Control is the real boundary).
 *  - Verdicts are cached by a hash of the WHOLE file (certificate table included) together with the
 *    complete expectation (digest, CN, thumbprints), in memory and, when definitive, on disk.
 */
import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { peLayout as sharedPeLayout, stableDigest } from '../../scripts/authenticode-digest.mjs'
import {
  CONFIRM_BUDGET_MS,
  CONFIRM_CAP_MS,
  HOLD_EXPIRY_MS,
  SIGNATURE_BUDGET_MS
} from './helper-hold-timing'

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

/** What the holder read through its open handle. */
export type HeldHelperFacts =
  | { status: 'held'; fileSha256: string; digest: string | null; signed: boolean }
  | { status: 'absent' }
  | { status: 'unreadable'; code: string }

/** The helper file held open (write, rename, delete denied) by the speech worker. */
export interface HeldHelperLike {
  facts: HeldHelperFacts
  /** Signature check on the held handle. */
  trust(): Promise<SignatureCheck>
  /** Asks the holder: is the hold still open right now? False on any doubt (the holder ended). */
  confirm(): Promise<boolean>
  /** False as soon as the holder is known to have ended (no round trip). */
  alive(): boolean
  release(): void
}

/** Opens and holds the helper (WinEngineHost.holdHelper); injectable for tests. Rejects when it cannot. */
export type HelperHolder = (path: string) => Promise<HeldHelperLike>

/** A verdict for one spawn; confirm() after the spawn, then release() so the helper is unlocked. */
export interface HelperLease {
  verdict: HelperIntegrityVerdict
  /** The file is held (write/rename/delete denied) until release(), as long as confirm() says so. */
  locked: boolean
  /**
   * Ask after the spawn returns: true only when the holder still held the file then. A false answer
   * invalidates the lease: the caller ends what it spawned and acquires again.
   */
  confirm(): Promise<boolean>
  release(): void
  /**
   * The whole launch under this lease succeeded (spawned, confirmed, published, and the helper
   * answered its first status). Only this clears the count of lost holds; a confirmation alone
   * never does, so alternating pre-spawn successes and post-spawn losses still add up.
   */
  launched(): void
}

/** The publisher CN used when the build did not sign the helper (documented build arg). */
export const DEFAULT_HELPER_PUBLISHER_CN = 'Onyx Dev Labs LLC'
/** The budget for the signature verdict (once the file is held) before the digest decides. */
export { SIGNATURE_BUDGET_MS }
/**
 * The budget for the speech worker to answer the hold. It answers between its own tasks, and loading
 * the speech model blocks it for a few seconds (measured 4.7 s on Dev04), so this is longer than the
 * signature budget; past it the file is checked by path (locked:false).
 */
export const HOLD_BUDGET_MS = 10_000
/** A lease that is never released is ended after this long, so no hold lingers (the worker's own expiry). */
export const LEASE_MAX_MS = HOLD_EXPIRY_MS
/** After this many leases whose hold was lost before the spawn, the next check is digest-only. */
export const MAX_LOST_HOLDS = 2
/** In digest-only fallback, the held path is tried again on the next spawn after this long. */
export const HOLD_RETRY_COOLDOWN_MS = 60_000
/**
 * A "still held?" round trip answers in milliseconds when the worker is idle; its loop is blocked while
 * it loads a model or decodes (seconds). The answer is awaited in CONFIRM_BUDGET_MS steps up to
 * CONFIRM_CAP_MS (helper-hold-timing.ts). Only an answer counts: a worker that has not answered by
 * then leaves the lease unconfirmed (locked:false), and nothing is ended for a slow answer.
 */
export { CONFIRM_BUDGET_MS, CONFIRM_CAP_MS }

/**
 * PE layout facts the digest needs, fully validated; null for a malformed or non-contiguous image
 * (scripts/authenticode-digest.mjs, the one implementation shared with the build).
 */
export const peLayout = sharedPeLayout

/**
 * SHA-256 over the PE in the Authenticode hashing order (scripts/authenticode-digest.mjs):
 * identical before and after signing; any change to headers, sections or trailing data changes it.
 * Null for a malformed or non-contiguous image.
 */
export function stableHelperDigest(buffer: Buffer): string | null {
  return stableDigest(buffer)
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
  /** The speech worker's hold (WinEngineHost.holdHelper); null: digest-only checks (locked:false). */
  holder: HelperHolder | null
  /** Where definitive verdicts persist across launches; null keeps them in memory only. */
  cachePath: string | null
  budgetMs?: number
  holdBudgetMs?: number
  holdRetryCooldownMs?: number
  /** Tests: the confirmation's step and cap (CONFIRM_BUDGET_MS, CONFIRM_CAP_MS). */
  confirmBudgetMs?: number
  confirmCapMs?: number
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

/** Resolves with the promise's value, or with `fallback` once `ms` passes (`late` gets a late value). */
function within<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  late?: (value: T) => void
): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false
    const timer = setTimeout(
      () => {
        done = true
        resolve(fallback)
      },
      Math.max(0, ms)
    )
    promise.then(
      (value) => {
        if (done) {
          late?.(value)
          return
        }
        done = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

const NO_RELEASE = (): void => {}
const NO_LAUNCH = (): void => {}
const NOT_HELD = (): Promise<boolean> => Promise.resolve(false)

/** Where the bytes that were checked came from. */
type Source =
  | {
      kind: 'held'
      held: HeldHelperLike
      fileSha256: string
      digest: string | null
      signed: boolean
    }
  | { kind: 'path'; fileSha256: string; digest: string | null; signed: boolean }

/** Lazy, asynchronous, cached helper integrity; see the module comment for the policy. */
export class HelperIntegrity {
  private current: HelperIntegrityState = 'unchecked'
  private memo: CacheEntry | null = null
  private diskLoaded = false
  private disk: Record<string, CacheEntry> | null = null
  private readonly listeners = new Set<(state: HelperIntegrityState) => void>()
  /** Leases in a row whose hold was lost before the spawn (worker ended); see MAX_LOST_HOLDS. */
  private lostHolds = 0
  private lastLostAt = 0
  /** The branch that decided the last verdict, for diagnostics and evidence. */
  lastBranch: 'digest' | 'signature' | 'signature-unavailable' | 'none' = 'none'
  /**
   * Whether the helper's last check held the file (false: checked by path, digest only, or a hold
   * lost since). Shown in the Settings status row.
   */
  lastLocked = false
  /** Why the last check could not hold the file, when it could not (diagnostics). */
  lastUnlockedReason: string | null = null

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
   * Check immediately before a spawn. With a hold, the file stays held from before it is read until
   * the returned lease is released, which the caller does right after the spawn and confirm().
   * A hold that ends before this returns invalidates the result: the check runs again with a fresh
   * hold (once); then digest-only.
   */
  async acquire(): Promise<HelperLease> {
    if (this.current === 'unchecked') this.set('checking')
    let lease: HelperLease
    try {
      lease = await this.check(this.holdAllowed())
      if (lease.verdict === 'ok' && lease.locked && !this.stillHeld) {
        // The holder ended while the verdict was being reached: never hand out that lease.
        lease.release()
        this.noteLostHold('the hold ended before the verdict')
        lease = await this.check(this.holdAllowed())
      }
    } catch {
      lease = {
        verdict: 'damaged',
        locked: false,
        confirm: NOT_HELD,
        release: NO_RELEASE,
        launched: NO_LAUNCH
      }
    }
    this.set(lease.verdict)
    this.setLocked(lease.locked)
    return lease
  }

  /**
   * Whether this check may use the worker's hold: not after MAX_LOST_HOLDS losses in a row, until
   * HOLD_RETRY_COOLDOWN_MS has passed since the last one (then the held path is tried again).
   */
  private holdAllowed(): boolean {
    if (
      this.lostHolds >= MAX_LOST_HOLDS &&
      Date.now() - this.lastLostAt >= (this.options.holdRetryCooldownMs ?? HOLD_RETRY_COOLDOWN_MS)
    ) {
      this.log('trying the held check again after the cooldown')
      this.lostHolds = 0
    }
    return this.lostHolds < MAX_LOST_HOLDS
  }

  /** The Settings status row shows when the helper runs unheld; a change notifies like a state change. */
  private setLocked(locked: boolean): void {
    if (locked === this.lastLocked) return
    this.lastLocked = locked
    for (const listener of this.listeners) listener(this.current)
  }

  /**
   * The worker's answer to "still held?", waited for in CONFIRM_BUDGET_MS steps up to CONFIRM_CAP_MS:
   * a definite answer decides; a worker that ended (liveness) is a lost hold; a worker that is only
   * busy is waited for. A worker that has not answered by the cap does NOT confirm the hold (it may
   * have expired it): the spawn goes ahead unconfirmed, the lease reads locked:false and the Settings
   * row says so, and a late positive answer (the hold was still open then, so it never closed in
   * between) brings locked:true back. Never false because of a slow answer alone.
   */
  private async confirmHeld(holdOf: HeldHelperLike): Promise<'held' | 'lost' | 'unconfirmed'> {
    const started = Date.now()
    const cap = this.options.confirmCapMs ?? CONFIRM_CAP_MS
    const step = this.options.confirmBudgetMs ?? CONFIRM_BUDGET_MS
    // A failed round trip is a definite "not held" (never a reason to spin).
    const answer = holdOf.confirm().catch(() => false)
    const pending = Symbol('pending')
    let waited = false
    for (;;) {
      const result = await within<boolean | typeof pending>(answer, step, pending)
      if (result !== pending) {
        if (waited)
          this.log(
            `the busy speech worker answered the hold after ${Date.now() - started} ms (${result ? 'held' : 'not held'})`
          )
        return result ? 'held' : 'lost'
      }
      if (!holdOf.alive()) return 'lost'
      if (Date.now() - started >= cap) {
        this.log(
          `the speech worker has not answered for ${Date.now() - started} ms: the hold is unconfirmed (locked:false); the spawn goes ahead`
        )
        void answer.then((late) => {
          if (late && holdOf.alive()) {
            this.log(
              'the speech worker confirmed the hold late; it was held throughout (locked:true)'
            )
            this.setLocked(true)
          }
        })
        return 'unconfirmed'
      }
      if (!waited) this.log('the speech worker is busy; waiting for its answer (not a lost hold)')
      waited = true
    }
  }

  /** Set by check(): whether the hold behind the last lease is still alive. */
  private stillHeld = false

  private noteLostHold(reason: string): void {
    this.lostHolds++
    this.lastLostAt = Date.now()
    this.setLocked(false)
    this.log(`lease invalidated (${reason}); checking again`)
  }

  private set(state: HelperIntegrityState): void {
    if (state === this.current) return
    this.current = state
    for (const listener of this.listeners) listener(state)
  }

  private log(line: string): void {
    this.options.log?.(`helper integrity: ${line}`)
  }

  /** Hold and read through the worker; null when no hold can be had (then the caller reads by path). */
  private async hold(budget: () => number): Promise<HeldHelperLike | null> {
    const { holder, helperPath } = this.options
    if (!holder) {
      this.lastUnlockedReason = 'no holder'
      return null
    }
    let attempt: Promise<HeldHelperLike>
    try {
      attempt = holder(helperPath)
    } catch (error) {
      this.lastUnlockedReason = `holder failed (${String((error as Error)?.message ?? error)})`
      return null
    }
    type Outcome = { held: HeldHelperLike } | { error: unknown } | null
    const outcome = await within<Outcome>(
      attempt.then(
        (held) => ({ held }),
        (error: unknown) => ({ error })
      ),
      budget(),
      null,
      // Answered after the budget: let it go at once.
      (late) => {
        if (late && 'held' in late) late.held.release()
      }
    )
    if (!outcome) {
      this.lastUnlockedReason = 'the hold did not come within the budget'
      return null
    }
    if ('error' in outcome) {
      const error = outcome.error as Error | undefined
      this.lastUnlockedReason = `holder failed (${String(error?.message ?? error)})`
      return null
    }
    return outcome.held
  }

  private async check(useHolder: boolean): Promise<HelperLease> {
    const { helperPath } = this.options
    const budget = this.options.budgetMs ?? SIGNATURE_BUDGET_MS
    this.stillHeld = false
    this.lastUnlockedReason = null

    let source: Source | null = null
    const holdBudget = this.options.holdBudgetMs ?? HOLD_BUDGET_MS
    const holdStarted = Date.now()
    const held = useHolder ? await this.hold(() => holdBudget - (Date.now() - holdStarted)) : null
    // The signature's own budget starts once the file is held.
    const signatureStarted = Date.now()
    const signatureRemaining = (): number => budget - (Date.now() - signatureStarted)
    if (!useHolder)
      this.lastUnlockedReason = 'holds were lost repeatedly; digest only until the cooldown ends'
    if (held) {
      const facts = held.facts
      if (facts.status === 'absent') {
        held.release()
        return {
          verdict: 'absent',
          locked: false,
          confirm: NOT_HELD,
          release: NO_RELEASE,
          launched: NO_LAUNCH
        }
      }
      if (facts.status === 'unreadable') {
        held.release()
        this.log(`unreadable (${facts.code})`)
        return {
          verdict: 'damaged',
          locked: false,
          confirm: NOT_HELD,
          release: NO_RELEASE,
          launched: NO_LAUNCH
        }
      }
      source = { kind: 'held', held, ...facts }
    } else {
      // No hold: hash by path immediately before the spawn (locked:false, stated in the verdict).
      let buffer: Buffer
      try {
        buffer = await fs.readFile(helperPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
          return {
            verdict: 'absent',
            locked: false,
            confirm: NOT_HELD,
            release: NO_RELEASE,
            launched: NO_LAUNCH
          }
        this.log(`unreadable (${(error as NodeJS.ErrnoException)?.code ?? 'error'})`)
        return {
          verdict: 'damaged',
          locked: false,
          confirm: NOT_HELD,
          release: NO_RELEASE,
          launched: NO_LAUNCH
        }
      }
      this.log(`not held (${this.lastUnlockedReason ?? 'unknown'}); checked by path, locked:false`)
      source = {
        kind: 'path',
        fileSha256: createHash('sha256').update(buffer).digest('hex'),
        digest: stableHelperDigest(buffer),
        signed: peHasCertificateTable(buffer)
      }
    }

    let released = false
    let leaseTimer: NodeJS.Timeout | null = null
    const holdOf = source.kind === 'held' ? source.held : null
    const release = (): void => {
      if (released) return
      released = true
      if (leaseTimer) clearTimeout(leaseTimer)
      holdOf?.release()
    }
    const finish = (verdict: HelperIntegrityVerdict): HelperLease => {
      if (verdict !== 'ok' || !holdOf) {
        release()
        return {
          verdict,
          locked: false,
          confirm: NOT_HELD,
          release: NO_RELEASE,
          launched: NO_LAUNCH
        }
      }
      this.stillHeld = holdOf.alive()
      // Never let a forgotten lease keep the file held.
      leaseTimer = setTimeout(release, this.options.leaseMaxMs ?? LEASE_MAX_MS)
      leaseTimer.unref?.()
      const confirm = async (): Promise<boolean> => {
        if (released) return false
        if (!holdOf.alive()) {
          this.noteLostHold('the holder ended before the spawn returned')
          return false
        }
        const answer = await this.confirmHeld(holdOf)
        if (answer === 'lost') {
          this.noteLostHold('the hold was gone when the spawn returned')
          return false
        }
        if (answer === 'unconfirmed') {
          // Not a lost hold, and not a held one either: nothing is ended, but locked:true needs an answer.
          this.lastUnlockedReason = 'the speech worker did not confirm the hold in time'
          this.setLocked(false)
        }
        return true
      }
      const launched = (): void => {
        // Only a launch that went all the way through clears the count, and only on the held path
        // (a digest-only launch must not cut the cooldown short).
        if (this.lostHolds > 0) this.log('a held launch succeeded; lost holds reset')
        this.lostHolds = 0
      }
      return { verdict, locked: true, confirm, release, launched }
    }

    const expectation = this.options.expectation()
    if (!expectation) {
      this.log('no expected digest for this build')
      this.lastBranch = 'none'
      return finish('damaged')
    }
    if (!source.digest || source.digest !== expectation.digest) {
      this.log(source.digest ? 'digest mismatch' : 'not a valid (contiguous) PE image')
      this.lastBranch = 'digest'
      return finish('damaged')
    }
    const key = expectationKey(expectation)
    const cached = await this.cached(source.fileSha256, key)
    if (cached) {
      this.lastBranch = cached.branch
      return finish(cached.verdict)
    }
    if (!source.signed) {
      const verdict: HelperIntegrityVerdict = expectation.thumbprints.length > 0 ? 'damaged' : 'ok'
      if (verdict === 'damaged') this.log('the build signed the helper but this file is unsigned')
      this.lastBranch = 'digest'
      await this.remember(
        { fileSha256: source.fileSha256, expectation: key, verdict, branch: 'digest' },
        true
      )
      return finish(verdict)
    }
    const check: SignatureCheck = holdOf
      ? await within(holdOf.trust(), signatureRemaining(), {
          status: 'unavailable',
          reason: 'timeout'
        } as SignatureCheck)
      : { status: 'unavailable', reason: 'not held (no signature check by path)' }
    if (check.status === 'unavailable') {
      // Not proof of tampering: the digest (which matched) decides; nothing is persisted, so the
      // signature is checked again at the next spawn.
      this.log(`signature not verified (${check.reason}); digest matched`)
      this.lastBranch = 'signature-unavailable'
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
    await this.remember(
      { fileSha256: source.fileSha256, expectation: key, verdict, branch: 'signature' },
      true
    )
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
