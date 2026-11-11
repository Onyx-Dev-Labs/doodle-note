/**
 * Bark's platform tables: the few words and choices that differ between macOS and
 * Windows. The NDJSON protocol, the session logic and the settings are shared; only
 * these labels and sentences change. The darwin entries are the macOS strings exactly
 * as they were before Windows support (pinned by dictation-platform.test.ts).
 */
import { FEATURE_NAME } from './dictation-brand'
import type { HoldKey } from './dictation-helper-protocol'

export type BarkPlatform = 'darwin' | 'win32'

/** Windows gets the Windows tables; every other platform keeps the macOS ones. */
export function barkPlatform(platform: string | null | undefined): BarkPlatform {
  return platform === 'win32' ? 'win32' : 'darwin'
}

/**
 * Hold-to-talk keys, by the protocol's key names. Windows keeps the macOS names for
 * the key in the same place: rightOption is Right Alt (AltGr), rightControl is Right
 * Ctrl. There is no Fn key on Windows, and the Right Windows key is not offered
 * because many keyboards lack it.
 */
export const HOLD_KEY_OPTIONS: Record<BarkPlatform, Array<{ value: HoldKey; label: string }>> = {
  darwin: [
    { value: 'off', label: 'Off' },
    { value: 'rightOption', label: 'Right Option (⌥)' },
    { value: 'rightControl', label: 'Right Control (⌃)' },
    { value: 'rightCommand', label: 'Right Command (⌘)' },
    { value: 'fn', label: 'Fn / Globe' }
  ],
  win32: [
    { value: 'off', label: 'Off' },
    { value: 'rightOption', label: 'Right Alt' },
    { value: 'rightControl', label: 'Right Ctrl' }
  ]
}

export interface BarkCopy {
  /** "this Mac" / "this PC". */
  device: string
  /** The unsupported-platform line on the settings page. */
  unsupported: string
  intro: string
  microphoneOff: string
  /** Shown while the system's own microphone question is up (macOS) or cannot be asked (Windows). */
  microphoneAsk: string
  transformsNeedModel: string
  /** Windows only: the helper program exists but Windows would not start it. */
  helperBlocked: string
  /** Windows only: the shipped helper does not match its manifest (damaged or tampered). */
  helperDamaged: string
  permissionsDescription: string
  permissionsIntro: string
  holdNeedsPermission: string
  mouseNeedsPermission: string
  mouseCaptureDenied: string
  mouseButtonsNote: string
  mouseSoftwareNote: string
  swallowRefused: string
  latencyLabel: string
  /** The words for the operating system's settings app. */
  settingsApp: string
}

export const BARK_COPY: Record<BarkPlatform, BarkCopy> = {
  darwin: {
    device: 'this Mac',
    unsupported: `${FEATURE_NAME}, DoodleNote's dictation, is available on macOS only for now.`,
    intro: `${FEATURE_NAME} is DoodleNote's dictation. Press a shortcut in any app and speak. Speech is recognized on this Mac and the text is typed into the field you were using. Audio is never retained and never leaves this Mac.`,
    microphoneOff:
      'Microphone access is off. Turn it on in System Settings → Privacy & Security → Microphone.',
    microphoneAsk: 'Choose Allow in the macOS dialog to let DoodleNote Dev use the microphone.',
    transformsNeedModel:
      'Transforms need a notes model on this Mac or your own provider. Set one up under Notes model.',
    helperBlocked: `The ${FEATURE_NAME} helper is missing from this build.`,
    helperDamaged: `The ${FEATURE_NAME} helper is missing from this build.`,
    permissionsDescription: 'Microphone, Accessibility, and Input Monitoring',
    permissionsIntro:
      'Allow asks macOS directly, which also lists DoodleNote Dev under Privacy & Security. Once you have answered, macOS will not ask again and the button opens System Settings instead.',
    holdNeedsPermission: 'Allow Input Monitoring first.',
    mouseNeedsPermission: 'Allow Input Monitoring first.',
    mouseCaptureDenied: 'Allow Input Monitoring for DoodleNote Dev first, then try again.',
    mouseButtonsNote:
      'Middle, back, forward and extra buttons only; left and right click are never used.',
    mouseSoftwareNote:
      'Mouse software such as Logitech Options+ can remap buttons before macOS sees them. If a button does nothing, set it to its default or generic action there.',
    swallowRefused:
      'On, but macOS did not allow it, so the app under the pointer still sees the button. Allow Accessibility and Input Monitoring for this app and try again.',
    latencyLabel: 'Last dictation (measured on this Mac)',
    settingsApp: 'System Settings'
  },
  win32: {
    device: 'this PC',
    unsupported: `${FEATURE_NAME}, DoodleNote's dictation, is not available in this build of DoodleNote for Windows.`,
    intro: `${FEATURE_NAME} is DoodleNote's dictation. Press a shortcut in any app and speak. Speech is recognized on this PC and the text is typed into the field you were using. Audio is never retained and never leaves this PC.`,
    microphoneOff:
      'Microphone access is off. Turn it on in Windows Settings → Privacy & security → Microphone, including "Let desktop apps access your microphone".',
    microphoneAsk:
      'Windows does not ask for the microphone. Turn on "Let desktop apps access your microphone" in Windows Settings → Privacy & security → Microphone, then try again.',
    transformsNeedModel:
      'Transforms need a notes model on this PC or your own provider. Set one up under Notes model.',
    helperBlocked: `Windows blocked the ${FEATURE_NAME} helper from starting, so nothing was typed. Your organization's app control policy may not allow it; a signed build, or an allow-list entry for DoodleNote's dictation-helper.exe, fixes this.`,
    helperDamaged: `The ${FEATURE_NAME} helper on disk does not match this build (it may be damaged). Reinstall DoodleNote; nothing was typed.`,
    permissionsDescription: 'Microphone, typing into apps, and the keyboard hook',
    permissionsIntro: `Windows asks no permission for typing into other apps. ${FEATURE_NAME} needs microphone access for desktop apps, and its small helper program, which watches the hold-to-talk key and types the text for you.`,
    holdNeedsPermission: 'Windows did not allow the keyboard hook. See Permissions.',
    mouseNeedsPermission: 'Windows did not allow the mouse hook. See Permissions.',
    mouseCaptureDenied:
      'Windows did not let the helper watch the mouse. See Permissions, then try again.',
    mouseButtonsNote: 'Middle, back and forward buttons only; left and right click are never used.',
    mouseSoftwareNote:
      'Mouse software such as Logitech Options+ can remap buttons before Windows sees them. If a button does nothing, set it to its default or generic action there.',
    swallowRefused:
      'On, but Windows did not allow it, so the app under the pointer still sees the button.',
    latencyLabel: 'Last dictation (measured on this PC)',
    settingsApp: 'Windows Settings'
  }
}

