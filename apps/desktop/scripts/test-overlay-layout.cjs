#!/usr/bin/env node
// Rounds 24-25: the overlay's cards rendered for real, in Electron's Chromium, with the BUNDLED font (the fixtures
// carry the production @font-face; the check fails unless that face is loaded), at the window size the app gives
// them (overlaySize, Windows). For every card (scripts/overlay-layout-fixtures.ts writes them):
// - exactly the buttons the view asked for are shown, each wholly inside the window, and so is the card;
// - a card that carries the dictated text shows at least one whole line of it;
// - every shown button, CLICKED, navigates to a URL the overlay window's own pattern (OVERLAY_ACTION_URL) parses into
//   that button's action, and an offer's button into the record of the card shown (the page-to-main hop).
// Run (Windows CI, or any desktop with a display):
//   electron scripts/test-overlay-layout.cjs <fixtures.json>
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const file = process.argv.find((a) => a.endsWith('.json'))
if (!file) {
  console.error('usage: electron scripts/test-overlay-layout.cjs <fixtures.json>')
  process.exit(2)
}
const {
  html,
  cases,
  sequences = [],
  actionPattern,
  font
} = JSON.parse(fs.readFileSync(file, 'utf8'))
const actionUrl = new RegExp(actionPattern)
/** The page's button ids, the control each shows, and the action its URL must carry. */
const BUTTONS = {
  view: 'view',
  undo: 'undo',
  copy: 'copy',
  offerRestore: 'offer-restore',
  offerDismiss: 'offer-dismiss',
  offerKeep: 'offer-keep',
  offerDelete: 'offer-delete',
  dismiss: 'dismiss'
}

const measure = (family) => `(async () => {
  // The bundled face must actually load (a family that is absent "loads" nothing).
  const loaded = await document.fonts.load('700 14px "${family}"')
  await document.fonts.ready
  const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === '${family}' && f.status === 'loaded')
  const inside = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
  const shown = (el) => el && !el.hidden && el.getClientRects().length > 0
  const buttons = [...document.querySelectorAll('#card .btn')].filter(shown).map((b) => ({ id: b.id, href: b.getAttribute('href'), disabled: b.getAttribute('aria-disabled') === 'true', label: b.textContent, ...inside(b.getBoundingClientRect()) }))
  const detail = document.getElementById('cardDetail')
  const style = shown(detail) ? getComputedStyle(detail) : null
  const card = document.getElementById('card').getBoundingClientRect()
  return {
    width: innerWidth,
    height: innerHeight,
    fontLoaded: loaded.length > 0 && faces.length > 0,
    card: inside(card),
    buttons,
    detail: style ? { ...inside(detail.getBoundingClientRect()), lineHeight: parseFloat(style.lineHeight) } : null
  }
})()`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.disableHardwareAcceleration()
// One window per card, destroyed after it: the last one closing must not quit the app before the next card.
app.on('window-all-closed', () => {})
process.on('unhandledRejection', (error) => {
  console.error('not ok - unhandled:', error && error.stack ? error.stack : error)
  app.exit(1)
})
/** A window with the page loaded, its navigations and its page errors collected (round 29). */
async function openPage(size) {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    resizable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const navigations = []
  const errors = []
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    navigations.push(url)
  })
  win.webContents.on('console-message', (...args) => {
    const first = args[0] || {}
    const level = typeof args[1] === 'number' ? args[1] : first.level
    const message = typeof args[2] === 'string' ? args[2] : first.message
    if (level === 3 || level === 'error') errors.push(`console error: ${message}`)
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  // Round 29: any uncaught exception or rejection in the page fails the check.
  await win.webContents.executeJavaScript(
    "window.__errors = []; addEventListener('error', (e) => window.__errors.push('error: ' + e.message)); addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason))); true"
  )
  return { win, navigations, errors }
}

/** Render one view in the page as it is now (a fresh page or the same one), check it, and click its buttons. */
async function check(page, view, size, transcript) {
  const { win, navigations, errors } = page
  const problems = []
  win.setContentSize(size.width, size.height)
  try {
    await win.webContents.executeJavaScript(`window.render(${JSON.stringify(view)}, false); true`)
  } catch (error) {
    problems.push(`render threw: ${error && error.message ? error.message : error}`)
  }
  await win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'
  )
  const m = await win.webContents.executeJavaScript(measure(font))
  if (m.width !== size.width || m.height !== size.height)
    problems.push(`window ${m.width}x${m.height}, expected ${size.width}x${size.height}`)
  if (!m.fontLoaded) problems.push(`the bundled font "${font}" is not loaded`)
  const asked = Object.keys(BUTTONS)
    .filter((id) => view.controls[id] === true)
    .sort()
  const shownIds = m.buttons.map((b) => b.id).sort()
  if (asked.join() !== shownIds.join())
    problems.push(`buttons shown [${shownIds}] but the view asked for [${asked}]`)
  for (const b of m.buttons)
    if (b.top < 0 || b.left < 0 || b.bottom > m.height + 0.5 || b.right > m.width + 0.5)
      problems.push(
        `button ${b.id} at y ${b.top.toFixed(0)}-${b.bottom.toFixed(0)}, x ${b.left.toFixed(0)}-${b.right.toFixed(0)}: outside ${m.width}x${m.height}`
      )
  if (m.card.bottom > m.height + 0.5)
    problems.push(`the card ends at y ${m.card.bottom.toFixed(0)}, below ${m.height}`)
  if (transcript) {
    if (!m.detail) problems.push('the dictated text is not shown')
    else {
      const visible = Math.min(m.detail.bottom, m.height) - Math.max(m.detail.top, 0)
      if (visible + 0.5 < m.detail.lineHeight)
        problems.push(
          `the dictated text shows ${visible.toFixed(1)} px (a line is ${m.detail.lineHeight} px)`
        )
    }
  }
  let clicked = 0
  for (const b of m.buttons) {
    navigations.length = 0
    await win.webContents.executeJavaScript(
      `document.getElementById(${JSON.stringify(b.id)}).click(); true`
    )
    for (let i = 0; i < 40 && navigations.length === 0; i++) await wait(25)
    if (b.id !== 'offerRestore' || !view.restoring) await wait(0)
    else await wait(100)
    clicked++
    const url = navigations[0]
    const match = url ? actionUrl.exec(url) : null
    const offer = b.id.startsWith('offer')
    // Round 28: an outstanding Restore reads "Restoring…" and a click on it must do nothing at all.
    if (b.id === 'offerRestore' && view.restoring === true) {
      if (!b.disabled || b.label !== 'Restoring…')
        problems.push(`the outstanding Restore reads "${b.label}", disabled ${b.disabled}`)
      if (url) problems.push(`the outstanding Restore navigated to ${url}`)
      continue
    }
    if (b.id === 'offerRestore' && (b.disabled || b.label !== 'Restore'))
      problems.push(`Restore reads "${b.label}", disabled ${b.disabled}`)
    if (!match) problems.push(`button ${b.id} navigated to ${url ?? 'nothing'}: not an action URL`)
    else if (match[1] !== BUTTONS[b.id])
      problems.push(`button ${b.id} carries action ${match[1]}, expected ${BUTTONS[b.id]}`)
    else if (offer ? match[2] !== view.offerRecord : match[2] !== undefined)
      problems.push(`button ${b.id} carries record ${match[2]}, the card shows ${view.offerRecord}`)
  }
  const pageErrors = await win.webContents.executeJavaScript('window.__errors.splice(0)')
  for (const e of [...pageErrors, ...errors.splice(0)]) problems.push(`page ${e}`)
  const buttons = m.buttons
    .map(
      (b) => `${b.id}${b.disabled ? ' (disabled)' : ''} ${b.top.toFixed(0)}-${b.bottom.toFixed(0)}`
    )
    .join(', ')
  const text = m.detail
    ? `text ${m.detail.top.toFixed(0)}-${m.detail.bottom.toFixed(0)}`
    : 'no text'
  return { problems, clicked, summary: `${m.width}x${m.height}; ${buttons}; ${text}` }
}

