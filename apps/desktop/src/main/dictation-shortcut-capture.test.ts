import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acceleratorFrom,
  acceleratorKey,
  shortcutLabel,
  shortcutWarning
} from '../renderer/src/dictation-accelerator'
import {
  captureShortcutKey,
  canSaveShortcutCapture,
  emptyShortcutCapture,
  type ShortcutKeyEvent,
  type ShortcutCapture
} from '../renderer/src/dictation-shortcut-capture'
import { MODIFIER_KEYS, validShortcut } from '../shared/dictation-shortcuts'

const key = (code: string, flags: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...flags
})
function sequence(
  events: Array<['down' | 'up', ShortcutKeyEvent]>,
  modifier = true
): ShortcutCapture {
  const result = events.reduce(
    (state, [direction, event]) => captureShortcutKey(state, event, direction, modifier),
    emptyShortcutCapture()
  )
  if (result.phase === 'ready') {
    assert.ok(validShortcut(result.candidate!, true), `Recorded shortcut: ${result.candidate}`)
  }
  return result
}

test('right Option waits for release and produces a sided standalone modifier', () => {
  const down = captureShortcutKey(
    emptyShortcutCapture(),
    key('AltRight', { altKey: true }),
    'down',
    true
  )
  assert.equal(down.phase, 'pressed')
  assert.equal(down.candidate, null)
  const up = captureShortcutKey(down, key('AltRight'), 'up', true)
  assert.equal(up.phase, 'ready')
  assert.equal(up.candidate, 'Modifier:AltRight')
  assert.ok(validShortcut(up.candidate!, true), 'Right Option capture and preset')
  assert.equal(shortcutLabel(up.candidate!), 'Right Option (⌥)')
})

test('every supported sided modifier is distinct; paste/copy reject modifier-only capture', () => {
  for (const code of MODIFIER_KEYS) {
    const events: Array<['down' | 'up', ShortcutKeyEvent]> = [
      ['down', key(code)],
      ['up', key(code)]
    ]
    assert.equal(sequence(events).candidate, `Modifier:${code}`)
    assert.equal(sequence(events, false).phase, 'error')
    assert.ok(validShortcut(sequence(events).candidate!, true))
  }
})

test('modifier combinations wait until all keys release without saving the initial modifier', () => {
  const events: Array<['down' | 'up', ShortcutKeyEvent]> = [
    ['down', key('MetaLeft', { metaKey: true })],
    ['down', key('ShiftLeft', { metaKey: true, shiftKey: true })],
    ['down', key('KeyB', { metaKey: true, shiftKey: true })],
    ['up', key('KeyB', { metaKey: true, shiftKey: true })]
  ]
  assert.equal(sequence(events).phase, 'pressed')
  events.push(['up', key('ShiftLeft', { metaKey: true })], ['up', key('MetaLeft')])
  assert.equal(sequence(events).candidate, 'Shift+Command+B')
  assert.equal(sequence(events).phase, 'ready')
})

test('bare typing, navigation, punctuation, function, numpad and media keys match backend validation', () => {
  for (const code of [
    'KeyA',
    'Digit5',
    'Space',
    'Tab',
    'Enter',
    'Backspace',
    'Delete',
    'Insert',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Minus',
    'Equal',
    'BracketLeft',
    'BracketRight',
    'Backslash',
    'Semicolon',
    'Quote',
    'Backquote',
    'Comma',
    'Period',
    'Slash',
    'F1',
    'F24',
    'CapsLock',
    'NumLock',
    'ScrollLock',
    'PrintScreen',
    'Numpad0',
    'Numpad9',
    'NumpadAdd',
    'NumpadSubtract',
    'NumpadDecimal',
    'NumpadMultiply',
    'NumpadDivide',
    'NumpadEnter',
    'AudioVolumeUp',
    'AudioVolumeDown',
    'AudioVolumeMute',
    'MediaTrackNext',
    'MediaTrackPrevious',
    'MediaStop',
    'MediaPlayPause'
  ]) {
    const result = sequence([
      ['down', key(code)],
      ['up', key(code)]
    ])
    assert.equal(result.phase, 'ready', code)
    assert.ok(validShortcut(result.candidate!, true), `${code}: ${result.candidate}`)
  }
  assert.ok(shortcutWarning('A'))
  assert.ok(shortcutWarning('Left'))
  assert.equal(shortcutWarning('Command+A'), null)
  assert.equal(
    acceleratorFrom(key('KeyA')),
    null,
    'legacy transform recorder keeps modifier requirement'
  )
})

test('repeat and duplicate keydowns never add ordinary keys or complete capture', () => {
  const down = captureShortcutKey(emptyShortcutCapture(), key('KeyA'), 'down', true)
  assert.deepEqual(captureShortcutKey(down, key('KeyA', { repeat: true }), 'down', true), down)
  assert.deepEqual(captureShortcutKey(down, key('KeyA'), 'down', true), down)
  assert.equal(captureShortcutKey(down, key('KeyA'), 'up', true).candidate, 'A')
})

test('multiple ordinary keys, multiple standalone modifiers, unsupported keys, and Fn chords fail explicitly', () => {
  for (const codes of [
    ['KeyA', 'KeyB'],
    ['AltLeft', 'ShiftLeft'],
    ['Unidentified'],
    ['Fn', 'KeyA']
  ]) {
    const result = sequence([
      ...codes.map((code) => ['down', key(code)] as ['down', ShortcutKeyEvent]),
      ...codes.map((code) => ['up', key(code)] as ['up', ShortcutKeyEvent])
    ])
    assert.equal(result.phase, 'error')
    assert.equal(result.candidate, null)
    assert.ok(result.error)
  }
})

