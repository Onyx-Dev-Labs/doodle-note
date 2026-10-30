/** Typed view of the NDJSON contract with the native dictation helper. */

export interface HelperStatus {
  accessibility: boolean
  inputMonitoring: boolean
  secureInput: boolean
  /** Running dictation apps whose shortcuts may overlap (names only). */
  conflicts: string[]
  holdActive: boolean
}

export interface TargetDescription {
  snapshotId: string
  pid: number
  bundleId: string
  appName: string
  hasElement: boolean
  accessibility: boolean
  role?: string
  secure?: boolean
  editable?: boolean
}

export type HelperDeliveryOutcome = 'delivered' | 'uncertain' | 'refused' | 'failed'

export interface HelperDelivery {
  outcome: HelperDeliveryOutcome
  reason?: string
  method?: 'ax' | 'paste'
  verified: boolean
  /** untouched | restored | user-changed | partial */
  clipboard: string
}

export type HoldFailure = 'input-monitoring-denied' | 'unknown-key' | 'helper-unavailable'

export const HOLD_KEYS = ['off', 'rightOption', 'rightControl', 'rightCommand', 'fn'] as const
export type HoldKey = (typeof HOLD_KEYS)[number]
