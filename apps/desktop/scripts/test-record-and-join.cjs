// ONY-306 Record & Join integration using a synthetic engine and intercepted opener. Exercises
// the real prompt/main/preload/renderer path with a synthetic
// engine: no microphone, calendar account, model download or user profile access.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

async function main() {
  const desktop = process.env.DOODLE_DESKTOP_PATH || path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-join-qa-'))
  const mainPath = path.join(desktop, 'out/main/index.js')
  const profile = path.join(temp, 'profile')
  const evidence = path.join(temp, 'evidence')
  fs.mkdirSync(evidence, { recursive: true })
  let source = fs.readFileSync(mainPath, 'utf8')
  assert.equal(source.split('new EngineProcess(resolveEngineBinary())').length, 2)
  source = source.replace(
    'new EngineProcess(resolveEngineBinary())',
    'global.mockEngine(new EngineProcess(resolveEngineBinary()))'
  )
  assert.equal(source.split('new electron.Tray(image)').length, 2)
  source = source.replace(
    'new electron.Tray(image)',
    'global.captureTray(new electron.Tray(image))'
  )
  source += "\nObject.defineProperty(global, 'qaCalendar', { get: () => calendarService });\n"
  fs.writeFileSync(path.join(temp, 'source.cjs'), source)
  fs.writeFileSync(
    path.join(temp, 'main.cjs'),
    `
    const electron = require('electron');
    const { app, nativeTheme } = electron;
    app.setAppPath(${JSON.stringify(desktop)});
    app.setPath('userData', ${JSON.stringify(profile)});
    nativeTheme.themeSource = 'light';
    global.trays = []; global.starts = []; global.failure = false; global.joined = []; global.joinFailure = false;
    electron.shell.openExternal = async url => { global.joined.push(url); if (global.joinFailure) throw new Error('Synthetic link launch failure'); };
    global.captureTray = tray => {
      global.trays.push(tray);
      const setContextMenu = tray.setContextMenu.bind(tray);
      tray.setContextMenu = menu => { tray.qaMenu = menu; return setContextMenu(menu) };
      return tray;
    };
    const cp = require('node:child_process');
    const spawn = cp.spawn;
    cp.spawn = (binary, args, options) => binary.endsWith('/engine')
      ? spawn(process.execPath, ['-e', 'process.exit(0)'], { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      : spawn(binary, args, options);
    global.mockEngine = engine => {
      global.qaEngine = engine;
      engine.startServe = () => {};
      engine.listInputDevices = async () => { await new Promise(r => setTimeout(r, 200)); return [{ uid: 'qa-mic', name: 'QA microphone', isDefault: false }] };
      engine.start = (command, filePath, opts) => {
        global.starts.push({ command, opts });
        if (global.failure) { engine.emit({ event: 'spawn-error', message: 'QA engine unavailable — check setup and retry.' }); return }
        engine.emit({ event: 'started', command, binaryPath: 'synthetic' });
        engine.emit({ event: 'ready' });
      };
      engine.stop = () => {
        engine.emit({ event: 'status', stage: 'finishing' });
        setTimeout(() => { engine.emit({ event: 'done' }); engine.emit({ event: 'exit', code: 0, signal: null }); }, 350);
      };
      return engine;
    };
    const Module = require('node:module');
    const mod = new Module(${JSON.stringify(mainPath)}, module);
    mod.filename = ${JSON.stringify(mainPath)};
    mod.paths = Module._nodeModulePaths(${JSON.stringify(path.dirname(mainPath))});
    require.cache[mod.filename] = mod;
    mod._compile(require('node:fs').readFileSync(${JSON.stringify(path.join(temp, 'source.cjs'))}, 'utf8'), ${JSON.stringify(mainPath)});
  `
  )
  const runtime = await _electron.launch({
    executablePath: require(path.join(desktop, 'node_modules/electron')),
    args: [path.join(temp, 'main.cjs')],
    env: { ...process.env, DOODLE_USER_DATA: profile }
  })
  const menu = () =>
    runtime.evaluate(() =>
      global.trays[0].qaMenu.items.map((i) => ({ label: i.label, enabled: i.enabled }))
    )
  const waitIdle = async () => {
    for (let i = 0; i < 80; i++) {
      if ((await menu())[0].label === 'Record now') return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('tray did not become idle')
  }
  const fixture = (id) => ({
    action: 'prompt',
    eventId: id,
    subject: 'Synthetic planning call',
    joinUrl: 'https://meet.google.com/aaa-bbbb-ccc',
    joinRequested: true,
    startIso: new Date().toISOString()
  })
  const show = async (id) => {
    const next = runtime.waitForEvent('window')
    await runtime.evaluate((_, event) => {
      // Main resolves only events in its current selected snapshot (ONY-307/308).
      global.qaCalendar.rawEvents = [
        {
          id: event.eventId,
          calendarId: '',
          subject: event.subject,
          startIso: event.startIso,
          endIso: new Date(Date.parse(event.startIso) + 3600000).toISOString(),
          joinUrl: event.joinUrl,
          isAllDay: false,
          isOnlineMeeting: false,
          hasParticipants: true
        }
      ]
      setImmediate(() => global.qaCalendar.deliverPrompt(event))
    }, fixture(id))
    const panel = await next
    await panel.locator('.go').waitFor()
    return panel
  }
  const closeClick = async (locator) => {
    await locator.click().catch((error) => {
      if (!locator.page().isClosed()) throw error
    })
  }
  try {
    let page = await runtime.firstWindow()
    await page.waitForFunction(() => !!window.recording)
    await page.evaluate(() => {
      localStorage.setItem('doodle-onboarding-done', '1')
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle.inputDeviceUid', 'qa-mic')
    })
    await page.reload()
    await waitIdle()
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    let panel = await show('dismiss-only')
    assert.equal(await panel.getByRole('link', { name: 'Record & Join', exact: true }).count(), 1)
    await closeClick(panel.locator('.dismiss'))
    assert.equal(await runtime.evaluate(() => global.joined.length), 0)
    assert.equal(await runtime.evaluate(() => global.starts.length), 0)
    assert.equal(await page.evaluate(async () => (await window.meetings.list()).length), 0)
    await page.locator('.mb-dismiss').waitFor({ state: 'detached' })

    // The panel is the only window. Its real start callback must create a renderer.
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    panel = await show('record-once')
    const nextMain = runtime.waitForEvent('window')
    await panel.getByRole('link', { name: 'Record & Join', exact: true }).focus()
    await panel.keyboard.press('Enter').catch((error) => {
      if (!panel.isClosed()) throw error
    })
    page = await nextMain
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    assert.equal(await runtime.evaluate(() => global.starts.length), 1)
    const meetings = await page.evaluate(() => window.meetings.list())
    assert.equal(meetings.length, 1)
    assert.equal(meetings[0].calendarEventId, 'record-once')
    assert.deepEqual(await runtime.evaluate(() => global.joined), [
      'https://meet.google.com/aaa-bbbb-ccc'
    ])
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    )
    const accepted = await page.evaluate(
      (event) => window.recording.requestStart(event),
      fixture('record-once')
    )
    assert.equal(accepted, false)
    assert.equal(await runtime.evaluate(() => global.joined.length), 1)
    assert.equal(await runtime.evaluate(() => global.starts.length), 1)
    await runtime.evaluate(
      (_, event) => global.qaCalendar.deliverPrompt(event),
      fixture('suppressed')
    )
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    )
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await waitIdle()

    // An explicit start for an existing calendar meeting resumes it without a second record.
    await runtime.evaluate((_, event) => {
      setImmediate(() => global.qaCalendar.actOnPromptStart(event))
    }, fixture('record-once'))
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    assert.equal(await runtime.evaluate(() => global.starts.length), 2)
    assert.equal(await runtime.evaluate(() => global.joined.length), 2)
    assert.equal(await page.evaluate(async () => (await window.meetings.list()).length), 1)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await waitIdle()

    // Dismissal through the banner API closes the external surface too.
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    panel = await show('banner-dismiss')
    await page.evaluate(() => window.calendar.dismissPrompt())
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    )
    await page.locator('.mb-dismiss').waitFor({ state: 'detached' })
    assert.equal(await runtime.evaluate(() => global.starts.length), 2)

    await runtime.evaluate(({ BrowserWindow }) => {
      global.joinFailure = true
      BrowserWindow.getAllWindows()[0].show()
      BrowserWindow.getAllWindows()[0].focus()
    })
    await runtime.evaluate(
      (_, event) => {
        global.qaCalendar.rawEvents = [
          {
            id: event.eventId,
            calendarId: '',
            subject: event.subject,
            startIso: event.startIso,
            endIso: new Date(Date.parse(event.startIso) + 3600000).toISOString(),
            isAllDay: false,
            isOnlineMeeting: true,
            hasParticipants: true,
            joinUrl: event.joinUrl
          }
        ]
        global.qaCalendar.deliverPrompt(event)
      },
      { ...fixture('join-failure'), joinUrl: 'https://teams.microsoft.com/l/meetup-join/fixture' }
    )
    const action = page.getByRole('button', { name: 'Record & Join', exact: true })
    await action.waitFor()
    await action.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    const retry = page.getByRole('button', { name: 'Join again', exact: true })
    await retry.waitFor()
    const beforeRetry = await runtime.evaluate(() => ({
      starts: global.starts.length,
      joined: global.joined.length
    }))
    assert.equal(beforeRetry.starts, 3)
    assert.equal(
      await runtime.evaluate(() => global.joined.at(-1)),
      'https://teams.microsoft.com/l/meetup-join/fixture'
    )
    const alertBounds = await page.getByRole('alert').filter({ has: retry }).boundingBox()
    const stopBounds = await page
      .getByRole('button', { name: 'Stop recording', exact: true })
      .boundingBox()
    assert.ok(
      alertBounds.y + alertBounds.height <= stopBounds.y,
      'Join failure must not cover recording controls'
    )
    await page.screenshot({ path: path.join(evidence, 'join-failure-recording.png') })
    await page.reload()
    await retry.waitFor()
    await runtime.evaluate(() => {
      global.joinFailure = false
    })
    await retry.click()
    await retry.waitFor({ state: 'detached' })
    assert.equal(await runtime.evaluate(() => global.starts.length), beforeRetry.starts)
    assert.equal(await runtime.evaluate(() => global.joined.length), beforeRetry.joined + 1)
    // Reload returns to Home; stop the retained synthetic capture through the real engine IPC.
    await page.evaluate(() => window.engine.stop())
    await waitIdle()
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())

    await runtime.evaluate(() => {
      global.failure = true
    })
    panel = await show('failed-start')
    await closeClick(panel.locator('.go'))
    await page
      .getByRole('alert')
      .getByText('QA engine unavailable — check setup and retry.', { exact: true })
      .waitFor()
    await waitIdle()
    assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    )
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          checks: [
            'panel dismissal opens no link or recording',
            'exact keyboard-accessible Record & Join on panel and banner',
            'Google and Microsoft links routed to their own event',
            'join failure preserves recording and survives reload',
            'join-only retry does not start another capture',
            'closed-main-window panel start',
            'one intended calendar meeting',
            'repeated start rejected',
            'recording suppresses external prompt',
            'existing calendar meeting resumes',
            'banner dismissal closes panel',
            'engine failure stays actionable'
          ],
          evidence,
          limitation:
            'Synthetic engine and intercepted opener; no real provider handoff, audio or installed-client proof.'
        },
        null,
        2
      )
    )
  } finally {
    await runtime.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
