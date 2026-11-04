/**
 * What the Permissions rows offer, as pure rules. macOS only lists an app under
 * Privacy & Security once the app has asked for the permission, so each row has
 * a real request ("Allow…") for as long as macOS will still show its prompt, and
 * falls back to opening System Settings when it will not.
 */

export type PermissionPane = 'microphone' | 'accessibility' | 'input-monitoring'

/** granted / denied / not-determined as macOS reports them; null while the helper has not answered. */
export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export type PermissionAction =
  /** Ask macOS for the permission: it shows its own dialog and lists the app. */
  | 'allow'
  /** macOS will not prompt again; the user has to flip the switch in System Settings. */
  | 'open-settings'
  /** Nothing to do (granted) or nothing known yet. */
  | 'none'

/** Accessibility is a plain yes or no; the rest report the full state. */
export function accessibilityState(trusted: boolean | null): PermissionState | null {
  return trusted === null ? null : trusted ? 'granted' : 'denied'
}

export function permissionAction(
  pane: PermissionPane,
  state: PermissionState | null
): PermissionAction {
  if (state === null || state === 'granted') return 'none'
  switch (pane) {
    case 'microphone':
      // Once answered, macOS never asks again, so a denial can only be undone in Settings.
      return state === 'not-determined' ? 'allow' : 'open-settings'
    case 'accessibility':
      // The Accessibility prompt can be shown again, and it is what lists the app.
      return state === 'restricted' ? 'open-settings' : 'allow'
    case 'input-monitoring':
      return state === 'not-determined' ? 'allow' : 'open-settings'
  }
}

export function permissionLabel(state: PermissionState | null): string {
  switch (state) {
    case null:
      return 'Checking…'
    case 'granted':
      return 'Allowed'
    case 'denied':
      return 'Not allowed'
    case 'not-determined':
      return 'Not asked yet'
    case 'restricted':
      return 'Restricted by this Mac'
    default:
      return 'Unknown'
  }
}

/** The label on a row's main button. */
export function permissionButtonLabel(action: PermissionAction): string | null {
  switch (action) {
    case 'allow':
      return 'Allow…'
    case 'open-settings':
      return 'Open System Settings'
    default:
      return null
  }
}

/**
 * How a request ended: granted on the spot, prompted (the user is deciding, or
 * must flip the switch in System Settings), or macOS will not ask again.
 */
export type PermissionOutcome = 'granted' | 'prompted' | 'open-settings' | 'denied' | 'unavailable'

/**
 * Accessibility and Input Monitoring grants are often only noticed by a freshly
 * started process, so after a request that did not end in a grant the page says
 * to quit and reopen. The microphone takes effect at once.
 */
export function relaunchHint(
  pane: PermissionPane,
  outcome: PermissionOutcome | null
): string | null {
  if (pane === 'microphone' || outcome === null || outcome === 'granted') return null
  return 'After you turn it on in System Settings, quit and reopen DoodleNote Dev if this still says Not allowed.'
}
