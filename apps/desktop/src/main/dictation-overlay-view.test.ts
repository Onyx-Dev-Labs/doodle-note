import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialSessionState, reduce, type SessionEvent } from '../shared/dictation-session'
import type { SessionState } from '../shared/dictation-session'
import { WARNINGS, overlaySize, overlayView, type OverlayContext } from './dictation-overlay-view'

const ctx = (over: Partial<OverlayContext> = {}): OverlayContext => ({
  micOpen: true,
  level: 0.4,
  insertionUnavailable: false,
  pillVisible: true,
  edge: 'bottom',
  ...over
})

function after(events: SessionEvent[]): SessionState {
  let state = initialSessionState()
  for (const event of events) state = reduce(state, event).state
  return state
}
const live = (extra: SessionEvent[] = []): SessionState =>
  after([
    { type: 'start', trigger: 'toggle', cleanupMode: 'raw', nowMs: 0 },
    { type: 'capture-ready', gen: 1 },
    { type: 'asr-ready', gen: 1 },
    ...extra
  ])

test('idle shows the resting pill only when the pill is wanted', () => {
  const shown = overlayView(initialSessionState(), ctx())
  assert.equal(shown.visible, true)
  assert.equal(shown.mode, 'rest')
  assert.deepEqual(shown.controls, { stop: false, cancel: false, copy: false, dismiss: false })
  const hidden = overlayView(initialSessionState(), ctx({ pillVisible: false }))
  assert.equal(hidden.visible, false)
})

test('recording shows Cancel and Finish, the level, and no warning by default', () => {
  const view = overlayView(live(), ctx())
  assert.equal(view.mode, 'session')
  assert.equal(view.title, 'Listening')
  assert.equal(view.level, 0.4)
  assert.equal(view.controls.stop, true)
  assert.equal(view.controls.cancel, true)
  assert.equal(view.warning, null)
})

test('the 19-minute warning, a muted microphone and a missing device each show a notice', () => {
  const warned = overlayView(live([{ type: 'limit-warning', gen: 1 }]), ctx())
  assert.equal(warned.warning, WARNINGS.limit)
  assert.match(WARNINGS.limit, /one minute/i)
  const muted = overlayView(live([{ type: 'mic-state', gen: 1, muted: true }]), ctx())
  assert.equal(muted.warning, WARNINGS.muted)
  const fell = overlayView(live([{ type: 'mic-fallback', gen: 1 }]), ctx())
  assert.equal(fell.warning, WARNINGS.fellBack)
  // A muted microphone outranks the countdown: nothing is being heard.
  const both = overlayView(
    live([
      { type: 'limit-warning', gen: 1 },
      { type: 'mic-state', gen: 1, muted: true }
    ]),
    ctx()
  )
  assert.equal(both.warning, WARNINGS.muted)
})

test('busy phases keep a Cancel and no Finish; notices are message cards', () => {
  const finishing = overlayView(live([{ type: 'stop', source: 'toggle', nowMs: 900 }]), ctx())
  assert.equal(finishing.mode, 'session')
  assert.equal(finishing.controls.stop, false)
  assert.equal(finishing.controls.cancel, true)
  const notice = overlayView(
    reduce(initialSessionState(), { type: 'notice', level: 'error', message: 'Nope.' }).state,
    ctx()
  )
  assert.equal(notice.mode, 'message')
  assert.equal(notice.title, 'Nope.')
})

test('window size follows the layout: along the edge, with room for the warning and text', () => {
  const rest = (edge: 'bottom' | 'left' | 'right'): { width: number; height: number } =>
    overlaySize(overlayView(initialSessionState(), ctx({ edge })))
  assert.ok(rest('bottom').width > rest('bottom').height, 'horizontal at the bottom')
  assert.ok(rest('left').height > rest('left').width, 'vertical on a side')
  assert.deepEqual(rest('left'), rest('right'))
  const plain = overlaySize(overlayView(live(), ctx()))
  const warned = overlaySize(overlayView(live([{ type: 'limit-warning', gen: 1 }]), ctx()))
  const talking = overlaySize(
    overlayView(live([{ type: 'partial', gen: 1, text: 'hello there' }]), ctx())
  )
  assert.ok(warned.height > plain.height)
  assert.ok(talking.height > plain.height)
  assert.equal(plain.width, warned.width)
})
