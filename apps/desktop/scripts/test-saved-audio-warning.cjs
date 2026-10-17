// Isolated Electron QA: production main/store/preload/renderer, synthetic engine events.
// Build first, then set DOODLE_PLAYWRIGHT_MODULE to an installed playwright module.
// No hardware capture, model download, account, or personal library is used.
const { _electron, expect } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const desktop = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dev504-electron-'))
const profile = path.join(temp, 'profile')
const evidence = path.join(temp, 'evidence')
fs.mkdirSync(evidence, { recursive: true })
const mainPath = path.join(desktop, 'out/main/index.js')
let source = fs.readFileSync(mainPath, 'utf8')
assert.equal(source.split('new EngineProcess(resolveEngineBinary())').length, 2)
source = source.replace(
  'new EngineProcess(resolveEngineBinary())',
  'global.mockEngine(new EngineProcess(resolveEngineBinary()))'
)
fs.writeFileSync(path.join(temp, 'source.cjs'), source)
fs.writeFileSync(
  path.join(temp, 'main.cjs'),
  `
const electron = require('electron');
electron.app.setAppPath(${JSON.stringify(desktop)});
electron.app.setPath('userData', ${JSON.stringify(profile)});
electron.nativeTheme.themeSource = 'light';
const cp = require('node:child_process'); const spawn = cp.spawn;
cp.spawn = (binary, args, options) => binary.endsWith('/engine')
  ? spawn(process.execPath, ['-e', 'process.exit(0)'], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  : spawn(binary, args, options);
global.mockEngine = engine => {
  global.qaEngine = engine;
  engine.startServe = () => {};
  engine.listInputDevices = async () => [];
  engine.start = command => {
    if (global.qaStartFailure) { engine.emit({ event: 'spawn-error', message: global.qaStartFailure }); return; }
    engine.emit({ event: 'started', command, binaryPath: 'synthetic' });
    engine.emit({ event: 'ready', channels: ['mic', 'system'] });
  };
  engine.stop = () => {
    engine.emit({ event: 'status', stage: 'finishing' });
    setTimeout(() => { engine.emit({ event: 'done' }); engine.emit({ event: 'exit', code: 0, signal: null }); }, 100);
  };
  return engine;
};
const Module = require('node:module'); const mod = new Module(${JSON.stringify(mainPath)}, module);
mod.filename = ${JSON.stringify(mainPath)};
mod.paths = Module._nodeModulePaths(${JSON.stringify(path.dirname(mainPath))});
require.cache[mod.filename] = mod;
mod._compile(require('node:fs').readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))}, 'utf8'), mod.filename);
`
)
let runtime
async function launch() {
  const env = {
    ...process.env,
    DOODLE_USER_DATA: profile,
    DOODLE_NOTE_MCP_CONFIG: path.join(temp, 'mcp.json')
  }
  delete env.ELECTRON_RUN_AS_NODE
  runtime = await _electron.launch({
    executablePath: require(path.join(desktop, 'node_modules/electron')),
    args: [path.join(temp, 'main.cjs')],
    env
  })
  const page = await runtime.firstWindow()
  await page.waitForFunction(() => !!window.meetings)
  await page.evaluate(() => {
    localStorage.setItem('doodle-onboarding-done', '1')
    localStorage.setItem('doodle-setup-wizard-done', '1')
  })
  await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: false }))
  await page.reload()
  return page
}
async function main() {
  console.log('Evidence:', evidence)
  try {
    let page = await launch()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.evaluate(async () => {
      await window.meetings.upsert({
        id: 'qa-audio',
        title: 'Synthetic audio warning QA',
        rawNotesMarkdown: 'Keep these manual notes.',
        segments: [],
        echoSuppressed: 0
      })
    })
    await page.reload()
    await page.getByText('Synthetic audio warning QA', { exact: true }).click()
    const failureMessage = 'The transcription engine is still starting up. Try again in a moment.'
    const failNextStart = () =>
      runtime.evaluate((_, message) => {
        global.qaStartFailure = message
      }, failureMessage)
    const allowStart = () =>
      runtime.evaluate(() => {
        global.qaStartFailure = undefined
      })
    // First-ever attempt fails before started; show the actionable message and permit retry.
    await failNextStart()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(failureMessage)
    assert.equal(await page.evaluate(() => window.engine.snapshot('qa-audio')), null)
    await allowStart()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    const stop = page.getByRole('button', { name: 'Stop recording', exact: true })
    await expect(stop).toBeVisible()
    const emit = (event) => runtime.evaluate((_, ev) => global.qaEngine.emit(ev), event)
    const captureId = await page.evaluate(
      async () => (await window.engine.snapshot('qa-audio')).captureId
    )
    await page.evaluate(() => {
      window.qaEvents = []
      window.engine.onEvent((event) => window.qaEvents.push(event))
    })
    await emit({
      event: 'status',
      stage: 'audio_save_failed',
      channel: 'mic',
      reason: 'ENOSPC /private/synthetic/private-name.caf'
    })
    const warning = page.locator('.saved-audio-warning')
    await expect(warning).toContainText('Microphone')
    await expect(warning).not.toContainText('System audio')
    await page.getByRole('button', { name: 'Minimize transcript', exact: true }).click()
    await emit({ event: 'status', stage: 'transcribing' })
    await emit({
      event: 'status',
      stage: 'audio_save_failed',
      channel: 'system',
      reason: '/private/other.caf'
    })
    await emit({
      event: 'timings',
      channel: 'mic',
      tokens: [
        { token: ' Synthetic speech survives.', startSec: 0, endSec: 1, confidence: 1 },
        { token: ' More', startSec: 3, endSec: 4, confidence: 1 },
        { token: ' speech.', startSec: 4, endSec: 5, confidence: 1 }
      ]
    })
    // Simulate reattachment after an IPC gap using the production snapshot handler.
    await page.getByRole('button', { name: 'Show transcript', exact: true }).click()
    await expect(
      page.locator('.tp-text').filter({ hasText: 'Synthetic speech survives.' })
    ).toBeVisible()
    await expect(warning).toContainText('Microphone and System audio')
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.qaEvents).includes('/private/')),
      false
    )
    for (const [width, height, theme] of [
      [1280, 800, 'light'],
      [800, 640, 'dark']
    ]) {
      await runtime.evaluate(
        ({ BrowserWindow, nativeTheme }, size) => {
          BrowserWindow.getAllWindows()[0].setSize(size.width, size.height)
          nativeTheme.themeSource = size.theme
        },
        { width, height, theme }
      )
      await page.evaluate(
        (theme) => document.documentElement.setAttribute('data-theme', theme),
        theme
      )
      await expect(warning).toBeVisible()
      assert.equal(await warning.getAttribute('role'), 'status')
      await stop.focus()
      await expect(stop).toBeFocused()
      const a = await warning.boundingBox(),
        b = await stop.boundingBox()
      assert.ok(
        a && b && (a.y + a.height <= b.y || b.y + b.height <= a.y),
        'warning does not cover Stop'
      )
      await page.screenshot({ path: path.join(evidence, `recording-${width}-${theme}.png`) })
    }
    await stop.press('Enter')
    await page.getByTitle('Resume recording', { exact: true }).waitFor()
    const saved = await page.evaluate(() => window.meetings.get('qa-audio'))
    assert.deepEqual(saved.savedAudioFailures, { mic: true, system: true })
    assert.equal(saved.rawNotesMarkdown, 'Keep these manual notes.')
    assert.equal(saved.segments[0].text, 'Synthetic speech survives.')
    await page.reload()
    await page.getByText('Synthetic audio warning QA', { exact: true }).click()
    await expect(warning).toContainText('Microphone and System audio')
    // A failed Resume must also remain actionable, then reset cleanly on retry.
    await failNextStart()
    await page.getByTitle('Resume recording', { exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(failureMessage)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.deepEqual(
      await page.evaluate(
        async () => (await window.engine.snapshot('qa-audio')).savedAudioFailures
      ),
      { mic: true, system: true }
    )
    await expect(warning).toBeVisible()
    await allowStart()
    await page.getByTitle('Resume recording', { exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(stop).toBeVisible()
    await emit({ event: 'status', stage: 'audio_save_failed', channel: 'mic', captureId })
    assert.deepEqual(
      await page.evaluate(
        async () => (await window.engine.snapshot('qa-audio')).savedAudioFailures
      ),
      {}
    )
    await expect(warning).toBeVisible() // earlier part is still incomplete
    await stop.click()
    await page.getByTitle('Resume recording', { exact: true }).waitFor()
    // Empty capture A exposes the vacuous .every() in the ended-snapshot filter.
    await page.getByRole('button', { name: 'Back to home', exact: true }).click()
    await page.evaluate(() =>
      window.meetings.upsert({
        id: 'qa-empty',
        title: 'Empty degraded capture',
        rawNotesMarkdown: 'Keep empty capture notes.'
      })
    )
    await page.reload()
    await page.getByText('Empty degraded capture', { exact: true }).click()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(stop).toBeVisible()
    await emit({
      event: 'status',
      stage: 'audio_save_failed',
      channel: 'mic',
      reason: '/private/empty.caf'
    })
    await stop.click()
    await expect
      .poll(() => page.evaluate(async () => (await window.engine.snapshot('qa-empty'))?.phase))
      .toBe('ended')
    const emptySnapshot = await page.evaluate(() => window.engine.snapshot('qa-empty'))
    assert.deepEqual(emptySnapshot.segments, [])
    assert.deepEqual(emptySnapshot.savedAudioFailures, { mic: true })
    // Stay in this main process: B must not receive A's capture ID on a pre-start failure.
    await page.getByRole('button', { name: 'Back to home', exact: true }).click()
    await page.evaluate(() =>
      window.meetings.upsert({
        id: 'qa-next',
        title: 'Next meeting startup failure',
        rawNotesMarkdown: ''
      })
    )
    await page.reload()
    await page.getByText('Next meeting startup failure', { exact: true }).click()
    await failNextStart()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(failureMessage)
    // Real TranscriptSession -> snapshot IPC filter -> MeetingView reducer on focus.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    assert.equal(await page.evaluate(() => window.engine.snapshot('qa-next')), null)
    await expect(page.locator('.saved-audio-warning')).toHaveCount(0)
    assert.deepEqual(await page.evaluate(() => window.engine.snapshot('qa-empty')), emptySnapshot)
    // A delayed accepted checkpoint must keep A's destination and base while B is pending.
    await emit({ event: 'refined', captureId: emptySnapshot.captureId, transcripts: [] })
    assert.deepEqual(
      await page.evaluate(async () => (await window.meetings.get('qa-empty')).savedAudioFailures),
      { mic: true }
    )
    assert.deepEqual(
      await page.evaluate(
        async () => (await window.meetings.get('qa-next')).savedAudioFailures ?? {}
      ),
      {}
    )
    await page.screenshot({ path: path.join(evidence, 'next-meeting-startup-failure.png') })
    await allowStart()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(stop).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await emit({
      event: 'spawn-error',
      captureId: emptySnapshot.captureId,
      message: 'Stale previous capture failure'
    })
    await emit({
      event: 'status',
      stage: 'audio_save_failed',
      channel: 'mic',
      captureId: emptySnapshot.captureId,
      reason: '/private/stale.caf'
    })
    await expect(stop).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('.saved-audio-warning')).toHaveCount(0)
    await stop.click()
    await expect
      .poll(() => page.evaluate(async () => (await window.engine.snapshot('qa-next'))?.phase))
      .toBe('ended')
    // A failed file-mode attempt retains the last live snapshot; an actual file
    // start removes it and cannot route file callbacks into either meeting.
    const nextSnapshot = await page.evaluate(() => window.engine.snapshot('qa-next'))
    const nextMeeting = await page.evaluate(() => window.meetings.get('qa-next'))
    await failNextStart()
    await page.evaluate(() => window.engine.start('transcribe', 'synthetic.wav'))
    await expect(page.getByRole('alert')).toContainText(failureMessage)
    assert.deepEqual(await page.evaluate(() => window.engine.snapshot('qa-next')), nextSnapshot)
    await allowStart()
    await page.evaluate(() => window.engine.start('transcribe', 'synthetic.wav'))
    await expect.poll(() => page.evaluate(() => window.engine.snapshot('qa-next'))).toBe(null)
    await emit({ event: 'refined', transcripts: [] })
    await emit({ event: 'done' })
    await emit({ event: 'exit', code: 0, signal: null })
    assert.deepEqual(await page.evaluate(() => window.meetings.get('qa-next')), nextMeeting)
    assert.deepEqual(
      await page.evaluate(async () => (await window.meetings.get('qa-empty')).savedAudioFailures),
      { mic: true }
    )
    await runtime.close()
    runtime = null
    page = await launch()
    await page.getByText('Synthetic audio warning QA', { exact: true }).click()
    await expect(page.locator('.saved-audio-warning')).toContainText('Microphone and System audio')
    await page.screenshot({ path: path.join(evidence, 'reopened-after-relaunch.png') })
    await page.getByRole('button', { name: 'Back to home', exact: true }).click()
    await page.evaluate(() =>
      window.meetings.upsert({
        id: 'qa-clean',
        title: 'Fresh successful session',
        rawNotesMarkdown: ''
      })
    )
    await page.reload()
    await page.getByText('Fresh successful session', { exact: true }).click()
    await page.getByTitle('Start recording', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible()
    await expect(page.locator('.saved-audio-warning')).toHaveCount(0)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    assert.deepEqual(errors, [])
    fs.writeFileSync(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          result: 'PASS',
          platform: process.platform,
          node: process.version,
          scope:
            'Real Electron main/preload/store/renderer; synthetic engine events. No native writer failure or playable-part validation.'
        },
        null,
        2
      )
    )
    console.log(
      'PASS: per-channel warning, sanitized IPC, continuing text, hide/show, snapshot, keyboard Stop, Resume, relaunch persistence, stale rejection, fresh meeting, light/dark wide/narrow, first-ever/A-to-B/Resume pre-start errors and successful retry, empty-capture snapshot/checkpoint ownership, file-mode boundaries'
    )
  } finally {
    if (runtime) await runtime.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
