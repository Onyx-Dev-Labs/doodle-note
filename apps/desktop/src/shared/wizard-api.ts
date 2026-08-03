/**
 * First-run setup wizard: renderer-facing API surface.
 *
 * The wizard fronts work the app already does invisibly — the engine's
 * preflight (permission prompts + ASR model download) and the notes-model
 * download — so a fresh install sees progress instead of a mysterious warmup,
 * Meetily-style but non-blocking: every step is skippable and downloads keep
 * running after the wizard closes.
 */

/** renderer → main (invoke): run engine preflight with visible progress. */
export const WIZARD_PREFLIGHT_CHANNEL = 'wizard:preflight'
/** main → renderer: preflight progress events. */
export const WIZARD_PREFLIGHT_EVENT_CHANNEL = 'wizard:preflight-event'
/** renderer → main (invoke): current OS permission states. */
export const WIZARD_PERMISSIONS_CHANNEL = 'wizard:permissions'

export interface WizardPreflightEvent {
  stage: 'mic' | 'screen' | 'models' | 'download' | 'ready' | 'error'
  /** For mic/screen: whether macOS granted it. */
  granted?: boolean
  /** For download: 0..1. */
  progress?: number
  message?: string
}

export interface WizardPreflightResult {
  ok: boolean
  micGranted: boolean
  screenGranted: boolean
  error?: string
}

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'unknown'

export interface WizardPermissions {
  microphone: PermissionState
  screen: PermissionState
}

/** API surface exposed on `window.wizard` by the preload script. */
export interface WizardApi {
  runPreflight(): Promise<WizardPreflightResult>
  getPermissions(): Promise<WizardPermissions>
  onPreflightEvent(cb: (ev: WizardPreflightEvent) => void): () => void
}
