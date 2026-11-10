// Native integration smoke using the built main/preload/renderer and a fake
// engine in temporary app-data. Never opens an account or captures audio.
// Run after `pnpm --filter desktop build`:
// DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node apps/desktop/scripts/test-settings-redesign.cjs
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const desktop = path.resolve(__dirname, '..')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-local-settings-')))
const main = path.join(desktop, 'out/main/index.js')
const evidence = process.env.DOODLE_QA_ARTIFACTS || path.join(temp, 'evidence')
fs.mkdirSync(evidence, { recursive: true })
const original = fs.readFileSync(main, 'utf8')
assert.ok(
  original.includes('new EngineProcess(resolveEngineBinary())'),
  'Build the desktop app before running this smoke'
)
let source = original.replace(
  'new EngineProcess(resolveEngineBinary())',
  'global.mockEngine(new EngineProcess(resolveEngineBinary()))'
)
fs.writeFileSync(path.join(temp, 'source.cjs'), source)
fs.writeFileSync(
  path.join(temp, 'main.cjs'),
  `
const electron=require('electron');
electron.app.setAppPath(${JSON.stringify(desktop)});
electron.app.setPath('appData',${JSON.stringify(temp)});
electron.app.setPath('userData',${JSON.stringify(path.join(temp, 'profile'))});
electron.nativeTheme.themeSource='light';
global.mockEngine=e=>{e.startServe=()=>{};e.listInputDevices=async()=>[];return e;};
const Module=require('node:module');const mod=new Module(${JSON.stringify(main)},module);mod.filename=${JSON.stringify(main)};mod.paths=Module._nodeModulePaths(${JSON.stringify(path.dirname(main))});require.cache[mod.filename]=mod;mod._compile(require('node:fs').readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))},'utf8'),mod.filename);
`
)
;(async () => {
  let app
  try {
    app = await _electron.launch({
      executablePath: require(path.join(desktop, 'node_modules/electron')),
      args: [path.join(temp, 'main.cjs')],
      env: {
        ...process.env,
        DOODLE_USER_DATA: path.join(temp, 'profile'),
        DOODLE_NOTE_MCP_CONFIG: path.join(temp, 'mcp.json')
      }
    })
    const page = await app.firstWindow()
    await page.waitForFunction(() => !!window.storage)
    await page.evaluate(() => {
      localStorage.setItem('doodle-onboarding-done', '1')
      localStorage.setItem('doodle-setup-wizard-done', '1')
    })
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    let headingTop
    const paddingReports = []
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const label of [
      'General',
      'Calendar',
      'Bark',
      'Appearance',
      'Recording',
      'Storage',
      'Notes model',
      'Get more'
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await page.locator('.settings-page-heading h1').waitFor()
      if (label === 'Bark')
        await page
          .getByRole('switch', { name: 'Turn on Bark', exact: true })
          .waitFor({ timeout: 15000 })
      await page.evaluate(() => document.fonts.ready)
      assert.equal((await page.locator('.settings-page-heading h1').textContent()) !== '', true)
      const metrics = await page.evaluate(() => ({
        body: getComputedStyle(document.body).fontFamily,
        title: getComputedStyle(document.querySelector('.settings-page-heading h1')).fontFamily,
        overflow:
          document.querySelector('.settings-content').scrollWidth >
          document.querySelector('.settings-content').clientWidth + 1
      }))
      const geometry = await page.evaluate(() => ({
        scroll: document.querySelector('.models').scrollTop,
        heading: document.querySelector('.settings-page-heading').getBoundingClientRect().top,
        closed: [...document.querySelectorAll('.settings-content details')].filter((el) => !el.open)
          .length,
        padding: [...document.querySelectorAll('.settings-content .keys-section')].map((el) => ({
          title: el.querySelector('h3')?.textContent,
          top: getComputedStyle(el).paddingTop,
          bottom: getComputedStyle(el).paddingBottom
        }))
      }))
      assert.equal(geometry.scroll, 0, label + ' scroll reset')
      if (headingTop === undefined) headingTop = geometry.heading
      assert.ok(Math.abs(geometry.heading - headingTop) < 1, label + ' heading shifted')
      assert.equal(geometry.closed, 0, label + ' has collapsed disclosures')
      for (const row of geometry.padding)
        assert.equal(row.top, row.bottom, label + ' ' + row.title + ' uneven padding')
      paddingReports.push({ tab: label, ...geometry })
      assert.match(metrics.body, /Figtree/)
      assert.match(metrics.title, /Fraunces/)
      assert.equal(metrics.overflow, false, label + ' overflows')
      await page.screenshot({
        path: path.join(evidence, 'settings-' + label.toLowerCase().replaceAll(' ', '-') + '.png')
      })
      console.log(label, metrics)
      if (label === 'Bark')
        await page
          .locator('.settings-content > .keys-section')
          .first()
          .screenshot({ path: path.join(evidence, 'bark-card.png') })
      if (label === 'Calendar')
        await page
          .locator('.settings-content > .keys-section')
          .last()
          .screenshot({ path: path.join(evidence, 'calendar-display.png') })
      await page.locator('.models').evaluate((el) => (el.scrollTop = 300))
    }
    // The approved Settings presentation locks all integration controls, while
    // the local service still uses its original opt-in boundary without a plan.
    // Every file written here lives in the disposable QA profile.
    assert.equal(await page.locator('.settings-cloud-controls').evaluate((el) => el.inert), true)
    const access = await page.evaluate(() => window.integrations.getAgentAccess())
    assert.equal(access.configPath, path.join(temp, 'mcp.json'))
    assert.equal(access.enabled, false)
    assert.equal(
      (await page.evaluate(() => window.integrations.setAgentAccess(true))).enabled,
      true
    )
    const consent = JSON.parse(fs.readFileSync(access.configPath, 'utf8'))
    assert.equal(consent.enabled, true)
    assert.ok(
      consent.meetingsDir.startsWith(temp + path.sep),
      'local consent must target the temporary library'
    )
    assert.equal(
      (await page.evaluate(() => window.integrations.setAgentAccess(false))).enabled,
      false
    )
    assert.equal(JSON.parse(fs.readFileSync(access.configPath, 'utf8')).enabled, false)
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    console.log('Appearance', await page.locator('.settings-content').innerText())
    const dark = page.getByRole('radio', { name: 'Dark', exact: true })
    await dark.click()
    await page.getByRole('button', { name: 'Bark', exact: true }).click()
    await page.screenshot({ path: path.join(evidence, 'settings-bark-dark.png') })
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    assert.equal(await page.locator('.bark-heading .bark-mark-dark').isVisible(), true)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('index.html'))
        .setSize(900, 760)
    )
    await page.getByRole('button', { name: 'Recording', exact: true }).click()
    await page.screenshot({ path: path.join(evidence, 'settings-compact.png') })
    const compactPadding = await page
      .locator('.settings-content .keys-section')
      .evaluateAll((els) =>
        els.map((el) => ({
          top: getComputedStyle(el).paddingTop,
          bottom: getComputedStyle(el).paddingBottom
        }))
      )
    for (const card of compactPadding) assert.equal(card.top, card.bottom, 'compact padding')
    assert.equal(
      await page
        .locator('.settings-nav-icon .settings-icon')
        .first()
        .evaluate((el) => getComputedStyle(el).strokeWidth),
      '2px'
    )
    fs.writeFileSync(
      path.join(evidence, 'layout-report.json'),
      JSON.stringify({ paddingReports, compactPadding }, null, 2)
    )
    assert.deepEqual(errors, [])
    console.log(
      'PASS: Settings tabs, default-open disclosures, stable heading/scroll reset, symmetric card padding, bundled typography, dark Bark mark, compact layout. Evidence:',
      evidence
    )
  } finally {
    if (app) await app.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
