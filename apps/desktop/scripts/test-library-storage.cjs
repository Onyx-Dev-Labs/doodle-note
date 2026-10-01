// Synthetic Electron integration: real storage/main/preload/renderer, intercepted
// folder picker/Finder, stubbed capture engine. Never reads or transfers user data.
const { _electron, expect } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const desktop = path.resolve(__dirname, '..')
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-storage-ui-')))
const profile = path.join(temp, 'profile')
const destination = path.join(temp, 'External drive Café')
const mcpConfig = path.join(temp, 'mcp.json')
const evidence = process.env.DOODLE_QA_ARTIFACTS || path.join(temp, 'evidence')
for (const dir of [profile, destination, evidence]) fs.mkdirSync(dir, { recursive: true })
const mainPath = path.join(desktop, 'out/main/index.js')
let source = fs.readFileSync(mainPath, 'utf8')
assert.ok(source.includes('new EngineProcess(resolveEngineBinary())'))
source = source.replace(
  'new EngineProcess(resolveEngineBinary())',
  'global.mockEngine(new EngineProcess(resolveEngineBinary()))'
)
assert.ok(source.includes('const libraryActivity = new LibraryActivity();'))
source = source.replace(
  'const libraryActivity = new LibraryActivity();',
  'const libraryActivity = global.testLibraryActivity = new LibraryActivity();'
)
source = source.replace(
  'const recording = new RecordingStartCoordinator(',
  'const recording = global.testRecording = new RecordingStartCoordinator('
)
source = source.replace('const meetingsService = new MeetingsService(', 'const meetingsService = global.testMeetings = new MeetingsService(')
fs.writeFileSync(path.join(temp, 'source.cjs'), source)
fs.writeFileSync(
  path.join(temp, 'main.cjs'),
  `
const electron = require('electron');
electron.app.setAppPath(${JSON.stringify(desktop)});
electron.app.setPath('userData', ${JSON.stringify(profile)});
electron.nativeTheme.themeSource = 'light';
global.selection = { canceled: true, filePaths: [] }; global.opened = [];
electron.dialog.showOpenDialog = async () => global.selection;
electron.shell.openPath = async p => { global.opened.push(p); return ''; };
electron.dialog.showMessageBox = async options => { throw new Error('Unexpected startup recovery: ' + options.detail); };
const cp = require('node:child_process'); const spawn = cp.spawn;
cp.spawn = (binary, args, options) => binary.endsWith('/engine')
  ? spawn(process.execPath, ['-e', 'process.exit(0)'], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  : spawn(binary, args, options);
global.mockEngine = engine => { engine.startServe = () => {}; engine.listInputDevices = async () => []; return engine; };
const Module = require('node:module'); const mod = new Module(${JSON.stringify(mainPath)}, module);
mod.filename = ${JSON.stringify(mainPath)};
mod.paths = Module._nodeModulePaths(${JSON.stringify(path.dirname(mainPath))});
require.cache[mod.filename] = mod;
mod._compile(require('node:fs').readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))}, 'utf8'), mod.filename);
`
)
let runtime
async function launch() {
  runtime = await _electron.launch({
    executablePath: require(path.join(desktop, 'node_modules/electron')),
    args: [path.join(temp, 'main.cjs')],
    env: { ...process.env, DOODLE_USER_DATA: profile, DOODLE_NOTE_MCP_CONFIG: mcpConfig }
  })
  // The transfer progress window can be first. Wait for the actual renderer.
  let page
  for (let i = 0; i < 100; i++) {
    page = runtime.windows().find((p) => p.url().includes('index.html'))
    if (page) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(page, 'main window opened after transfer')
  await page.waitForFunction(() => !!window.storage)
  await page.evaluate(() => {
    localStorage.setItem('doodle-onboarding-done', '1')
    localStorage.setItem('doodle-setup-wizard-done', '1')
  })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'General', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Library storage' })).toBeVisible()
  return page
}
;(async () => {
  try {
    let page = await launch()
    const section = page.getByRole('region', { name: 'Library storage' })
    await expect(section.getByText(profile, { exact: true })).toBeVisible()
    await runtime.evaluate(() => {
      global.testMeetings.upsert({
        id: 'fixture-meeting',
        title: 'Synthetic storage test',
        rawNotesMarkdown: 'Keep these notes',
        segments: [
          {
            id: 'seg-1',
            channel: 'mic',
            speaker: 'You',
            text: 'Synthetic transcript',
            startMs: 0,
            endMs: 1000,
            confidence: 1
          }
        ]
      })
    })
    await page.evaluate(() => window.folders.create('Fixture folder'))
    const audioDir = path.join(profile, 'audio/fixture-meeting/1000')
    fs.mkdirSync(audioDir, { recursive: true })
    fs.writeFileSync(path.join(audioDir, 'audio.wav'), Buffer.alloc(64, 0))
    fs.writeFileSync(path.join(profile, 'global-chat.json'), '[]')
    fs.mkdirSync(path.join(profile, 'attachments'))
    fs.writeFileSync(path.join(profile, 'attachments', 'fixture.png'), 'synthetic fixture bytes')
    fs.writeFileSync(
      mcpConfig,
      JSON.stringify({ enabled: false, meetingsDir: path.join(profile, 'meetings') })
    )
    await section.getByRole('button', { name: 'Choose folder…' }).click()
    assert.equal((await page.evaluate(() => window.storage.status())).pendingPath, undefined)
    await runtime.evaluate((_, selected) => {
      global.selection = { canceled: false, filePaths: [selected] }
    }, destination)
    // Reproduce active capture without opening a microphone or starting the engine.
    await runtime.evaluate(() => global.testRecording.beginEngine('busy-fixture'))
    await section.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(section.getByRole('alert')).toContainText('Finish recording or importing')
    assert.equal((await page.evaluate(() => window.storage.status())).pendingPath, undefined)
    await runtime.evaluate(() => global.testRecording.handle({ event: 'exit', code: 0 }))
    // Hold an in-flight background operation; a late renderer save must wait.
    await runtime.evaluate(() => {
      global.testLibraryActivity.run(
        () =>
          new Promise((resolve) => {
            global.releaseBackground = resolve
          })
      )
    })
    const originalPid = runtime.process().pid
    await section.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByRole('dialog', { name: 'Moving library' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Moving library' })).toBeVisible()
    const captureError = await page.evaluate(
      () => new Promise((resolve) => {
        const remove = window.engine.onEvent((event) => {
          if (event.event === 'spawn-error') { remove(); resolve(event.message) }
        })
        window.engine.start('live', undefined, { meetingId: 'blocked-capture' })
      })
    )
    assert.match(captureError, /Wait for the library transfer/)
    assert.equal(await runtime.evaluate(() => global.testRecording.busy), false)
    await page.evaluate(() => {
      window.queuedStorageSave = window.meetings.upsert({
        id: 'queued-during-transfer',
        title: 'Queued during transfer'
      })
    })
    assert.equal(fs.existsSync(path.join(profile, 'meetings/queued-during-transfer.json')), false)
    await page.screenshot({ path: path.join(evidence, 'storage-progress.png') })
    await runtime.evaluate(() => global.releaseBackground())
    let target = path.join(destination, 'DoodleNote Library')
    await expect(section.getByText(target, { exact: true })).toBeVisible()
    await page.evaluate(() => window.queuedStorageSave)
    assert.ok(fs.existsSync(path.join(target, 'meetings/queued-during-transfer.json')))
    assert.equal(fs.existsSync(path.join(profile, 'meetings/queued-during-transfer.json')), false)
    assert.equal(runtime.process().pid, originalPid, 'same app process after transfer')
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(evidence, 'storage-live.png') })
    const status = await page.evaluate(() => window.storage.status())
    assert.equal(status.currentPath, target)
    assert.equal(status.pendingPath, undefined)
    const transferred = await page.evaluate(() => window.meetings.get('fixture-meeting'))
    assert.equal(transferred.rawNotesMarkdown, 'Keep these notes')
    assert.equal(transferred.segments[0].text, 'Synthetic transcript')
    assert.equal((await page.evaluate(() => window.folders.list()))[0].name, 'Fixture folder')
    assert.equal((await page.evaluate(() => window.audio.list('fixture-meeting'))).length, 1)
    await page.evaluate(() =>
      window.meetings.upsert({ id: 'after-transfer', title: 'New destination write' })
    )
    assert.ok(fs.existsSync(path.join(target, 'meetings/after-transfer.json')))
    assert.equal(fs.existsSync(path.join(profile, 'meetings/after-transfer.json')), false)
    assert.ok(fs.existsSync(path.join(profile, 'meetings/fixture-meeting.json')))
    assert.ok(fs.existsSync(path.join(target, 'attachments/fixture.png')))
    assert.ok(fs.existsSync(path.join(target, 'global-chat.json')))
    assert.equal(JSON.parse(fs.readFileSync(mcpConfig)).enabled, false)
    assert.equal(JSON.parse(fs.readFileSync(mcpConfig)).meetingsDir, path.join(target, 'meetings'))
    const storage = page.getByRole('region', { name: 'Library storage' })
    await storage.getByRole('button', { name: 'Open in Finder' }).click()
    assert.deepEqual(await runtime.evaluate(() => global.opened), [target])
    // Existing destination rejected through real IPC, with visible feedback.
    await runtime.evaluate((_, selected) => {
      global.selection = { canceled: false, filePaths: [selected] }
    }, destination)
    await storage.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(storage.getByRole('alert')).toBeVisible()
    assert.equal((await page.evaluate(() => window.storage.status())).pendingPath, undefined)
    await storage.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(evidence, 'storage-transferred.png') })
    const second = path.join(temp, 'Second drive')
    fs.mkdirSync(second)
    const link = path.join(target, 'attachments/unsafe-link.png')
    fs.symlinkSync(path.join(target, 'attachments/fixture.png'), link)
    await runtime.evaluate((_, selected) => {
      global.selection = { canceled: false, filePaths: [selected] }
    }, second)
    await storage.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(storage.getByRole('alert')).toContainText('link or unsupported')
    assert.equal((await page.evaluate(() => window.storage.status())).currentPath, target)
    await storage.getByRole('button', { name: 'Cancel change' }).click()
    assert.equal((await page.evaluate(() => window.storage.status())).pendingPath, undefined)
    await storage.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(storage.getByRole('alert')).toContainText('link or unsupported')
    fs.unlinkSync(link)
    await storage.getByRole('button', { name: 'Retry transfer' }).click()
    target = path.join(second, 'DoodleNote Library')
    await expect
      .poll(() => page.evaluate(() => window.storage.status()).then((status) => status.currentPath))
      .toBe(target)
    await expect(storage.getByText(target, { exact: true })).toBeVisible()
    assert.equal(runtime.process().pid, originalPid)
    assert.equal((await page.evaluate(() => window.storage.status())).pendingPath, undefined)
    await runtime.close()
    runtime = null
    page = await launch()
    assert.equal((await page.evaluate(() => window.storage.status())).currentPath, target)
    assert.equal(
      (await page.evaluate(() => window.meetings.get('after-transfer'))).title,
      'New destination write'
    )
    console.log(
      JSON.stringify({
        passed: true,
        evidence,
        fixture: temp,
        checks: [
          'picker cancellation',
          'active recording rejection and recording start blocked during transfer',
          'progress dialog and background-operation drain',
          'queued save uses new root',
          'failed transfer cancellation and same-process retry',
          'live transfer in same process',
          'notes/transcripts/folders/audio/attachments/chat retained',
          'new write routing',
          'source retained',
          'MCP consent preserved and path refreshed',
          'Finder IPC destination',
          'destination conflict',
          'second restart persistence'
        ]
      })
    )
  } catch (error) {
    console.error(error)
    throw error
  } finally {
    if (runtime) {
      await runtime.evaluate(() => global.releaseBackground?.()).catch(() => {})
      await runtime
        .evaluate(async () => {
          await global.testLibraryActivity?.run(() => {})
        })
        .catch(() => {})
      await runtime.close()
    }
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
