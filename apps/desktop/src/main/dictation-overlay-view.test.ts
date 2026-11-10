import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initialSessionState,
  reduce,
  type RecoveryReason,
  type SessionEvent
} from '../shared/dictation-session'
import type { SessionState } from '../shared/dictation-session'
import {
  CLIPBOARD_OFFER_COPY,
  RECOVERY_MESSAGES,
  WARNINGS,
  describeClipboardSize,
  overlaySize,
  listMissing,
  graphemes,
  CLIPBOARD_NOT_SAVED_MESSAGES,
  overlayView,
  panelView,
  type OverlayContext,
  type OverlayView
} from './dictation-overlay-view'
import { helperNoSaveReasons } from '../../scripts/overlay-layout-fixtures'

const ctx = (over: Partial<OverlayContext> = {}): OverlayContext => ({
  micOpen: true,
  level: 0.4,
  insertionUnavailable: false,
  pillVisible: true,
  edge: 'bottom',
  showLiveText: true,
  showStatusMessages: true,
  target: null,
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
  assert.deepEqual(shown.controls, {
    stop: false,
    cancel: false,
    copy: false,
    dismiss: false,
    view: false,
    undo: false
  })
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

test('live side docks keep a vertical rail and expand inward for readable captions', () => {
  for (const edge of ['left', 'right'] as const) {
    const view = overlayView(live(), ctx({ edge }))
    const plain = overlaySize(view)
    assert.ok(plain.height > plain.width, 'the active pill stays vertical')
    const target = overlaySize({ ...view, target: { name: 'Notes', icon: null } })
    assert.equal(target.width, plain.width, 'the app icon stacks within the rail')
    assert.ok(target.height > plain.height)
    for (const caption of [
      { warning: WARNINGS.muted },
      { detail: 'A sentence being dictated.' },
      { tone: 'busy' as const, title: 'Transcribing…' }
    ]) {
      const expanded = overlaySize({ ...view, ...caption })
      assert.ok(expanded.width > plain.width, 'captions have room beside the rail')
      assert.equal(expanded.height, plain.height, 'captions do not move the rail vertically')
    }
    assert.deepEqual(
      overlaySize({ ...view, tone: 'busy', title: 'Transcribing…', showStatus: false }),
      plain,
      'quiet status does not leave an empty caption area'
    )
  }
})

/* ---- quiet mode ---- */

const quietCtx = (over: Partial<OverlayContext> = {}): OverlayContext =>
  ctx({ showLiveText: false, showStatusMessages: false, ...over })

test('quiet mode hides the words and the captions but keeps the controls and the level', () => {
  const talking = live([{ type: 'partial', gen: 1, text: 'private words' }])
  const loud = overlayView(talking, ctx())
  assert.equal(loud.detail, 'private words')
  assert.equal(loud.showStatus, true)
  const hushed = overlayView(talking, quietCtx())
  assert.equal(hushed.detail, '')
  assert.equal(hushed.showStatus, false)
  assert.equal(hushed.title, 'Listening', 'the title stays for screen readers')
  assert.equal(hushed.level, 0.4)
  assert.equal(hushed.controls.stop, true)
  assert.equal(hushed.controls.cancel, true)
  assert.ok(!JSON.stringify(hushed).includes('private words'), 'no transcript reaches the page')
})

test('the two quiet settings work independently', () => {
  const talking = live([{ type: 'partial', gen: 1, text: 'private words' }])
  const noWords = overlayView(talking, ctx({ showLiveText: false }))
  assert.equal(noWords.detail, '')
  assert.equal(noWords.showStatus, true)
  const noCaptions = overlayView(talking, ctx({ showStatusMessages: false }))
  assert.equal(noCaptions.detail, 'private words')
  assert.equal(noCaptions.showStatus, false)
})

test('quiet mode also hides the raw words shown while finishing and cleaning up', () => {
  const finishing = live([
    { type: 'partial', gen: 1, text: 'half said' },
    { type: 'stop', source: 'toggle', nowMs: 900 }
  ])
  assert.equal(overlayView(finishing, ctx()).detail, 'half said')
  assert.equal(overlayView(finishing, quietCtx()).detail, '')
  const cleanState = after([
    { type: 'start', trigger: 'toggle', cleanupMode: 'local', nowMs: 0 },
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'toggle', nowMs: 900 },
    { type: 'final', gen: 1, text: 'raw words here' }
  ])
  assert.equal(cleanState.phase, 'cleaning')
  assert.equal(overlayView(cleanState, ctx()).detail, 'raw words here')
  assert.equal(overlayView(cleanState, quietCtx()).detail, '')
})

test('quiet mode never hides failures, warnings or kept text', () => {
  const hushed = quietCtx()
  const muted = overlayView(live([{ type: 'mic-state', gen: 1, muted: true }]), hushed)
  assert.equal(muted.warning, WARNINGS.muted)
  const limit = overlayView(live([{ type: 'limit-warning', gen: 1 }]), hushed)
  assert.equal(limit.warning, WARNINGS.limit)
  const fell = overlayView(live([{ type: 'mic-fallback', gen: 1 }]), hushed)
  assert.equal(fell.warning, WARNINGS.fellBack)
  const noAccess = overlayView(live(), quietCtx({ insertionUnavailable: true }))
  assert.match(noAccess.detail, /Accessibility is off/)
  for (const level of ['error', 'info'] as const) {
    const notice = overlayView(
      reduce(initialSessionState(), { type: 'notice', level, message: 'Something to read.' }).state,
      hushed
    )
    assert.equal(notice.visible, true)
    assert.equal(notice.mode, 'message')
    assert.equal(notice.title, 'Something to read.')
  }
  const kept = after([
    { type: 'start', trigger: 'toggle', cleanupMode: 'raw', nowMs: 0 },
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'toggle', nowMs: 900 },
    { type: 'final', gen: 1, text: 'kept words' },
    { type: 'delivery-done', gen: 1, outcome: { kind: 'recover', reason: 'focus-changed' } }
  ])
  const card = overlayView(kept, hushed)
  assert.equal(card.mode, 'message')
  assert.equal(card.detail, 'kept words')
  assert.equal(card.controls.copy, true)
})

