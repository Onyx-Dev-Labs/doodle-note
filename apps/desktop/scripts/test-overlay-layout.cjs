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
const { html, cases, actionPattern, font } = JSON.parse(fs.readFileSync(file, 'utf8'))
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
  const buttons = [...document.querySelectorAll('#card .btn')].filter(shown).map((b) => ({ id: b.id, href: b.getAttribute('href'), ...inside(b.getBoundingClientRect()) }))
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
app.whenReady().then(async () => {
  let failed = 0
  let clicks = 0
  for (const c of cases) {
    const win = new BrowserWindow({
      show: false,
      width: c.size.width,
      height: c.size.height,
      useContentSize: true,
      frame: false,
      resizable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const navigations = []
    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      navigations.push(url)
    })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await win.webContents.executeJavaScript(
        `window.render(${JSON.stringify(c.view)}, false); true`
      )
      // Two frames for layout after the render.
      await win.webContents.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'
      )
      const m = await win.webContents.executeJavaScript(measure(font))
      const problems = []
      if (m.width !== c.size.width || m.height !== c.size.height)
        problems.push(`window ${m.width}x${m.height}, expected ${c.size.width}x${c.size.height}`)
      if (!m.fontLoaded) problems.push(`the bundled font "${font}" is not loaded`)
      const asked = Object.keys(BUTTONS)
        .filter((id) => c.view.controls[id] === true)
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
      if (c.transcript) {
        if (!m.detail) problems.push('the dictated text is not shown')
        else {
          const visible = Math.min(m.detail.bottom, m.height) - Math.max(m.detail.top, 0)
          if (visible + 0.5 < m.detail.lineHeight)
            problems.push(
              `the dictated text shows ${visible.toFixed(1)} px (a line is ${m.detail.lineHeight} px)`
            )
        }
      }
      // Every shown button, clicked: its URL must parse into its action (and an offer's into the shown record).
      for (const b of m.buttons) {
        navigations.length = 0
        await win.webContents.executeJavaScript(
          `document.getElementById(${JSON.stringify(b.id)}).click(); true`
        )
        for (let i = 0; i < 40 && navigations.length === 0; i++) await wait(25)
        clicks++
        const url = navigations[0]
        const match = url ? actionUrl.exec(url) : null
        const offer = b.id.startsWith('offer')
        if (!match)
          problems.push(`button ${b.id} navigated to ${url ?? 'nothing'}: not an action URL`)
        else if (match[1] !== BUTTONS[b.id])
          problems.push(`button ${b.id} carries action ${match[1]}, expected ${BUTTONS[b.id]}`)
        else if (offer ? match[2] !== c.view.offerRecord : match[2] !== undefined)
          problems.push(
            `button ${b.id} carries record ${match[2]}, the card shows ${c.view.offerRecord}`
          )
      }
      const buttons = m.buttons
        .map((b) => `${b.id} ${b.top.toFixed(0)}-${b.bottom.toFixed(0)}`)
        .join(', ')
      const text = m.detail
        ? `text ${m.detail.top.toFixed(0)}-${m.detail.bottom.toFixed(0)}`
        : 'no text'
      console.log(
        `${problems.length ? 'not ok' : 'ok'} - ${c.name}: ${m.width}x${m.height}; ${buttons}; ${text}${problems.length ? ' (' + problems.join('; ') + ')' : ''}`
      )
      if (problems.length) failed++
    } catch (error) {
      failed++
      console.log(`not ok - ${c.name}: ${error && error.stack ? error.stack : error}`)
    } finally {
      win.destroy()
    }
  }
  console.log(
    `# overlay layout: ${cases.length - failed}/${cases.length} cards (bundled font loaded; exactly the asked buttons, in view; a line of text; ${clicks} clicks parsed to their action and record)`
  )
  app.exit(failed === 0 ? 0 : 1)
})
