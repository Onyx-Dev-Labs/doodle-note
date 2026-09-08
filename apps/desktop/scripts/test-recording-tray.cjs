// Run after desktop build. Exercises real main/preload/renderer with a synthetic
// engine: no microphone, calendar account, model download or user profile access.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')

async function main() {
  const desktop = process.env.DOODLE_DESKTOP_PATH || path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'doodle-tray-qa-'))
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
  fs.writeFileSync(path.join(temp, 'source.cjs'), source)
  fs.writeFileSync(
    path.join(temp, 'main.cjs'),
    `
    const electron = require('electron');
    const { app, nativeTheme } = electron;
    app.setAppPath(${JSON.stringify(desktop)});
    app.setPath('userData', ${JSON.stringify(profile)});
    nativeTheme.themeSource = 'light';
    global.trays = []; global.starts = []; global.failure = false; global.holdReady = true;
    global.captureTray = tray => {
      global.trays.push(tray);
      const setImage = tray.setImage.bind(tray);
      tray.setImage = image => { tray.qaImage = image; return setImage(image) };
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
        if (!global.holdReady) engine.emit({ event: 'ready' });
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
  const iconState = () =>
    runtime.evaluate(() => {
      const image = global.trays[0].qaImage
      const pixels = image.toBitmap({ scaleFactor: 1 })
      const { width, height } = image.getSize()
      let redPixels = 0
      let leftEyePixels = 0
      let rightEyePixels = 0
      let redOutsideEyes = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 2] > 200 && pixels[i + 1] < 100 && pixels[i] < 100 && pixels[i + 3] > 200) {
          redPixels++
          const x = (((i / 4) % width) + 0.5) / width
          const y = (Math.floor(i / 4 / width) + 0.5) / height
          if (y >= 0.34 && y <= 0.49 && x >= 0.29 && x <= 0.42) leftEyePixels++
          else if (y >= 0.34 && y <= 0.49 && x >= 0.58 && x <= 0.71) rightEyePixels++
          else redOutsideEyes++
        }
      }
      return {
        template: image.isTemplateImage(),
        scales: image.getScaleFactors(),
        redPixels,
        leftEyePixels,
        rightEyePixels,
        redOutsideEyes,
        png: image.toPNG().toString('base64')
      }
    })
  const assertIcon = async (recording) => {
    const icon = await iconState()
    assert.equal(icon.template, !recording)
    assert.equal(icon.redPixels > 0, recording, 'red eyes match confirmed capture')
    assert.equal(icon.leftEyePixels > 0, recording, 'left eye changes color')
    assert.equal(icon.rightEyePixels > 0, recording, 'right eye changes color')
    assert.equal(icon.redOutsideEyes, 0, 'no recording dot outside the eyes')
    assert.deepEqual(icon.scales, [1, 2])
    return icon
  }
  const start = async () => {
    await runtime.evaluate(() => {
      setImmediate(() => global.trays[0].qaMenu.items[0].click())
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const waitIdle = async () => {
    for (let i = 0; i < 80; i++) {
      if ((await menu())[0].label === 'Record now') return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('tray did not become idle')
  }
  try {
    console.log('Native tray QA: waiting for renderer')
    let page = await runtime.firstWindow()
    await page.waitForFunction(() => !!window.recording)
    assert.equal((await menu())[0].enabled, false, 'setup required')
    await page.evaluate(() => {
      localStorage.setItem('doodle-onboarding-done', '1')
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle.inputDeviceUid', 'qa-mic')
    })
    await page.reload()
    await waitIdle()
    assert.equal(
      await page.evaluate(async () => (await window.calendar.getState()).signedIn),
      false
    )
    console.log('Native tray QA: checking start and icon lifecycle')
    await assertIcon(false)
    await start()
    for (let i = 0; i < 80 && (await runtime.evaluate(() => global.starts.length)) === 0; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(await runtime.evaluate(() => global.starts.length), 1)
    assert.equal((await menu())[0].label, 'Starting…')
    await assertIcon(false)
    await runtime.evaluate(() => {
      global.holdReady = false
      global.qaEngine.emit({ event: 'ready' })
    })
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    assert.equal((await menu())[0].label, 'Recording…')
    const setTheme = async (theme) => {
      const expected = await runtime.evaluate(({ nativeTheme, nativeImage, app }, theme) => {
        nativeTheme.themeSource = theme
        const name = theme === 'dark' ? 'dogRecordingDark.png' : 'dogRecordingLight.png'
        return nativeImage
          .createFromPath(app.getAppPath() + '/resources/tray/' + name)
          .toPNG()
          .toString('base64')
      }, theme)
      for (let i = 0; i < 40 && (await iconState()).png !== expected; i++) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const icon = await assertIcon(true)
      assert.equal(icon.png === expected, true, `active icon follows ${theme} theme`)
      return icon
    }
    console.log('Native tray QA: checking light/dark recording artwork')
    const light = await setTheme('light')
    const dark = await setTheme('dark')
    assert.equal(dark.png !== light.png, true, 'theme assets differ')
    fs.writeFileSync(
      path.join(evidence, 'dog-recording-light.png'),
      Buffer.from(light.png, 'base64')
    )
    fs.writeFileSync(path.join(evidence, 'dog-recording-dark.png'), Buffer.from(dark.png, 'base64'))
    await runtime.evaluate(({ nativeTheme }) => {
      setImmediate(() => {
        nativeTheme.themeSource = 'light'
      })
    })
    console.log('Native tray QA: checking duplicate and window lifecycle')
    await start() // even a stale native menu activation must be rejected in main
    assert.equal(await runtime.evaluate(() => global.starts.length), 1)
    const first = await runtime.evaluate(() => global.starts[0])
    assert.equal(first.opts.inputDevice, 'qa-mic')
    assert.equal(first.opts.source, 'both')
    assert.equal(first.opts.persistAudio, true)
    assert.equal(first.opts.systemBackend, 'tap')
    await page.screenshot({ path: path.join(evidence, 'recording.png') })
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    )
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false
    )
    await runtime.evaluate(() => global.trays[0].qaMenu.items[2].click())
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    assert.equal((await menu())[0].label, 'Finishing…')
    await assertIcon(false)
    await start()
    assert.equal(await runtime.evaluate(() => global.starts.length), 1)
    await waitIdle()
    // Close idle main entirely; a tray start must create a new renderer.
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    const nextWindow = runtime.waitForEvent('window')
    nextWindow.catch(() => {})
    await start()
    page = await nextWindow
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    assert.equal(await runtime.evaluate(() => global.starts.length), 2)
    assert.equal(await page.evaluate(async () => (await window.meetings.list()).length), 2)
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await waitIdle()
    await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await start()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    assert.equal(
      await runtime.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()),
      false
    )
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await waitIdle()
    console.log('Native tray QA: checking failed-start recovery')
    await runtime.evaluate(() => {
      global.failure = true
    })
    await start()
    await page
      .getByRole('alert')
      .getByText('QA engine unavailable — check setup and retry.', { exact: true })
      .waitFor()
    await waitIdle()
    await assertIcon(false)
    await page.screenshot({ path: path.join(evidence, 'engine-failure.png') })
    assert.equal(await page.getByRole('button', { name: 'Stop recording', exact: true }).count(), 0)
    assert.equal(await page.evaluate(async () => (await window.meetings.list()).length), 4)
    const icon = await runtime.evaluate(({ nativeImage, app }) => {
      const image = nativeImage.createFromPath(app.getAppPath() + '/resources/tray/dogTemplate.png')
      image.setTemplateImage(true)
      return {
        size: image.getSize(),
        scales: image.getScaleFactors(),
        template: image.isTemplateImage(),
        png: image.toPNG().toString('base64')
      }
    })
    fs.writeFileSync(path.join(evidence, 'dog-template.png'), Buffer.from(icon.png, 'base64'))
    assert.deepEqual(icon.size, { width: 18, height: 18 })
    assert.deepEqual(icon.scales, [1, 2])
    assert.equal(icon.template, true)
    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          evidence,
          starts: await runtime.evaluate(() => global.starts.length),
          checks: [
            'setup gate',
            'no calendar',
            'single click capture route',
            'saved input device',
            'duplicate suppression',
            'close while active preserves renderer',
            'closed-window delivery',
            'minimized-window delivery',
            'finishing lock',
            'engine failure recovery',
            'Retina template resources',
            'no red eyes before engine ready or after stop/failure',
            'colored recording eyes and live light/dark switching'
          ],
          limitation:
            'Engine is synthetic; real saved audio/transcript and OS permission QA remain required.'
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
