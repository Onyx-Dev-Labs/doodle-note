/**
 * The helper hold's timing, in one place for the app (helper-integrity.ts) and the speech worker
 * (windows-helper-check.ts), so that the worker never lets a hold expire inside a spawn path the app
 * still counts on.
 *
 * Worst case from the hold to the post-spawn confirmation: the signature check (its budget), the
 * pre-spawn confirmation (up to its cap), the spawn itself, and the post-spawn confirmation (up to
 * its cap). That must stay below the worker's hold expiry; this module refuses to load otherwise.
 * The cap does not make a hold "confirmed": a confirmation that is not answered within it leaves the
 * lease unconfirmed (locked:false), see helper-integrity.ts.
 */

/** The worker closes a hold on its own after this long (a forgotten lease never keeps the file held). */
export const HOLD_EXPIRY_MS = 15_000
/** The budget for the signature verdict once the file is held. */
export const SIGNATURE_BUDGET_MS = 3_000
/** One "still held?" round trip step; the answer is awaited in steps of this. */
export const CONFIRM_BUDGET_MS = 250
/** The longest a confirmation waits for the worker's answer. */
export const CONFIRM_CAP_MS = 5_000
/** Allowance for creating the helper process between the two confirmations. */
export const SPAWN_ALLOWANCE_MS = 1_000

/** The worst case from the hold to the post-spawn confirmation's end. */
export function worstHoldToConfirmMs(
  timing: {
    signature: number
    confirmCap: number
    spawn: number
  } = { signature: SIGNATURE_BUDGET_MS, confirmCap: CONFIRM_CAP_MS, spawn: SPAWN_ALLOWANCE_MS }
): number {
  return timing.signature + 2 * timing.confirmCap + timing.spawn
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
