/**
 * First-run tour persistence: a localStorage flag (same pattern as the
 * theme pref). Closing the tour by any path marks it seen; Settings →
 * General offers a replay.
 */

const STORAGE_KEY = 'doodle-onboarding-done'

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true // storage unavailable — never trap the user in a loop
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // best-effort
  }
}
