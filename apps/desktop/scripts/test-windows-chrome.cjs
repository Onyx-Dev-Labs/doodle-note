// Windows window-chrome behavior check against the real (packaged) app, with an
// isolated profile. Measures what the person gets, not the CSS text:
//   - the Window Controls Overlay is on and headers stay left of it
//   - the sidebar logo receives clicks under the invisible title band
//   - Settings uses the thin Windows scrollbar, not Chromium's stock one
// Requires Playwright 1.62.1 (set DOODLE_PLAYWRIGHT_MODULE for an external install).
//
//   node test-windows-chrome.cjs <DoodleNote.exe> [screenshot-dir]
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const [executable, shots] = process.argv.slice(2)
  if (!executable)
    throw new Error('Usage: node test-windows-chrome.cjs <DoodleNote.exe> [screenshot-dir]')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-chrome-qa-'))
  let app
  // Never hang CI: kill the app and fail if any step stalls.
  const watchdog = setTimeout(() => {
    console.error('Windows chrome check timed out')
    try {
      app?.process().kill()
    } catch {
      /* already gone */
    }
    removeProfile(profile)
    process.exit(1)
  }, 120_000)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({
    executablePath: path.resolve(executable),
    args: [`--user-data-dir=${profile}`],
    env,
    timeout: 60000
  })
  try {
    const userData = await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1000, height: 700 })
      return app.getPath('userData')
    })
    assert.equal(path.resolve(userData), path.resolve(profile), 'QA must use an isolated profile')
    const page = await app.firstWindow()
    await page.evaluate(() => {
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle-onboarding-done', '1')
    })
    await page.reload()
    await page.locator('.home-topbar').waitFor()

    const home = await page.evaluate(() => {
      const overlay = navigator.windowControlsOverlay
      const area = overlay.getTitlebarAreaRect()
      const logo = document.querySelector('.wordmark').getBoundingClientRect()
      const x = Math.round(logo.left + logo.width / 2)
      // Every point of the logo inside the title band must hit the logo itself.
      const probes = [23, 30, 38].filter((y) => y >= logo.top && y < logo.bottom)
      const hits = probes.map((y) => {
        const el = document.elementFromPoint(x, y)
        return { y, inLogo: !!el?.closest('.wordmark'), tag: el?.tagName, cls: el?.className }
      })
      const topbarButtons = [...document.querySelectorAll('.home-topbar button')].map((b) =>
        b.getBoundingClientRect().toJSON()
      )
      return {
        platform: document.documentElement.dataset.platform,
        visible: overlay.visible,
        area: area.toJSON(),
        logo: logo.toJSON(),
        hits,
        topbarButtons
      }
    })
    assert.equal(home.platform, 'win32')
    assert.equal(home.visible, true, 'Window Controls Overlay is visible')
    assert.ok(home.area.height >= 32, 'caption buttons have height')
    assert.ok(home.hits.length > 0, 'the logo reaches into the title band')
    for (const hit of home.hits)
      assert.ok(hit.inLogo, `logo receives the pointer at y=${hit.y} (got ${hit.tag}.${hit.cls})`)
    const overlayLeft = home.area.x + home.area.width
    for (const rect of home.topbarButtons)
      assert.ok(
        rect.right <= overlayLeft,
        `header button ends at ${rect.right}, overlay starts at ${overlayLeft}`
      )
    // A real click near the top of the logo navigates home without errors.
    await page.mouse.click(Math.round(home.logo.left + home.logo.width / 2), 23)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('.models.settings-redesign').waitFor()
    const settings = await page.evaluate(() => {
      const scroller = document.querySelector('.models.settings-redesign')
      const style = getComputedStyle(scroller)
      const label = document.querySelector('.settings-privacy-label').getBoundingClientRect()
      const area = navigator.windowControlsOverlay.getTitlebarAreaRect()
      return {
        scrollbarWidthProp: style.scrollbarWidth,
        scrollbarColorProp: style.scrollbarColor,
        renderedScrollbar: scroller.offsetWidth - scroller.clientWidth,
        overflow: scroller.scrollHeight > scroller.clientHeight,
        labelRight: label.right,
        labelTop: label.top,
        overlayLeft: area.x + area.width,
        overlayBottom: area.y + area.height
      }
    })
    // Standard scrollbar-* properties would make Chromium ignore ::-webkit-scrollbar.
    assert.equal(settings.scrollbarWidthProp, 'auto')
    assert.equal(settings.scrollbarColorProp, 'auto')
    assert.equal(settings.renderedScrollbar, 10, 'thin 10 px Windows scrollbar, not the stock one')
    assert.ok(
      settings.labelRight <= settings.overlayLeft || settings.labelTop >= settings.overlayBottom,
      'Settings header label is clear of the caption buttons'
    )
    if (shots) {
      fs.mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: path.join(shots, 'windows-chrome-settings.png') })
    }
    console.log(JSON.stringify({ home, settings }, null, 2))
    console.log('Windows window chrome behavior checks passed')
  } finally {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 15_000))])
    try {
      app.process().kill()
    } catch {
      /* already exited */
    }
    clearTimeout(watchdog)
    removeProfile(profile)
  }
}

/** The app may hold profile files briefly after exit on Windows. */
function removeProfile(profile) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true })
      return
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
  console.warn(`Could not remove the temporary profile ${profile}`)
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
