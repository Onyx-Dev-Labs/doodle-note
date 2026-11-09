#!/usr/bin/env node
// Round 24 (Astra): the overlay's cards rendered for real, in Electron's Chromium with the bundled font, at the
// window size the app gives them (overlaySize). For every notice variant (scripts/overlay-layout-fixtures.ts
// writes them): every visible button lies wholly inside the window, the card does too, and a card that carries the
// dictated text shows at least one whole line of it. Run (Windows CI, or any desktop with a display):
//   electron scripts/test-overlay-layout.cjs <fixtures.json>
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const file = process.argv.find((a) => a.endsWith('.json'))
if (!file) {
  console.error('usage: electron scripts/test-overlay-layout.cjs <fixtures.json>')
  process.exit(2)
}
const { html, cases } = JSON.parse(fs.readFileSync(file, 'utf8'))

const measure = `(() => {
  const inside = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
  const shown = (el) => el && !el.hidden && el.getClientRects().length > 0
  const buttons = [...document.querySelectorAll('#card .btn')].filter(shown).map((b) => ({ id: b.id, ...inside(b.getBoundingClientRect()) }))
  const detail = document.getElementById('cardDetail')
  const style = shown(detail) ? getComputedStyle(detail) : null
  const card = document.getElementById('card').getBoundingClientRect()
  return {
    width: innerWidth,
    height: innerHeight,
    font: document.fonts.check('12px "Doodle Figtree"'),
    card: inside(card),
    buttons,
    detail: style ? { ...inside(detail.getBoundingClientRect()), lineHeight: parseFloat(style.lineHeight) } : null
  }
})()`

app.disableHardwareAcceleration()
// One window per card, destroyed after it: the last one closing must not quit the app before the next card.
app.on('window-all-closed', () => {})
process.on('unhandledRejection', (error) => {
  console.error('not ok - unhandled:', error && error.stack ? error.stack : error)
  app.exit(1)
})
app.whenReady().then(async () => {
  let failed = 0
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
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
      await win.webContents.executeJavaScript(
        `window.render(${JSON.stringify(c.view)}, false); true`
      )
      // Two frames for layout after the render.
      await win.webContents.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'
      )
      const m = await win.webContents.executeJavaScript(measure)
      const problems = []
      if (m.width !== c.size.width || m.height !== c.size.height)
        problems.push(`window ${m.width}x${m.height}, expected ${c.size.width}x${c.size.height}`)
      if (!m.font) problems.push('the bundled font did not load')
      if (m.buttons.length === 0) problems.push('no button shown')
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
    `# overlay layout: ${cases.length - failed}/${cases.length} cards keep their buttons and a line of text in view`
  )
  app.exit(failed === 0 ? 0 : 1)
})