test('Escape cancels and cannot be captured, and ready previews remain stable until reset', () => {
  assert.equal(sequence([['down', key('Escape')]]).phase, 'cancelled')
  assert.equal(
    sequence([
      ['down', key('KeyA')],
      ['down', key('Escape')]
    ]).candidate,
    null
  )
  const ready = sequence([
    ['down', key('KeyA')],
    ['up', key('KeyA')]
  ])
  assert.deepEqual(captureShortcutKey(ready, key('KeyB'), 'down', true), ready)
  assert.equal(acceleratorKey('Escape'), null)
})

test('released modifiers do not contaminate the chord and late modifiers only count while ordinary key is held', () => {
  const released = sequence([
    ['down', key('ControlLeft', { ctrlKey: true })],
    ['down', key('ShiftLeft', { ctrlKey: true, shiftKey: true })],
    ['up', key('ShiftLeft', { ctrlKey: true })],
    ['down', key('KeyA', { ctrlKey: true })],
    ['up', key('KeyA', { ctrlKey: true })],
    ['up', key('ControlLeft')]
  ])
  assert.equal(released.candidate, 'Control+A')
  const reversed = sequence([
    ['down', key('KeyA')],
    ['down', key('MetaRight', { metaKey: true })],
    ['up', key('KeyA', { metaKey: true })],
    ['up', key('MetaRight')]
  ])
  assert.equal(reversed.candidate, 'Command+A')
})

test('a modifier held before recording cannot silently become a different standalone shortcut', () => {
  const result = sequence([
    ['down', key('AltRight', { altKey: true, ctrlKey: true })],
    ['up', key('AltRight', { ctrlKey: true })]
  ])
  assert.equal(result.phase, 'error')
  assert.equal(result.candidate, null)
  const chord = sequence([
    ['down', key('AltRight', { altKey: true, ctrlKey: true })],
    ['down', key('KeyA', { altKey: true, ctrlKey: true })],
    ['up', key('KeyA', { altKey: true, ctrlKey: true })],
    ['up', key('AltRight', { ctrlKey: true })]
  ])
  assert.equal(chord.candidate, 'Control+Alt+A')
})

test('Option-Command-Shift-W completes when macOS omits W keyup', () => {
  const events: Array<['down' | 'up', ShortcutKeyEvent]> = [
    ['down', key('AltLeft', { altKey: true })],
    ['down', key('MetaLeft', { altKey: true, metaKey: true })],
    ['down', key('ShiftLeft', { altKey: true, metaKey: true, shiftKey: true })],
    ['down', key('KeyW', { altKey: true, metaKey: true, shiftKey: true })],
    ['up', key('ShiftLeft', { altKey: true, metaKey: true })],
    ['up', key('MetaLeft', { altKey: true })]
  ]
  assert.equal(sequence(events).phase, 'pressed', 'Option still held')
  events.push(['up', key('AltLeft')])
  const result = sequence(events)
  assert.equal(result.phase, 'ready')
  assert.equal(result.candidate, 'Alt+Shift+Command+W')
  assert.deepEqual(result.pressed, [])
})

test('Command release recovers a missing ordinary keyup even when Command was already held', () => {
  for (const code of ['MetaLeft', 'MetaRight']) {
    const result = sequence([
      ['down', key('KeyW', { metaKey: true })],
      ['up', key(code)]
    ])
    assert.equal(result.phase, 'ready')
    assert.equal(result.candidate, 'Command+W')
  }
})

test('Command keyup recovery preserves multiple-key errors and does not apply to Option-only chords', () => {
  const invalid = sequence([
    ['down', key('MetaLeft', { metaKey: true })],
    ['down', key('KeyW', { metaKey: true })],
    ['down', key('KeyB', { metaKey: true })],
    ['up', key('MetaLeft')]
  ])
  assert.equal(invalid.phase, 'error')
  assert.equal(invalid.candidate, null)
  const incomplete = sequence([
    ['down', key('AltLeft', { altKey: true })],
    ['down', key('KeyW', { altKey: true })],
    ['up', key('AltLeft')]
  ])
  assert.equal(incomplete.phase, 'pressed')
})

test('an explicit unmodified Save click accepts a captured Command chord without any keyup', () => {
  const captured = sequence([
    ['down', key('KeyW', { metaKey: true, altKey: true, shiftKey: true })]
  ])
  assert.equal(captured.phase, 'pressed', 'capture alone never auto-saves')
  assert.equal(captured.candidate, 'Alt+Shift+Command+W')
  assert.equal(canSaveShortcutCapture(captured), true)
  assert.equal(canSaveShortcutCapture(captured, key('')), true)
  for (const flag of ['metaKey', 'altKey', 'ctrlKey', 'shiftKey']) {
    assert.equal(canSaveShortcutCapture(captured, key('', { [flag]: true })), false)
  }
  const invalid = captureShortcutKey(captured, key('KeyB', { metaKey: true }), 'down', true)
  assert.equal(canSaveShortcutCapture(invalid), false, 'never accepts a multi-letter chord')
  assert.equal(canSaveShortcutCapture(emptyShortcutCapture()), false)
  const modifierDown = captureShortcutKey(
    emptyShortcutCapture(),
    key('AltRight', { altKey: true }),
    'down',
    true
  )
  assert.equal(
    canSaveShortcutCapture(modifierDown),
    false,
    'standalone modifier still waits for release'
  )
})
