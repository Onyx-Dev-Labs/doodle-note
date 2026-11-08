/**
 * The helper hold's timing, in one place for the app (helper-integrity.ts) and the speech worker
 * (windows-helper-check.ts), so that the worker never lets a hold expire inside a spawn path the app
 * still counts on.
 *
 * Worst case from the hold to the post-spawn confirmation: the signature check (its budget), the QA
 * hold pause (unpackaged test runs only, capped here), the pre-spawn confirmation (up to its cap), the
 * spawn itself, and the post-spawn confirmation (up to its cap). That must stay below the worker's hold
 * expiry; this module refuses to load otherwise. This is configured arithmetic, not a wall-clock bound
 * on process creation, IPC or the file system: the runtime safety net is that a confirmation not
 * answered within its cap leaves the lease unconfirmed (locked:false), see helper-integrity.ts.
 */

/** The worker closes a hold on its own after this long (a forgotten lease never keeps the file held). */
export const HOLD_EXPIRY_MS = 15_000
/** The budget for the signature verdict once the file is held. */
export const SIGNATURE_BUDGET_MS = 3_000
/** One "still held?" round trip step; the answer is awaited in steps of this. */
export const CONFIRM_BUDGET_MS = 250
/** The longest a confirmation waits for the worker's answer. */
export const CONFIRM_CAP_MS = 4_000
/** The QA-only pause between the hold and the spawn (DOODLENOTE_BARK_TEST_HOLD_PAUSE_MS) is capped at this. */
export const MAX_QA_HOLD_PAUSE_MS = 2_500
/** Allowance for creating the helper process between the two confirmations. */
export const SPAWN_ALLOWANCE_MS = 1_000

/** The worst case from the hold to the post-spawn confirmation's end. */
export function worstHoldToConfirmMs(
  timing: {
    signature: number
    qaPause: number
    confirmCap: number
    spawn: number
  } = {
    signature: SIGNATURE_BUDGET_MS,
    qaPause: MAX_QA_HOLD_PAUSE_MS,
    confirmCap: CONFIRM_CAP_MS,
    spawn: SPAWN_ALLOWANCE_MS
  }
): number {
  return timing.signature + timing.qaPause + 2 * timing.confirmCap + timing.spawn
}

/** The QA hold pause from the environment, bounded by MAX_QA_HOLD_PAUSE_MS (0 when absent or invalid). */
export function qaHoldPauseMs(raw: string | undefined): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), MAX_QA_HOLD_PAUSE_MS) : 0
}

/** Null when the timing is consistent, else why not. */
export function holdTimingProblem(
  expiry = HOLD_EXPIRY_MS,
  worst = worstHoldToConfirmMs()
): string | null {
  return worst < expiry
    ? null
    : `the helper hold could expire (${expiry} ms) before its spawn path is confirmed (${worst} ms worst case)`
}

const problem = holdTimingProblem()
if (problem) throw new Error(problem)