export function barkCopy(platform: string | null | undefined): BarkCopy {
  return BARK_COPY[barkPlatform(platform)]
}

/** Where the "Open … Settings" buttons go. Windows has a settings page for the microphone only. */
export function privacySettingsUrl(
  platform: string,
  pane: 'microphone' | 'accessibility' | 'input-monitoring'
): string | null {
  if (barkPlatform(platform) === 'win32') {
    return pane === 'microphone' ? 'ms-settings:privacy-microphone' : null
  }
  const panes = {
    microphone: 'Privacy_Microphone',
    accessibility: 'Privacy_Accessibility',
    'input-monitoring': 'Privacy_ListenEvent'
  } as const
  return `x-apple.systempreferences:com.apple.preference.security?${panes[pane]}`
}

/**
 * Windows: what the helper row says. ready: verified and running; checking: being verified;
 * off: Bark is off, so it is not started; blocked: Windows would not start it; damaged: it does
 * not match this build; unavailable: the program is missing from this build.
 */
export function describeWindowsHelper(
  helper: 'ready' | 'blocked' | 'damaged' | 'unavailable' | 'checking' | 'off',
  locked?: boolean
): string {
  switch (helper) {
    case 'ready':
      return locked === false
        ? 'Installed. It starts with DoodleNote and stops when DoodleNote quits. Its last start was not confirmed as held by the speech engine, so it was checked by its digest only. A later start holds it again; after repeated failures, only once a minute has passed.'
        : 'Installed. It starts with DoodleNote and stops when DoodleNote quits.'
    case 'checking':
      return 'Checking that the helper is the one this build shipped before it runs.'
    case 'off':
      return `Installed. It starts when ${FEATURE_NAME} is on, after a check that it is the one this build shipped.`
    case 'blocked':
      return "Windows blocked it from starting. Your organization's app control policy may not allow it; a signed build or an allow-list entry fixes this."
    case 'damaged':
      return 'The file on disk does not match this build. Reinstall DoodleNote.'
    default:
      return `Missing from this build, so ${FEATURE_NAME} cannot type or hear the hold key.`
  }
}

/**
 * Windows: the keyboard and mouse hook row. `allowed` is whether a hook can be installed
 * at all; `live` (when known) is whether it is installed right now. Null until the helper
 * has answered.
 */
export function describeWindowsHooks(
  allowed: boolean | null,
  live?: boolean | null
): { label: string; detail: string } {
  if (allowed === null) return { label: 'Checking…', detail: 'Waiting for the helper.' }
  if (!allowed)
    return {
      label: 'Blocked',
      detail:
        'Windows or security software refused the low-level keyboard hook, so hold-to-talk and the mouse button cannot work. The press-to-start shortcut and the pill still do.'
    }
  if (live === false)
    return {
      label: 'Reconnecting…',
      detail:
        'Windows briefly dropped the hook (a busy moment under load); the helper is re-installing it. Hold-to-talk works again in a moment.'
    }
  return {
    label: 'Working',
    detail:
      'The helper may watch the hold-to-talk key and mouse button. It only looks; your keys still reach your apps.'
  }
}
