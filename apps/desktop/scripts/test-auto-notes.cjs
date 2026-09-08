// Behavioral desktop smoke using the real renderer, settings IPC and meeting store.
// Capture hardware and AI responses are synthetic; never opens the user's profile.
// Build first. Set DOODLE_PLAYWRIGHT_MODULE to an installed playwright/test entry.
const { _electron: electron, expect } = require(
  process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright/test'
)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ony-271-qa-profile-'))
const artifacts =
  process.env.DOODLE_QA_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ony-271-qa-evidence-'))
fs.mkdirSync(artifacts, { recursive: true })
let app, page
const launch = async () => {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [root],
    env: { ...process.env, DOODLE_USER_DATA: profile }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    localStorage.setItem('doodle-onboarding-done', '1')
    localStorage.setItem('doodle-setup-wizard-done', '1')
  })
  await page.reload()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setTitle('DoodleNote — ONY-271 synthetic QA')
  )
}
const send = async (ev) =>
  app.evaluate(
    ({ BrowserWindow }, ev) =>
      BrowserWindow.getAllWindows()[0].webContents.send('engine:event', ev),
    ev
  )
const count = async () => app.evaluate(() => globalThis.qa.calls.length)
const waitCount = async (n) => expect.poll(count).toBe(n)
;(async () => {
  await launch()
  let settings = await page.evaluate(() => window.notes.getSettings())
  assert.equal(settings.autoGenerateNotesAfterStop, true, 'missing stored setting defaults on')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notes model', exact: true }).click()
  const toggle = page.getByRole('switch', { name: 'Generate notes automatically after Stop' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.scrollIntoViewIfNeeded()
  await page.screenshot({ path: artifacts + '/settings-on.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560))
  await toggle.scrollIntoViewIfNeeded()
  await expect(toggle).toBeInViewport()
  await toggle.click({ trial: true })
  await toggle.hover()
  await page.screenshot({ path: artifacts + '/settings-compact.png' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760))
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  assert.equal(
    JSON.parse(fs.readFileSync(profile + '/settings.json', 'utf8')).autoGenerateNotesAfterStop,
    false
  )
  const disabled = await page.evaluate(() =>
    window.notes.enhance({
      automaticAfterStop: true,
      rawNotesMarkdown: 'Synthetic',
      title: 'QA',
      segments: []
    })
  )
  assert.match(disabled.error, /disabled/)
  await app.close()
  await launch()
  assert.equal(
    (await page.evaluate(() => window.notes.getSettings())).autoGenerateNotesAfterStop,
    false,
    'off survives actual Electron restart'
  )
  await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: true }))
  await app.close()
  await launch()
  assert.equal(
    (await page.evaluate(() => window.notes.getSettings())).autoGenerateNotesAfterStop,
    true,
    'on survives actual Electron restart'
  )
  // Invalid IPC values cannot turn an explicit off back on.
  await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: false }))
  assert.equal(
    (await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: 'true' })))
      .autoGenerateNotesAfterStop,
    false
  )
  // Failed writes report failure, retain the prior in-memory preference, and recover.
  fs.renameSync(profile + '/settings.json', profile + '/settings-backup.json')
  fs.mkdirSync(profile + '/settings.json')
  const failedSave = await page.evaluate(() =>
    window.notes.setSettings({ autoGenerateNotesAfterStop: true })
  )
  assert.match(failedSave.error, /Could not save/)
  assert.equal(failedSave.autoGenerateNotesAfterStop, false)
  fs.rmdirSync(profile + '/settings.json')
  fs.renameSync(profile + '/settings-backup.json', profile + '/settings.json')
  await page.evaluate(() =>
    window.notes.setSettings({
      autoGenerateNotesAfterStop: true,
      engineChoice: 'cloud',
      cloud: null
    })
  )
  const missingKey = await page.evaluate(() =>
    window.notes.enhance({
      automaticAfterStop: true,
      rawNotesMarkdown: 'Synthetic',
      title: 'QA',
      segments: []
    })
  )
  assert.match(missingKey.error, /selected provider/)
  await page.evaluate(() => window.notes.setSettings({ engineChoice: 'local' }))
  // Preserve provider/main settings behavior; only capture hardware and generation are synthetic.
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.qa = { calls: [], pending: [], ready: true, stops: 0, capture: 0 }
    ipcMain.removeAllListeners('engine:start')
    ipcMain.removeAllListeners('engine:stop')
    ipcMain.on('engine:start', () => {
      const w = BrowserWindow.getAllWindows()[0].webContents
      w.send('engine:event', {
        event: 'started',
        command: 'live',
        binaryPath: 'synthetic-qa',
        captureId: String(++qa.capture)
      })
      w.send('engine:event', { event: 'ready' })
    })
    ipcMain.on('engine:stop', () => {
      qa.stops++
      BrowserWindow.getAllWindows()[0].webContents.send('engine:event', {
        event: 'status',
        stage: 'finishing'
      })
    })
    ipcMain.removeHandler('notes:models')
    ipcMain.handle('notes:models', () => ({
      ramGB: 32,
      models: [
        {
          id: 'qa',
          label: 'Synthetic QA',
          downloaded: qa.ready,
          active: true,
          available: true,
          sizeGB: 0,
          minRamGB: 0
        }
      ]
    }))
    ipcMain.removeHandler('notes:enhance')
    ipcMain.handle('notes:enhance', (_e, request) => {
      qa.calls.push(request)
      return new Promise((resolve) => qa.pending.push(resolve))
    })
  })
  let serial = 0
  const segment = (text) => ({
    id: 'seg-' + serial,
    channel: 'mic',
    speaker: 'You',
    text,
    startMs: 0,
    endMs: 1000
  })
  const openMeeting = async (raw = 'Original rough notes') => {
    const id = 'ony-271-qa-' + ++serial
    await page.evaluate(
      ({ id, raw }) =>
        window.meetings.upsert({
          id,
          title: id,
          rawNotesMarkdown: raw,
          segments: [],
          templateId: 'standup'
        }),
      { id, raw }
    )
    await page.reload()
    await page.getByText(id, { exact: true }).first().click()
    await expect(page.locator('.tiptap')).toContainText(raw)
    return id
  }
  const start = async () => {
    await page.getByTitle(/^(Start|Resume) recording$/).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeEnabled()
  }
  const stop = async (detected) => {
    if (detected)
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.send('detect:meeting-ended', {})
      )
    else await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeDisabled()
  }
  const finalize = async (error) => {
    await send({ event: 'done' })
    await send({
      event: 'capture-finalized',
      captureId: await app.evaluate(() => String(qa.capture)),
      ...(error ? { error } : {})
    })
  }
  const resolve = async (
    result = { markdown: '## Synthetic generated notes', engine: 'QA stub' }
  ) => app.evaluate((_electron, result) => qa.pending.shift()(result), result)
  const saved = (id) => page.evaluate((id) => window.meetings.get(id), id)
  const results = []
  // Happy path and both stop routes; finalization must settle before provider invocation.
  for (const detected of [false, true]) {
    const id = await openMeeting()
    await start()
    await send({ event: 'segments', segments: [segment('Provisional wording')] })
    await stop(detected)
    const before = await count()
    await send({ event: 'segments-replaced', segments: [segment('Final refined wording')] })
    assert.equal(await count(), before)
    await page.locator('.tiptap').fill('Fresh rough notes before generation')
    await finalize()
    await waitCount(before + 1)
    const input = await app.evaluate(() => qa.calls.at(-1))
    assert.equal(input.segments[0].text, 'Final refined wording')
    assert.equal(input.rawNotesMarkdown, 'Fresh rough notes before generation')
    assert.equal(input.templateId, 'standup')
    assert.equal(input.automaticAfterStop, true)
    assert.equal(
      (await saved(id)).segments[0].text,
      'Final refined wording',
      'meeting is persisted before provider request'
    )
    await send({ event: 'done' })
    await send({
      event: 'capture-finalized',
      captureId: await app.evaluate(() => String(qa.capture))
    })
    await resolve()
    await expect(page.locator('.tiptap')).toContainText('Synthetic generated notes')
    assert.equal(await count(), before + 1)
    assert.equal((await saved(id)).rawNotesMarkdown, 'Fresh rough notes before generation')
    await page.screenshot({
      path: artifacts + '/' + (detected ? 'detected' : 'manual') + '-generated.png'
    })
    results.push(
      (detected ? 'detected' : 'manual') +
        ' Stop: finalized transcript, freshest rough notes, one request, persisted result'
    )
  }
  // Off means no automatic work on either route. Manual generation still works.
  for (const detected of [false, true]) {
    await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: false }))
    await openMeeting()
    await start()
    await send({ event: 'segments', segments: [segment('Manual recovery transcript')] })
    await stop(detected)
    const before = await count()
    await finalize()
    await expect(page.getByRole('button', { name: 'Generate notes', exact: true })).toBeEnabled()
    assert.equal(await count(), before)
    await page.getByRole('button', { name: 'Generate notes', exact: true }).dblclick()
    await waitCount(before + 1)
    await resolve()
    await expect(page.locator('.tiptap')).toContainText('Synthetic generated notes')
    assert.equal(await count(), before + 1)
    results.push(
      'Off ' +
        (detected ? 'detected' : 'manual') +
        ': no auto request; manual double click generates once'
    )
  }
  await page.evaluate(() => window.notes.setSettings({ autoGenerateNotesAfterStop: true }))
  // A newer edit leaves both authored content and any prior generated version untouched.
  const edited = await openMeeting()
  await start()
  await send({ event: 'segments', segments: [segment('Edit race')] })
  await stop(false)
  let before = await count()
  await finalize()
  await waitCount(before + 1)
  await page.locator('.tiptap').fill('Newer authored edit')
  await resolve()
  await expect(page.getByRole('alert')).toContainText('not applied')
  await expect(page.locator('.tiptap')).toContainText('Newer authored edit')
  assert.equal((await saved(edited)).enhancedMarkdown, undefined)
  results.push('Edits during generation reject stale output')
  await page.screenshot({ path: artifacts + '/edit-recovery.png' })
  // Resume invalidates the old result and retains all previous transcript segments.
  const resumed = await openMeeting()
  await start()
  await send({ event: 'segments', segments: [segment('Before Resume')] })
  await stop(false)
  before = await count()
  await finalize()
  await waitCount(before + 1)
  await start()
  await send({
    event: 'capture-finalized',
    captureId: await app.evaluate(() => String(qa.capture - 1))
  })
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeEnabled()
  await resolve()
  await expect(page.getByRole('alert')).toContainText('not applied')
  assert.equal((await saved(resumed)).enhancedMarkdown, undefined)
  await send({ event: 'segments', segments: [{ ...segment('After Resume'), id: 'second-part' }] })
  await stop(false)
  await finalize()
  await waitCount(before + 2)
  await resolve()
  await expect(page.locator('.tiptap')).toContainText('Synthetic generated notes')
  assert.deepEqual(
    (await saved(resumed)).segments.map((s) => s.text),
    ['Before Resume', 'After Resume']
  )
  results.push('Resume rejects old output; next completed capture includes both transcript parts')
  // Empty, model missing, finalization and provider errors recover without delayed AI.
  for (const failure of ['empty', 'model', 'finalization', 'provider']) {
    await app.evaluate((_e, ready) => {
      qa.ready = ready
    }, failure !== 'model')
    const id = await openMeeting()
    await start()
    if (failure !== 'empty')
      await send({ event: 'segments', segments: [segment('Recovery transcript')] })
    await stop(false)
    before = await count()
    await finalize(failure === 'finalization' ? 'Synthetic save failure' : undefined)
    if (failure === 'provider') {
      await waitCount(before + 1)
      await resolve({ error: 'Synthetic provider failure. Try again.' })
    }
    await expect(page.getByRole('alert')).toBeVisible()
    assert.equal(await count(), before + (failure === 'provider' ? 1 : 0))
    await app.evaluate(() => {
      qa.ready = true
    })
    await page.evaluate(() => window.notes.setSettings({ profileName: 'QA' }))
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
    assert.equal(await count(), before + (failure === 'provider' ? 1 : 0))
    if (failure !== 'empty') assert.equal((await saved(id)).segments[0].text, 'Recovery transcript')
    results.push(failure + ' failure: visible recovery, transcript retained, no delayed auto retry')
  }
  fs.writeFileSync(
    artifacts + '/results.json',
    JSON.stringify(
      {
        settingsRestart: 'on/off persisted through real Electron restarts',
        keyboardSwitch: 'Space toggles accessible switch',
        results,
        limitations:
          'Capture hardware, meeting detector, and provider output are synthetic. Real microphone/audio and installed release QA remain.'
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ results, artifacts, profile }, null, 2))
  await app.close()
})().catch(async (e) => {
  console.error(e)
  if (page)
    console.error(
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    )
  if (app) await app.close()
  process.exit(1)
})