app.whenReady().then(async () => {
  let failed = 0
  let clicks = 0
  let steps = 0
  for (const c of cases) {
    const page = await openPage(c.size)
    try {
      const r = await check(page, c.view, c.size, c.transcript)
      clicks += r.clicked
      console.log(
        `${r.problems.length ? 'not ok' : 'ok'} - ${c.name}: ${r.summary}${r.problems.length ? ' (' + r.problems.join('; ') + ')' : ''}`
      )
      if (r.problems.length) failed++
    } catch (error) {
      failed++
      console.log(`not ok - ${c.name}: ${error && error.stack ? error.stack : error}`)
    } finally {
      page.win.destroy()
    }
  }
  // Round 29 (Astra P1): SAME-PAGE transitions, as the overlay renders one page view after view.
  let failedSequences = 0
  for (const sequence of sequences) {
    const page = await openPage(sequence.steps[0].size)
    let ok = true
    try {
      for (const [i, step] of sequence.steps.entries()) {
        const r = await check(page, step.view, step.size, step.transcript)
        clicks += r.clicked
        steps++
        console.log(
          `${r.problems.length ? 'not ok' : 'ok'} - ${sequence.name}, step ${i + 1} (${step.name}): ${r.summary}${r.problems.length ? ' (' + r.problems.join('; ') + ')' : ''}`
        )
        if (r.problems.length) ok = false
      }
    } catch (error) {
      ok = false
      console.log(`not ok - ${sequence.name}: ${error && error.stack ? error.stack : error}`)
    } finally {
      page.win.destroy()
    }
    if (!ok) failedSequences++
  }
  console.log(
    `# overlay layout: ${cases.length - failed}/${cases.length} cards and ${sequences.length - failedSequences}/${sequences.length} same-page transition sequences (${steps} steps) pass (bundled font loaded; exactly the asked buttons, enabled or disabled as asked, linked, in view; a line of text; no page error; ${clicks} clicks)`
  )
  app.exit(failed === 0 && failedSequences === 0 ? 0 : 1)
})