test('quiet mode drops only the success confirmation and returns to the resting pill', () => {
  const inserted = after([
    { type: 'start', trigger: 'toggle', cleanupMode: 'raw', nowMs: 0 },
    { type: 'capture-ready', gen: 1 },
    { type: 'stop', source: 'toggle', nowMs: 900 },
    { type: 'final', gen: 1, text: 'done' },
    { type: 'delivery-done', gen: 1, outcome: { kind: 'delivered' } }
  ])
  assert.equal(overlayView(inserted, ctx()).mode, 'message')
  assert.equal(overlayView(inserted, ctx()).title, 'Inserted.')
  const hushed = overlayView(inserted, quietCtx())
  assert.equal(hushed.mode, 'rest')
  assert.equal(hushed.visible, true)
  assert.equal(overlayView(inserted, quietCtx({ pillVisible: false })).visible, false)
})

test('the window shrinks to just the pill when the words are hidden', () => {
  const talking = live([{ type: 'partial', gen: 1, text: 'a longer sentence being said' }])
  const loud = overlaySize(overlayView(talking, ctx()))
  const hushed = overlaySize(overlayView(talking, quietCtx()))
  assert.ok(hushed.height < loud.height)
  assert.equal(hushed.height, overlaySize(overlayView(live(), ctx())).height, 'pill only')
})

/* ---- panels after a transform ---- */

