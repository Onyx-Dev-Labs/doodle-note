import {
  acceleratorFrom,
  acceleratorKey,
  isStandaloneModifier,
  type AcceleratorEvent
} from './dictation-accelerator'

export interface ShortcutKeyEvent extends AcceleratorEvent {
  key?: string
  repeat?: boolean
}
export interface ShortcutCapture {
  phase: 'listening' | 'pressed' | 'ready' | 'error' | 'cancelled'
  pressed: string[]
  modifiers: string[]
  ordinary: string[]
  unseenModifier: boolean
  candidate: string | null
  error: string | null
}
export const emptyShortcutCapture = (): ShortcutCapture => ({
  phase: 'listening',
  pressed: [],
  modifiers: [],
  ordinary: [],
  unseenModifier: false,
  candidate: null,
  error: null
})
const MULTIPLE_KEYS =
  'Use one ordinary key, optionally with modifiers. Multiple ordinary keys are not supported.'

/** An explicit Save click can confirm a chord whose keyup macOS omitted. */
export function canSaveShortcutCapture(
  state: ShortcutCapture,
  held?: Pick<ShortcutKeyEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
): boolean {
  return (
    (state.phase === 'ready' || state.phase === 'pressed') &&
    !!state.candidate &&
    !state.error &&
    !held?.altKey &&
    !held?.ctrlKey &&
    !held?.metaKey &&
    !held?.shiftKey
  )
}

/** Capture a released chord for explicit review. Never saves automatically. */
export function captureShortcutKey(
  state: ShortcutCapture,
  event: ShortcutKeyEvent,
  direction: 'down' | 'up',
  allowModifierOnly: boolean
): ShortcutCapture {
  const code = event.code || (event.key === 'Fn' ? 'Fn' : '')
  if (direction === 'down' && (code === 'Escape' || event.key === 'Escape'))
    return { ...emptyShortcutCapture(), phase: 'cancelled' }
  if (
    event.repeat ||
    state.phase === 'ready' ||
    state.phase === 'error' ||
    state.phase === 'cancelled'
  )
    return state
  if (direction === 'down') {
    if (state.pressed.includes(code)) return state
    const modifier = isStandaloneModifier(code)
    const ordinary = modifier ? state.ordinary : [...new Set([...state.ordinary, code])]
    const modifiers = modifier ? [...new Set([...state.modifiers, code])] : state.modifiers
    const seen = new Set(modifiers.map((item) => item.replace(/Left$|Right$/, '')))
    const unseenModifier =
      state.unseenModifier ||
      (modifier &&
        ((event.ctrlKey && !seen.has('Control')) ||
          (event.altKey && !seen.has('Alt')) ||
          (event.shiftKey && !seen.has('Shift')) ||
          (event.metaKey && !seen.has('Meta'))))
    let error = state.error
    if (!modifier && !acceleratorKey(code))
      error =
        'That key is not supported. Try a letter, number, function key, navigation key, or modifier combination.'
    if (ordinary.length > 1) error = MULTIPLE_KEYS
    if ((code === 'Fn' && ordinary.length > 0) || (ordinary.length > 0 && modifiers.includes('Fn')))
      error = 'Fn can be used on its own. Choose another modifier for a combination.'
    // When an ordinary key is held, later modifier presses belong to its chord too.
    const candidate =
      ordinary.length === 1 && (!modifier || state.pressed.includes(ordinary[0]!))
        ? acceleratorFrom({ ...event, code: ordinary[0]! }, true)
        : state.candidate
    return {
      phase: 'pressed',
      pressed: [...state.pressed, code],
      modifiers,
      ordinary,
      unseenModifier,
      candidate,
      error
    }
  }
  // macOS may omit ordinary-key keyup events while Command is held. Its
  // release ends that chord; discard those stale ordinary-key entries while
  // still waiting for any other captured modifiers. Save remains explicit.
  // Command may already have been held when recording began.
  const commandReleased =
    (code === 'MetaLeft' || code === 'MetaRight') &&
    !event.metaKey &&
    state.candidate?.split('+').includes('Command') === true
  if (!state.pressed.includes(code) && !commandReleased) return state
  const pressed = state.pressed.filter(
    (key) => key !== code && (!commandReleased || isStandaloneModifier(key))
  )
  if (pressed.length) return { ...state, pressed }
  let candidate = state.candidate
  let error = state.error
  if (state.ordinary.length === 0) {
    if (!allowModifierOnly)
      error = 'Use a modifier with a letter, number, or other supported key for this action.'
    else if (state.modifiers.length !== 1 || state.unseenModifier)
      error = 'Use one standalone modifier, or combine modifiers with one ordinary key.'
    else candidate = `Modifier:${state.modifiers[0]}`
  }
  if (!candidate && !error) error = 'This shortcut isn’t available. Try another.'
  return {
    ...state,
    pressed,
    candidate: error ? null : candidate,
    error,
    phase: error ? 'error' : 'ready'
  }
}
