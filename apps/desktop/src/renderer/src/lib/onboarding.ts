/**
 * First-run tour persistence: a localStorage flag (same pattern as the
 * theme pref). Closing the tour by any path marks it seen; Settings →
 * General offers a replay.
 */

const STORAGE_KEY = 'doodle-onboarding-done'
const WIZARD_KEY = 'doodle-setup-wizard-done'

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

/** The setup wizard (downloads + permissions) precedes the feature tour. */
export function isSetupWizardDone(): boolean {
  try {
    return localStorage.getItem(WIZARD_KEY) === '1'
  } catch {
    return true
  }
}

export function markSetupWizardDone(): void {
  try {
    localStorage.setItem(WIZARD_KEY, '1')
  } catch {
    // best-effort
  }
}
