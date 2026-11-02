import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HIDE_PILL_MS,
  PILL_EDGE_MARGIN,
  buildPillMenu,
  coerceEdge,
  describeDoubleTap,
  describeFnKey,
  dockedBounds,
  hideExpiry,
  isPillHidden,
  msUntilPillReturns,
  resolveMicrophone,
  shortcutsCollide,
  snapEdge,
  soundForTransition,
  soundTones,
  toMenuTemplate,
  type InputDevice,
  type PillMenuCommand
} from '../shared/dictation-pill'
import { micLooksMuted } from '../shared/dictation-helper-protocol'

const area = { x: 0, y: 25, width: 1440, height: 875 }
const second = { x: 1440, y: 0, width: 1920, height: 1080 }

test('hide for an hour lasts exactly one hour and ends on the dot', () => {
  const now = 1_000_000
  const until = hideExpiry(now)
  assert.equal(until - now, HIDE_PILL_MS)
  assert.equal(HIDE_PILL_MS, 3_600_000)
  assert.equal(isPillHidden(until, now), true)
  assert.equal(isPillHidden(until, until - 1), true)
  assert.equal(isPillHidden(until, until), false, 'the pill is back at the expiry instant')
  assert.equal(isPillHidden(until, until + 5), false)
  assert.equal(isPillHidden(null, now), false)
  assert.equal(msUntilPillReturns(until, now), HIDE_PILL_MS)
  assert.equal(msUntilPillReturns(until, until), null)
  assert.equal(msUntilPillReturns(null, now), null)
})

test('snapEdge picks the nearest of bottom, left and right', () => {
  assert.equal(snapEdge({ x: 720, y: 880 }, area), 'bottom')
  assert.equal(snapEdge({ x: 30, y: 400 }, area), 'left')
  assert.equal(snapEdge({ x: 1420, y: 400 }, area), 'right')
  // Dropped near the top: there is no top dock, so the closer side wins.
  assert.equal(snapEdge({ x: 200, y: 30 }, area), 'left')
  assert.equal(snapEdge({ x: 1300, y: 30 }, area), 'right')
  // Dead centre is nearer the bottom than either side.
  assert.equal(snapEdge({ x: 720, y: 460 }, area), 'bottom')
})

test('snapEdge uses the display the pointer is on, wherever its origin is', () => {
  assert.equal(snapEdge({ x: 1450, y: 500 }, second), 'left')
  assert.equal(snapEdge({ x: 3350, y: 500 }, second), 'right')
  assert.equal(snapEdge({ x: 2400, y: 1070 }, second), 'bottom')
})

test('snapEdge ties go to bottom, then left', () => {
  const square = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(snapEdge({ x: 0, y: 100 }, square), 'bottom')
  assert.equal(snapEdge({ x: 0, y: 50 }, square), 'left')
  assert.equal(snapEdge({ x: 50, y: 50 }, square), 'bottom')
})

test('dockedBounds centres along the edge and keeps the margin', () => {
  const size = { width: 92, height: 40 }
  assert.deepEqual(dockedBounds('bottom', size, area), {
    x: Math.round((1440 - 92) / 2),
    y: 25 + 875 - 40 - PILL_EDGE_MARGIN,
    width: 92,
    height: 40
  })
  const tall = { width: 40, height: 92 }
  assert.deepEqual(dockedBounds('left', tall, area), {
    x: PILL_EDGE_MARGIN,
    y: Math.round(25 + (875 - 92) / 2),
    width: 40,
    height: 92
  })
  assert.deepEqual(dockedBounds('right', tall, second, 10), {
    x: 1440 + 1920 - 40 - 10,
    y: Math.round((1080 - 92) / 2),
    width: 40,
    height: 92
  })
})

test('dockedBounds never leaves a small display', () => {
  const tiny = { x: 0, y: 0, width: 60, height: 30 }
  const bounds = dockedBounds('bottom', { width: 380, height: 132 }, tiny)
  assert.equal(bounds.width, 60)
  assert.equal(bounds.height, 30)
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 60)
})

