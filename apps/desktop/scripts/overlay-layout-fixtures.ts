/**
 * Round 24 (Astra): the overlay cards a layout test renders for real. Writes the overlay page's HTML and, for
 * every notice variant, the view the service would render and the window size it would get (overlaySize), as
 * JSON, for scripts/test-overlay-layout.cjs to load in Electron's Chromium. Run with tsx:
 *   tsx scripts/overlay-layout-fixtures.ts <out.json>
 */
import { writeFileSync } from 'node:fs'
import { overlayHtml } from '../src/main/dictation-overlay-page'
import {
  CLIPBOARD_NOT_SAVED_MESSAGES,
  RECOVERY_MESSAGES,
  clipboardProblemMessage,
  overlaySize,
  overlayView,
  panelView,
  type OverlayContext,
  type OverlayView
} from '../src/main/dictation-overlay-view'
import { initialSessionState, type RecoveryReason } from '../src/shared/dictation-session'
import type { ClipboardOffer } from '../src/shared/dictation-helper-protocol'

const out = process.argv[2]
if (!out) throw new Error('usage: overlay-layout-fixtures.ts <out.json>')

const ctx = (over: Partial<OverlayContext> = {}): OverlayContext => ({
  micOpen: false,
  level: 0,
  insertionUnavailable: false,
  pillVisible: true,
  edge: 'bottom',
  showLiveText: true,
  showStatusMessages: true,
  target: null,
  ...over
})
const transcript =
  'This is the dictated text the user said, long enough to wrap onto several lines of the card so that the transcript has to share the window with the explanation above it and the buttons below it.'
const recovery = (reason: RecoveryReason, warning: string | null): OverlayView =>
  overlayView(
    {
      ...initialSessionState(),
      phase: 'recovery',
      resting: { kind: 'recovery', gen: 1, text: transcript, rawText: transcript, reason }
    },
    ctx({ clipboardWarning: warning })
  )
const base = overlayView(initialSessionState(), ctx())
const offer = (over: Partial<ClipboardOffer> = {}): ClipboardOffer => ({
  record: '0123456789abcdef0123456789abcdef',
  delivery: 'd1',
  formats: 6,
  bytes: 4096,
  sequence: 41,
  created: '',
  likelyOurs: false,
  incomplete: false,
  missing: [],
  content: 4,
  ...over
})
const names = Array.from(
  { length: 9 },
  (_, i) =>
    `A registered format with a long descriptive name number ${i + 1} (not provided by the app that copied it)`
)

const cases: Array<{ name: string; view: OverlayView; transcript: boolean }> = []
const notSaved = (reason: string, delivered: boolean): string =>
  clipboardProblemMessage('not-saved', undefined, reason, delivered)
// The recovery card with each no-paste warning (the text was NOT inserted: the advice to paste it stays).
for (const reason of [...CLIPBOARD_NOT_SAVED_MESSAGES.keys(), 'not-saved (unknown reason)'])
  cases.push({
    name: `recovery card, warning ${reason}`,
    view: recovery('insertion-uncertain', notSaved(reason, false)),
    transcript: true
  })
// Every recovery reason with the longest warning (too-large with its advice).
for (const reason of Object.keys(RECOVERY_MESSAGES) as RecoveryReason[])
  cases.push({
    name: `recovery card ${reason}, warning too-large`,
    view: recovery(reason, notSaved('too-large', false)),
    transcript: true
  })
// Every recovery reason without a warning.
for (const reason of Object.keys(RECOVERY_MESSAGES) as RecoveryReason[])
  cases.push({ name: `recovery card ${reason}`, view: recovery(reason, null), transcript: true })
// The recovery card with the names of what a put-back missed (3 + N).
cases.push({
  name: 'recovery card, put back except 3 + 6 names',
  view: recovery('insertion-uncertain', clipboardProblemMessage('skipped', names)),
  transcript: true
})
// The notice after a delivery that typed the text (delivered: no advice to paste), each reason.
for (const reason of [...CLIPBOARD_NOT_SAVED_MESSAGES.keys(), 'unknown'])
  cases.push({
    name: `delivered-by-typing notice, ${reason}`,
    view: panelView({ kind: 'clipboard', problem: 'not-saved', reason, delivered: true }, base),
    transcript: false
  })
cases.push({
  name: 'delivered notice, put back except 3 + 6 names',
  view: panelView({ kind: 'clipboard', problem: 'skipped', missing: names }, base),
  transcript: false
})
// The offer cards.
cases.push({
  name: 'offer card',
  view: panelView({ kind: 'clipboard-offer', offer: offer() }, base),
  transcript: false
})
cases.push({
  name: 'incomplete offer card, 3 + 6 names',
  view: panelView(
    { kind: 'clipboard-offer', offer: offer({ incomplete: true, missing: names }) },
    base
  ),
  transcript: false
})
cases.push({
  name: 'incomplete offer card, nothing to put back',
  view: panelView(
    { kind: 'clipboard-offer', offer: offer({ incomplete: true, missing: names, content: 0 }) },
    base
  ),
  transcript: false
})
cases.push({
  name: 'changed offer card',
  view: panelView(
    {
      kind: 'clipboard-offer',
      offer: offer({ incomplete: true, missing: names }),
      changed: { formats: 3, bytes: 900 }
    },
    base
  ),
  transcript: false
})
cases.push({
  name: 'offer delete confirmation, failed',
  view: panelView(
    { kind: 'clipboard-offer', offer: offer(), confirmDelete: true, deleteFailed: true },
    base
  ),
  transcript: false
})

writeFileSync(
  out,
  JSON.stringify({
    html: overlayHtml(),
    cases: cases.map((c) => ({ ...c, size: overlaySize(c.view) }))
  })
)
console.log(`wrote ${cases.length} overlay cards to ${out}`)