test('the changed panel offers View and Undo; the diff panel carries the words and Undo', () => {
  const base = overlayView(initialSessionState(), ctx())
  const changed = panelView({ kind: 'changed', name: 'Polish' }, base)
  assert.equal(changed.mode, 'message')
  assert.equal(changed.title, 'Changed by Polish.')
  assert.equal(changed.controls.view, true)
  assert.equal(changed.controls.undo, true)
  assert.equal(changed.controls.dismiss, true)
  assert.equal(changed.diff, null)
  const segments = [
    { op: 'del' as const, text: 'um ' },
    { op: 'same' as const, text: 'hello' }
  ]
  const diff = panelView({ kind: 'diff', name: 'Polish', segments }, base)
  assert.deepEqual(diff.diff, segments)
  assert.equal(diff.controls.view, false, 'already viewing')
  assert.equal(diff.controls.undo, true)
  assert.ok(overlaySize(diff).width > overlaySize(changed).width, 'the diff panel is larger')
  assert.ok(overlaySize(diff).height >= overlaySize(changed).height)
  const long = panelView(
    { kind: 'diff', name: 'Polish', segments: [{ op: 'same', text: 'word '.repeat(80) }] },
    base
  )
  assert.ok(overlaySize(long).height > overlaySize(diff).height, 'more words, more room')
  assert.ok(overlaySize(long).height <= 300, 'but never beyond the cap')
})

test('the working panel is a caption only and follows the dock edge', () => {
  const base = overlayView(initialSessionState(), ctx({ edge: 'left' }))
  const working = panelView({ kind: 'working', name: 'Polish' }, base)
  assert.equal(working.title, 'Polish…')
  assert.equal(working.edge, 'left')
  assert.deepEqual(working.controls, {
    stop: false,
    cancel: false,
    copy: false,
    dismiss: false,
    view: false,
    undo: false
  })
})

test('the live pill carries the target app; every other mode drops it', () => {
  const target = { name: 'Chrome', icon: 'data:image/png;base64,AAAA' }
  const recording = overlayView(live(), ctx({ target }))
  assert.deepEqual(recording.target, target)
  assert.ok(overlaySize(recording).width > overlaySize({ ...recording, target: null }).width)
  assert.equal(overlayView(initialSessionState(), ctx({ target })).target, null)
  const done = overlayView(
    reduce(initialSessionState(), { type: 'notice', level: 'error', message: 'No.' }).state,
    ctx({ target })
  )
  assert.equal(done.target, null)
})

test('the learned-word panel names the pair, or counts several, and only offers Dismiss', () => {
  const base = overlayView(initialSessionState(), ctx())
  const one = panelView({ kind: 'learned', pairs: [{ from: 'Alec', to: 'Alex' }] }, base)
  assert.equal(one.title, 'Added to your dictionary: Alec → Alex')
  assert.deepEqual(
    Object.entries(one.controls)
      .filter(([, on]) => on)
      .map(([name]) => name),
    ['dismiss']
  )
  const two = panelView(
    {
      kind: 'learned',
      pairs: [
        { from: 'Alec', to: 'Alex' },
        { from: 'Jonathon', to: 'Jonathan' }
      ]
    },
    base
  )
  assert.equal(two.title, 'Added 2 corrections to your dictionary.')
})

test('Windows (round 23): an incomplete card shows at most three names (+N more), and says so truthfully when nothing goes back', () => {
  const base = overlayView(initialSessionState(), ctx())
  const offer = {
    record: '0'.repeat(32),
    delivery: '',
    formats: 2,
    bytes: 900,
    sequence: 3,
    created: '',
    likelyOurs: false,
    incomplete: true,
    missing: ['A (x)', 'B (x)', 'C (x)', 'D (x)', 'E (x)'],
    content: 2
  }
  const some = panelView({ kind: 'clipboard-offer', offer }, base)
  assert.equal(
    some.warning,
    'Part of this clipboard could not be saved: A (x); B (x); C (x) +2 more. Restore puts back the rest.'
  )
  const none = panelView(
    { kind: 'clipboard-offer', offer: { ...offer, formats: 0, content: 0, missing: ['A (x)'] } },
    base
  )
  assert.equal(
    none.warning,
    'None of this clipboard could be saved (A (x)). There is nothing to put back; Dismiss deletes the saved record.'
  )
  // Round 24 (Opus): no user content to put back: no Restore button at all.
  assert.ok(!none.controls.offerRestore)
  assert.equal(none.controls.offerDismiss, true)
  assert.equal(none.offerRecord, offer.record)
})

