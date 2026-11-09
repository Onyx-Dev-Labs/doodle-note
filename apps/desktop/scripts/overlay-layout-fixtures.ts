/**
 * Round 24 (Astra): the overlay cards a layout test renders for real. Writes the overlay page's HTML and, for
 * every notice variant, the view the service would render and the window size it would get (overlaySize), as
 * JSON, for scripts/test-overlay-layout.cjs to load in Electron's Chromium. Run with tsx:
 *   tsx scripts/overlay-layout-fixtures.ts <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { OverlayContext, OverlayView } from '../src/main/dictation-overlay-view'
import type { RecoveryReason } from '../src/shared/dictation-session'
import type { ClipboardOffer } from '../src/shared/dictation-helper-protocol'

// Round 25 (both reviews): the page is built with the PRODUCTION assets. electron-vite defines these at build time
// (electron.vite.config.ts, main.define); the same values are set here, from the same files, BEFORE the page module
// is loaded, so its @font-face rules carry the bundled Figtree (plain tsx has no define: the page had no font).
const asset = (file: string): string =>
  readFileSync(resolve(__dirname, '..', file)).toString('base64')
const defines = globalThis as Record<string, unknown>
defines.__DOODLENOTE_FIGTREE__ = asset('src/renderer/src/assets/fonts/figtree.woff2')
defines.__DOODLENOTE_FRAUNCES__ = asset('src/renderer/src/assets/fonts/fraunces.woff2')
defines.__DOODLENOTE_BARK_PINE__ = asset('src/renderer/src/assets/bark/bark-pine.png')
defines.__DOODLENOTE_BARK_WHITE__ = asset('src/renderer/src/assets/bark/bark-white.png')

/**
 * The no-paste reasons the HELPER can send (round 25: taken from its source, not from the app's own table): every
 * quoted token assigned to deliveryNoSave, LastNoSaveReason or NotStarted in Delivery.cs.
 */
export function helperNoSaveReasons(): string[] {
  const source = readFileSync(
    resolve(__dirname, '../../../engine/windows/dictation-helper/Delivery.cs'),
    'utf8'
  )
  const reasons = new Set<string>()
  for (const line of source.split('\n'))
    if (/\b(deliveryNoSave|LastNoSaveReason|NotStarted)\s*=/.test(line))
      for (const m of line.matchAll(/"([a-z][a-z-]*)"/g)) reasons.add(m[1]!)
  return [...reasons].sort()
}

async function main(): Promise<void> {
  const { OVERLAY_ACTION_URL, overlayHtml } = await import('../src/main/dictation-overlay-page')
  const { RECOVERY_MESSAGES, clipboardProblemMessage, overlaySize, overlayView, panelView } =
    await import('../src/main/dictation-overlay-view')
  const { initialSessionState } = await import('../src/shared/dictation-session')

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
  for (const reason of [...helperNoSaveReasons(), 'not-saved (unknown reason)'])
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
  for (const reason of [...helperNoSaveReasons(), 'unknown'])
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

  // Round 25: a card that reaches the 300 px cap (a warning longer than the window allows: it scrolls in the card).
  cases.push({
    name: 'cap: a card longer than the window allows (a six-line title and a long warning)',
    view: {
      ...recovery(
        'elevated-target',
        notSaved('too-large', false) +
          ' ' +
          clipboardProblemMessage('skipped', names) +
          ' ' +
          'z '.repeat(200)
      ),
      title: 'A title long enough to take six lines of the card. '.repeat(6)
    },
    transcript: true
  })

  const html = overlayHtml()
  if (!html.includes('@font-face{font-family:"Doodle Figtree"'))
    throw new Error('the page was built without the bundled Figtree')
  writeFileSync(
    out,
    JSON.stringify({
      html,
      actionPattern: OVERLAY_ACTION_URL.source,
      font: 'Doodle Figtree',
      // Windows sizes: the growth rule is Windows-only (round 25).
      cases: cases.map((c) => ({ ...c, size: overlaySize(c.view, 'win32') }))
    })
  )
  console.log(`wrote ${cases.length} overlay cards to ${out}`)
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
