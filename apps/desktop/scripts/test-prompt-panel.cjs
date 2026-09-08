// Native presentation/action QA with synthetic meetings, an isolated Electron
// profile and callback counters. This harness never loads the app or records audio.
// DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-prompt-panel.cjs
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')
const assert = require('node:assert/strict')

async function main() {
  const temp = mkdtempSync(join(tmpdir(), 'doodle-prompt-qa-'))
  const evidence = process.env.DOODLE_QA_OUTPUT || join(temp, 'evidence')
  mkdirSync(evidence, { recursive: true })
  for (const name of ['prompt-panel', 'prompt-panel-content']) {
    const source = readFileSync(resolve(__dirname, '../src/main', `${name}.ts`), 'utf8')
    writeFileSync(join(temp, `${name}.js`), ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText)
  }
  writeFileSync(join(temp, 'main.cjs'), `
    const { app, nativeTheme } = require('electron');
    nativeTheme.themeSource = 'light';
    app.setPath('userData', ${JSON.stringify(join(temp, 'profile'))});
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (cb, ms, ...args) => originalSetTimeout(cb, ms === 240000 ? 15000 : ms, ...args);
    app.whenReady().then(() => {
      const { PromptPanel } = require('./prompt-panel.js');
      global.panel = new PromptPanel(); global.actions = [];
      global.showPrompt = () => global.panel.show({ action:'prompt', eventId:'qa',
        subject:'Design catch-up', startIso:new Date().toISOString() }, action => global.actions.push(action));
      global.showPrompt();
    });
    app.on('window-all-closed', () => {});
  `)
  const runtime = await _electron.launch({ executablePath: require('electron'), args: [join(temp, 'main.cjs')] })
  try {
    let page = await runtime.firstWindow()
    await page.locator('.go').waitFor()
    assert.equal(await page.locator('.go').innerText(), 'Record now')
    const native = await runtime.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return { focused: win.isFocused(), bounds: win.getBounds(), workArea: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea }
    })
    assert.equal(native.focused, false, 'showInactive must not activate the prompt')
    const { bounds: b, workArea: a } = native
    assert.ok(b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('.paw').first().evaluate(el => getComputedStyle(el).animationName), 'none')
    await page.screenshot({ path: join(evidence, 'light-reduced-motion.png') })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(await page.locator('.paw').first().evaluate(el => getComputedStyle(el).animationName), 'paw-step')
    await page.screenshot({ path: join(evidence, 'paws-appearance.png') })
    await page.locator('.card').hover()
    assert.equal(await page.locator('.dismiss').evaluate(el => getComputedStyle(el).opacity), '1')
    await page.screenshot({ path: join(evidence, 'light-hover.png') })
    await page.locator('.dismiss').click().catch(error => { if (!page.isClosed()) throw error })
    assert.deepEqual(await runtime.evaluate(() => global.actions), ['dismiss'])
    assert.equal(await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0)

    const nextPage = runtime.waitForEvent('window')
    await runtime.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; global.showPrompt() })
    page = await nextPage
    await page.locator('.go').waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // Programmatic focus represents keyboard entry without stealing focus on appearance.
    await page.locator('.go').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.dismiss').evaluate(el => el === document.activeElement), true)
    assert.equal(await page.locator('.dismiss').evaluate(el => getComputedStyle(el).opacity), '1')
    await page.screenshot({ path: join(evidence, 'dark-keyboard.png') })
    await page.keyboard.press('Enter').catch(error => { if (!page.isClosed()) throw error })
    assert.deepEqual(await runtime.evaluate(() => global.actions), ['dismiss', 'dismiss'])

    const startPage = runtime.waitForEvent('window')
    await runtime.evaluate(() => global.showPrompt())
    page = await startPage
    await page.locator('.go').click().catch(error => { if (!page.isClosed()) throw error })
    assert.deepEqual(await runtime.evaluate(() => global.actions), ['dismiss', 'dismiss', 'start'])
    assert.equal(await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0)

    // Closing/replacing before the asynchronous page load must not resurrect it.
    await runtime.evaluate(() => { global.showPrompt(); global.panel.close(); global.showPrompt(); global.panel.close() })
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0)
    await runtime.evaluate(() => global.showPrompt())
    await new Promise(resolve => setTimeout(resolve, 15500))
    assert.equal(await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0, 'expiry closes the panel')
    assert.deepEqual(await runtime.evaluate(() => global.actions), ['dismiss', 'dismiss', 'start'])
    console.log(JSON.stringify({ result: 'PASS', evidence, native, checks: ['inactive appearance', 'work-area bounds', 'light/dark', 'hover dismissal', 'keyboard dismissal', 'reduced motion', 'paw animation', 'start callback once', 'replacement cleanup', 'expiry cleanup'] }, null, 2))
  } finally { await runtime.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