test('Windows (round 24): "+N more" counts every name (or the reported total), and a long name is cut by code points, never inside a surrogate pair', () => {
  const many = Array.from({ length: 300 }, (_, i) => `F${i}`)
  assert.equal(listMissing(many), 'F0; F1; F2 +297 more')
  assert.equal(listMissing(['A', 'B'], 10), 'A; B +8 more')
  const emoji = '😀'.repeat(70)
  const cut = listMissing([emoji])
  assert.equal(Array.from(cut).length, 61)
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut), 'no lone high surrogate')
})

/**
 * Round 25 (macOS parity): overlaySize as it was at 0c1e0b2 (before round 24), copied verbatim for the
 * pin below. On every platform but Windows the card sizes must equal it exactly.
 */
function sizeAt0c1e0b2(view: OverlayView): { width: number; height: number } {
  const WINDOW = {
    restLong: 92,
    restShort: 40,
    sessionWidth: 320,
    sessionWithTargetWidth: 372,
    sessionBase: 56,
    sideWidth: 58,
    sideHeight: 224,
    sideTargetHeight: 36,
    sideCaptionWidth: 250,
    warningLine: 26,
    detailBlock: 64,
    message: { width: 380, height: 132 },
    offer: { width: 460, height: 236 },
    diff: { width: 480, height: 300 }
  }
  if (view.mode === 'message' && view.diff) {
    const chars = view.diff.reduce((total, part) => total + part.text.length, 0)
    const lines = Math.ceil(chars / 55)
    return {
      width: WINDOW.diff.width,
      height: Math.max(WINDOW.message.height, Math.min(WINDOW.diff.height, 110 + lines * 19))
    }
  }
  if (view.mode === 'message' && (view.controls.offerRestore || view.controls.offerDelete))
    return { ...WINDOW.offer }
  if (view.mode === 'message')
    return view.warning
      ? { width: WINDOW.message.width, height: WINDOW.message.height + WINDOW.warningLine }
      : { ...WINDOW.message }
  if (view.mode === 'session') {
    if (view.edge !== 'bottom') {
      const status = view.showStatus && !(view.tone === 'active' && view.title === 'Listening')
      return {
        width:
          WINDOW.sideWidth + (view.warning || view.detail || status ? WINDOW.sideCaptionWidth : 0),
        height: WINDOW.sideHeight + (view.target ? WINDOW.sideTargetHeight : 0)
      }
    }
    return {
      width: view.target ? WINDOW.sessionWithTargetWidth : WINDOW.sessionWidth,
      height:
        WINDOW.sessionBase +
        (view.warning ? WINDOW.warningLine : 0) +
        (view.detail ? WINDOW.detailBlock : 0)
    }
  }
  return view.edge === 'bottom'
    ? { width: WINDOW.restLong, height: WINDOW.restShort }
    : { width: WINDOW.restShort, height: WINDOW.restLong }
}