test('coerceEdge accepts the three docks and nothing else', () => {
  assert.equal(coerceEdge('left'), 'left')
  assert.equal(coerceEdge('right'), 'right')
  assert.equal(coerceEdge('bottom'), 'bottom')
  assert.equal(coerceEdge('top'), 'bottom')
  assert.equal(coerceEdge(undefined), 'bottom')
  assert.equal(coerceEdge(3), 'bottom')
})

const usb: InputDevice = { uid: 'usb-1', name: 'USB Mic', isDefault: false }
const builtin: InputDevice = { uid: 'builtin', name: 'MacBook Pro Microphone', isDefault: true }

test('resolveMicrophone: no saved device means the system default', () => {
  assert.deepEqual(resolveMicrophone(null, [builtin, usb]), { uid: null, fellBack: false })
})

test('resolveMicrophone: a saved device that is present is used', () => {
  assert.deepEqual(resolveMicrophone('usb-1', [builtin, usb]), { uid: 'usb-1', fellBack: false })
})

test('resolveMicrophone: a device that disappeared falls back to the default', () => {
  assert.deepEqual(resolveMicrophone('usb-1', [builtin]), { uid: null, fellBack: true })
})

test('resolveMicrophone: an empty listing is not proof the device is gone', () => {
  assert.deepEqual(resolveMicrophone('usb-1', []), { uid: 'usb-1', fellBack: false })
})

test('the menu lists the six actions in order, with the default microphone ticked', () => {
  const menu = buildPillMenu({
    showAlways: true,
    devices: [builtin, usb],
    selectedUid: null,
    hasLastTranscript: true
  })
  assert.deepEqual(
    menu.map((item) => item.label ?? '---'),
    [
      'Hide the pill for an hour',
      'Microphone',
      'Paste the last transcript',
      'Copy the last transcript',
      '---',
      'Open dictation settings',
      'Keep the pill on screen'
    ]
  )
  const mics = menu[1]!.submenu!
  assert.deepEqual(
    mics.map((item) => [item.label, item.checked]),
    [
      ['System default', true],
      ['MacBook Pro Microphone', false],
      ['USB Mic', false]
    ]
  )
  assert.equal(menu[6]!.type, 'checkbox')
  assert.equal(menu[6]!.checked, true)
})

test('the menu ticks the saved microphone, or the default when it is unplugged', () => {
  const tick = (selectedUid: string | null): Array<string | undefined> =>
    buildPillMenu({
      showAlways: false,
      devices: [builtin, usb],
      selectedUid,
      hasLastTranscript: false
    })[1]!
      .submenu!.filter((item) => item.checked)
      .map((item) => item.label)
  assert.deepEqual(tick('usb-1'), ['USB Mic'])
  assert.deepEqual(tick('gone'), ['System default'])
})

test('paste-last is disabled until there is a transcript; the toggle reflects the setting', () => {
  const menu = buildPillMenu({
    showAlways: false,
    devices: [],
    selectedUid: null,
    hasLastTranscript: false
  })
  assert.equal(menu[2]!.enabled, false)
  assert.equal(menu[3]!.enabled, false)
  assert.equal(menu[6]!.checked, false)
})

test('toMenuTemplate reports the command of the item that was clicked', () => {
  const picked: PillMenuCommand[] = []
  const template = toMenuTemplate(
    buildPillMenu({
      showAlways: true,
      devices: [usb],
      selectedUid: null,
      hasLastTranscript: true
    }),
    (command) => void picked.push(command)
  )
  template[0]!.click?.()
  template[1]!.submenu![1]!.click?.()
  template[2]!.click?.()
  template[3]!.click?.()
  template[5]!.click?.()
  template[6]!.click?.()
  assert.equal(template[4]!.click, undefined, 'separators do nothing')
  assert.deepEqual(picked, [
    { kind: 'hide-hour' },
    { kind: 'microphone', uid: 'usb-1' },
    { kind: 'paste-last' },
    { kind: 'copy-last' },
    { kind: 'settings' },
    { kind: 'toggle-always' }
  ])
})

