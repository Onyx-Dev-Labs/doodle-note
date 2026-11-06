// Packaged Windows meeting smoke through the real recorder UI: a long
// utterance with no pauses is transcribed completely (forced utterance cuts),
// and a forced engine backlog shows, then clears, the "running behind" notice.
// Synthetic audio and an isolated profile only. Requires Playwright 1.62.1
// (set DOODLE_PLAYWRIGHT_MODULE for an external install).
//
//   node smoke-windows-meeting-ui.cjs <exe> <models-dir> <long-synthetic.wav> <phrase|phrase|...>
//
// The backlog comes from DOODLENOTE_ASR_TEST_STALL_MS (an inert QA hook in the
// engine worker that stalls the session's first decode once).
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function main() {
  const [executable, models, speech, phrases] = process.argv.slice(2)
  if (!executable || !models || !speech || !phrases) {
    throw new Error('Usage: node smoke-windows-meeting-ui.cjs <exe> <models-dir> <speech.wav> <phrases>')
  }
  const stallMs = Number(process.env.DOODLE_SMOKE_STALL_MS ?? 8000)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doodlenote-meeting-ui-'))
  const evidence = path.join(profile, 'evidence')
  fs.mkdirSync(evidence)
  fs.cpSync(path.resolve(models), path.join(profile, 'asr-models'), { recursive: true })
  const env = { ...process.env, DOODLENOTE_ASR_TEST_STALL_MS: String(stallMs) }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({
    executablePath: path.resolve(executable),
    args: [
      `--user-data-dir=${profile}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve(speech)}%noloop`
    ],
    env,
    timeout: 60000
  })
  try {
    const actual = await electron.evaluate(({ app, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.setBackgroundThrottling(false)
      return { profile: app.getPath('userData'), packaged: app.isPackaged, version: app.getVersion() }
    })
    assert.equal(path.resolve(actual.profile), path.resolve(profile), 'isolated profile')
    assert.equal(actual.packaged, true)
    const page = await electron.firstWindow()
    await page.evaluate(() => {
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle-onboarding-done', '1')
    })
    await page.reload()
    await page.bringToFront()
    const ready = await page.evaluate(() => window.wizard.runPreflight())
    assert.equal(ready.ok, true, JSON.stringify(ready))
    await page.evaluate(() => {
      window.__events = []
      window.engine.onEvent((event) => window.__events.push({ ...event, at: Date.now() }))
    })
    const started = Date.now()
    // The same path as New -> New meeting: opens the recorder and starts capture.
    await page.evaluate(() => window.recording.requestStart())
    const notice = page.locator('.saved-audio-warning', { hasText: 'running behind' })
    await notice.waitFor({ state: 'visible', timeout: 30000 })
    const shownAfterMs = Date.now() - started
    await page.screenshot({ path: path.join(evidence, 'captions-delayed.png') })
    await notice.waitFor({ state: 'hidden', timeout: 30000 })
    const clearedAfterMs = Date.now() - started
    await page.screenshot({ path: path.join(evidence, 'captions-caught-up.png') })
    // Let the whole synthetic utterance play, then Stop from the recorder.
    const remaining = 46000 - (Date.now() - started)
    if (remaining > 0) await page.waitForTimeout(remaining)
    await page.evaluate(() => window.engine.stop())
    await page.waitForFunction(() => window.__events.some((event) => event.event === 'exit'), null, {
      timeout: 60000
    })
    const events = await page.evaluate(() => window.__events)
    fs.writeFileSync(path.join(evidence, 'events.json'), JSON.stringify(events, null, 1))
    const statuses = events.filter((event) => event.event === 'status').map((event) => event.stage)
    assert.ok(statuses.includes('captions_delayed'))
    assert.ok(statuses.includes('captions_caught_up'))
    const mic = events.filter((event) => event.event === 'timings' && event.channel === 'mic')
    const tokens = mic.flatMap((event) => event.tokens)
    const text = tokens.map((token) => token.token).join('')
    for (const phrase of phrases.split('|')) {
      assert.ok(normalize(text).includes(normalize(phrase)), `missing "${phrase}" in: ${text}`)
    }
    // Words never repeat across a forced cut: no doubled word or phrase.
    const words = normalize(text).split(' ')
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + 2 * n <= words.length; i++) {
        const gram = words.slice(i, i + n).join(' ')
        assert.notEqual(words.slice(i + n, i + 2 * n).join(' '), gram, `doubled "${gram}"`)
      }
    }
    const spans = mic.map((event) => [event.tokens[0].startSec, event.tokens.at(-1).endSec])
    const sessions = path.join(profile, 'sessions')
    const saved = JSON.parse(
      fs.readFileSync(path.join(sessions, fs.readdirSync(sessions).find((n) => n.endsWith('.json'))), 'utf8')
    )
    const ordered = saved.segments.every(
      (segment, index, all) =>
        index === 0 ||
        (all[index - 1].absoluteStartMs ?? all[index - 1].startMs) <=
          (segment.absoluteStartMs ?? segment.startMs)
    )
    assert.ok(ordered, 'saved transcript is in time order')
    console.log(
      JSON.stringify({
        version: actual.version,
        profile,
        noticeShownAfterMs: shownAfterMs,
        noticeClearedAfterMs: clearedAfterMs,
        commits: spans,
        words: words.length,
        savedSegments: saved.segments.length,
        text
      })
    )
    console.log('Packaged Windows meeting UI smoke passed')
  } finally {
    spawnSync('taskkill', ['/PID', String(electron.process().pid), '/T', '/F'], { windowsHide: true })
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