test('macOS (round 25): every card keeps its exact size from before round 24 (the growth rule is Windows-only)', () => {
  const longText = 'A transcript that runs on for a while. '.repeat(12)
  const views: Array<[string, OverlayView]> = []
  for (const reason of Object.keys(RECOVERY_MESSAGES) as RecoveryReason[]) {
    const state: SessionState = {
      ...initialSessionState(),
      phase: 'recovery',
      resting: { kind: 'recovery', gen: 1, text: longText, rawText: longText, reason }
    }
    views.push([`recovery ${reason}`, overlayView(state, ctx())])
  }
  const notices = [
    'Inserted.',
    'Bark needs the microphone. Allow it in System Settings, then try again.',
    'x'.repeat(121),
    'A notice long enough to wrap onto several lines of the card, as some of the longer errors do. '.repeat(
      3
    ),
    'y'.repeat(400)
  ]
  for (const level of ['success', 'info', 'error'] as const)
    for (const message of notices) {
      const state: SessionState = {
        ...initialSessionState(),
        phase: 'notice',
        resting: { kind: 'notice', level, message }
      }
      views.push([`notice ${level} ${message.length}`, overlayView(state, ctx())])
    }
  const base = overlayView(initialSessionState(), ctx())
  views.push(['changed panel', panelView({ kind: 'changed', name: 'Fix grammar' }, base)])
  views.push([
    'learned panel',
    panelView({ kind: 'learned', pairs: [{ from: 'a', to: 'b' }] }, base)
  ])
  views.push(['working panel', panelView({ kind: 'working', name: 'Fix grammar' }, base)])
  views.push([
    'diff panel',
    panelView(
      { kind: 'diff', name: 'Fix grammar', segments: [{ op: 'same', text: longText }] },
      base
    )
  ])
  let compared = 0
  for (const platform of ['darwin', 'linux']) {
    for (const [name, view] of views) {
      assert.deepEqual(overlaySize(view, platform), sizeAt0c1e0b2(view), `${platform}: ${name}`)
      compared++
    }
  }
  console.log(`# macOS size pin: ${compared} views on darwin and linux equal 0c1e0b2's overlaySize`)
  // And Windows does grow a long card (the round-24 fix stays where it is needed).
  const [, card] = views[0]!
  assert.ok(overlaySize({ ...card, warning: 'w '.repeat(200) }, 'win32').height > 158)
})

test('Windows (round 25): every no-paste reason the helper can send has its own sentence, and the layout fixtures render exactly those', () => {
  const helper = helperNoSaveReasons()
  assert.ok(helper.length >= 10, `the helper's reasons were found (${helper})`)
  assert.deepEqual([...CLIPBOARD_NOT_SAVED_MESSAGES.keys()].sort(), helper)
})

test('Windows (round 25): names are cut on grapheme boundaries (an emoji sequence is never split)', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  const cut = listMissing([family.repeat(70)])
  const parts = graphemes(cut)
  assert.equal(parts.length, 61, 'sixty clusters and the ellipsis')
  assert.ok(
    parts.slice(0, 60).every((p) => p === family),
    'every cluster whole'
  )
})

test('Windows (round 28): an offer whose Restore is outstanding says so (restoring), keeps Restore shown and Dismiss enabled', () => {
  const base = overlayView(initialSessionState(), ctx())
  const offer = {
    record: '0'.repeat(32),
    delivery: '',
    formats: 2,
    bytes: 900,
    sequence: 3,
    created: '',
    likelyOurs: false,
    incomplete: false,
    missing: [],
    content: 2
  }
  const idle = panelView({ kind: 'clipboard-offer', offer }, base)
  const pending = panelView({ kind: 'clipboard-offer', offer, pending: true }, base)
  assert.equal(idle.restoring, undefined)
  assert.equal(pending.restoring, true)
  assert.equal(pending.controls.offerRestore, true)
  assert.equal(pending.controls.offerDismiss, true)
})

test('Windows: the clipboard offer card names formats and size only, with Restore and Dismiss', () => {
  const base = overlayView(initialSessionState(), ctx())
  const view = panelView(
    {
      kind: 'clipboard-offer',
      offer: {
        record: '0'.repeat(32),
        delivery: '',
        formats: 1,
        bytes: 900,
        sequence: 3,
        created: '',
        likelyOurs: false,
        incomplete: false,
        missing: [],
        content: 1
      }
    },
    base
  )
  assert.equal(view.title, CLIPBOARD_OFFER_COPY.title)
  assert.match(view.detail, /\(1 format, 900 bytes\)/)
  assert.deepEqual(
    {
      restore: view.controls.offerRestore,
      offerDismiss: view.controls.offerDismiss,
      dismiss: view.controls.dismiss,
      copy: view.controls.copy
    },
    { restore: true, offerDismiss: true, dismiss: false, copy: false }
  )
  assert.deepEqual(overlaySize(view), { width: 460, height: 236 })
  assert.equal(describeClipboardSize(3, 2 * 1024 * 1024), '3 formats, 2.0 MB')
  assert.equal(describeClipboardSize(2, null), '2 formats')
})