test('start and stop sounds are short, quiet, and mirror each other', () => {
  const start = soundTones('start')
  const stop = soundTones('stop')
  for (const tones of [start, stop]) {
    const end = Math.max(...tones.map((t) => t.atMs + t.durMs))
    assert.ok(end <= 250, 'under a quarter of a second')
    assert.ok(
      tones.every((t) => t.gain > 0 && t.gain <= 0.1),
      'quiet'
    )
  }
  assert.ok(start[1]!.freq > start[0]!.freq, 'start rises')
  assert.ok(stop[1]!.freq < stop[0]!.freq, 'stop falls')
})

test('soundForTransition: start on a fresh session, stop on finishing, silence otherwise', () => {
  assert.equal(soundForTransition('idle', 'preparing', 'toggle', true), 'start')
  assert.equal(soundForTransition('notice', 'preparing', 'pill', true), 'start')
  assert.equal(soundForTransition('recovery', 'preparing', 'handsfree', true), 'start')
  assert.equal(soundForTransition('recording', 'finalizing', 'toggle', true), 'stop')
  assert.equal(soundForTransition('preparing', 'finalizing', 'toggle', true), 'stop')
  assert.equal(soundForTransition('recording', 'idle', 'toggle', true), null, 'cancel is silent')
  assert.equal(soundForTransition('finalizing', 'cleaning', 'toggle', true), null)
  assert.equal(soundForTransition('idle', 'preparing', 'toggle', false), null, 'setting off')
  assert.equal(soundForTransition('recording', 'finalizing', 'toggle', false), null)
})

test('soundForTransition: a hold sounds only once recording really began', () => {
  assert.equal(soundForTransition('idle', 'preparing', 'hold', true), null)
  assert.equal(soundForTransition('preparing', 'recording', 'hold', true), 'start')
  assert.equal(soundForTransition('preparing', 'idle', 'hold', true), null, 'a discarded tap')
  assert.equal(soundForTransition('recording', 'finalizing', 'hold', true), 'stop')
  assert.equal(soundForTransition('preparing', 'recording', 'toggle', true), null)
})

test('shortcutsCollide ignores case and spacing; empty never collides', () => {
  assert.equal(shortcutsCollide('Control+Alt+D', 'control+alt+d'), true)
  assert.equal(shortcutsCollide(' Control+Alt+D', 'Control+Alt+D '), true)
  assert.equal(shortcutsCollide('Control+Alt+D', 'Control+Alt+Shift+V'), false)
  assert.equal(shortcutsCollide('', ''), false)
})

test('micLooksMuted: muted or zero volume warns; unknown does not', () => {
  assert.equal(micLooksMuted(null), false)
  assert.equal(micLooksMuted({ muted: null, volume: null }), false)
  assert.equal(micLooksMuted({ muted: false, volume: 0.5 }), false)
  assert.equal(micLooksMuted({ muted: true, volume: 0.5 }), true)
  assert.equal(micLooksMuted({ muted: false, volume: 0 }), true)
  assert.equal(micLooksMuted({ muted: null, volume: 0 }), true)
  assert.equal(micLooksMuted({ muted: null, volume: 0.01 }), false)
})

test('the double-tap note says what it needs and how it meets hold-to-talk', () => {
  assert.match(describeDoubleTap(false, 'fn'), /^Off/)
  assert.match(describeDoubleTap(true, 'off'), /needs a hold-to-talk key/)
  assert.match(describeDoubleTap(true, 'rightOption'), /latches instead of acting as hold-to-talk/)
})

test('the Fn note names what macOS does with the Globe key and the external-keyboard caveat', () => {
  assert.match(describeFnKey(0)!, /leaves the Globe key alone/)
  assert.match(describeFnKey(1)!, /input source/)
  assert.match(describeFnKey(2)!, /Emoji and Symbols/)
  assert.match(describeFnKey(3)!, /starts its own dictation/)
  for (const action of [0, 1, 2, 3, null, 9]) {
    assert.match(describeFnKey(action)!, /External keyboards often have no Fn key/)
  }
  for (const action of [1, 2, 3]) assert.match(describeFnKey(action)!, /Do Nothing/)
  assert.match(describeFnKey(null)!, /If a macOS popup appears/, 'unknown setting still hints')
})
