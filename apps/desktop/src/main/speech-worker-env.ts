import type { AppChannel } from '../shared/app-channel'

/**
 * The speech worker's environment. QA hooks reach it only where they are meant to:
 *  - Bark's (DOODLENOTE_BARK_TEST_*) only in an unpackaged run with DOODLENOTE_BARK_TEST_HOOKS=1;
 *  - the ASR backlog hook (DOODLENOTE_ASR_TEST_*, the documented packaged meeting smoke) only
 *    unpackaged or in a dev-channel package, never in a production-channel one;
 *  - DICTATION_HELPER_* never (they are the helper's, not the worker's).
 * Everything else is passed through unchanged.
 */
export function speechWorkerEnv(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  channel: AppChannel | string
): NodeJS.ProcessEnv {
  const barkHooks = !packaged && env.DOODLENOTE_BARK_TEST_HOOKS === '1'
  const asrHooks = !packaged || channel === 'dev'
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (/^DICTATION_HELPER_/i.test(key)) continue
    if (/^DOODLENOTE_BARK_TEST_/i.test(key) && !barkHooks) continue
    if (/^DOODLENOTE_ASR_TEST_/i.test(key) && !asrHooks) continue
    out[key] = value
  }
  return out
}

/**
 * A QA stall from the environment, validated and bounded: a finite whole number of milliseconds in
 * (0, cap], else 0 (no stall). An absurd value can never block the worker for long.
 */
export function boundedTestStallMs(raw: string | undefined, cap: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return 0
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, cap) : 0
}

/** The caps: a model load is seconds, a test backlog well under a minute. */
export const MAX_CONFIRM_STALL_MS = 10_000
export const MAX_ASR_STALL_MS = 30_000

/**
 * The identity whose registry values the worker may touch (windows-registry.ts appRegistryScope),
 * passed on its command line by the process that forks it (engine-host-win.ts): never read from
 * the environment (inherited) or from a message. The worker module itself carries no identity, so
 * engine-win.js is byte-identical in every identity's package (test-windows-package.cjs parity).
 */
const WORKER_IDENTITY_ARG = '--doodlenote-registry-identity='
const APP_ID = /^[A-Za-z][A-Za-z0-9.-]{0,127}$/

export function workerIdentityArgs(appId: string): string[] {
  if (!APP_ID.test(appId)) throw new Error(`not an app id: ${appId}`)
  return [`${WORKER_IDENTITY_ARG}${appId}`]
}

/** The appId from the worker's command line; null when absent, repeated or malformed. */
export function workerIdentityFrom(argv: readonly string[]): string | null {
  const found = argv.filter((arg) => arg.startsWith(WORKER_IDENTITY_ARG))
  if (found.length !== 1) return null
  const appId = found[0].slice(WORKER_IDENTITY_ARG.length)
  return APP_ID.test(appId) ? appId : null
}
