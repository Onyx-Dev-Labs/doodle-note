// Run against a packaged app with synthetic speech and an isolated profile.
// Requires Playwright 1.62.1 (set DOODLE_PLAYWRIGHT_MODULE for an external install).
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

async function main() {
  const [executable, models, speech, expected] = process.argv.slice(2)
  if (!executable || !models || !speech || !expected) {
    throw new Error(
      'Usage: node smoke-windows-refinement.cjs <exe> <models-dir> <synthetic.wav> <expected phrase>'
    )
  }
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'doodlenote-release-qa-'))
  fs.cpSync(path.resolve(models), path.join(profile, 'asr-models'), { recursive: true })
  const env = { ...process.env }
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
      return {
        profile: app.getPath('userData'),
        version: app.getVersion(),
        packaged: app.isPackaged
      }
    })
    assert.equal(
      path.resolve(actual.profile),
      path.resolve(profile),
      'QA must use an isolated profile'
    )
    assert.equal(actual.packaged, true, 'Use the packaged application')
    const page = await electron.firstWindow()
    await page.evaluate(() => {
      localStorage.setItem('doodle-setup-wizard-done', '1')
      localStorage.setItem('doodle-onboarding-done', '1')
    })
    await page.reload()
    await page.bringToFront()
    await page.locator('body').click({ position: { x: 400, y: 100 } })
    const events = await page.evaluate(async () => {
      const ready = await window.wizard.runPreflight()
      if (!ready.ok) throw new Error('Live model preflight failed')
      return new Promise((resolve, reject) => {
        const events = []
        const timeout = setTimeout(() => reject(new Error('Refinement timed out')), 120000)
        const unsubscribe = window.engine.onEvent((event) => {
          events.push(event)
          if (event.event === 'ready' && event.mode === 'live')
            setTimeout(() => window.engine.stop(), 12000)
          if (event.event === 'exit') {
            clearTimeout(timeout)
            unsubscribe()
            resolve(events)
          }
        })
        window.engine.start('live', undefined, {
          source: 'mic',
          meetingId: 'synthetic-release-qa',
          persistAudio: true
        })
      })
    })
    assert.ok(
      events.some((event) => event.event === 'partial'),
      'Live captions must be available'
    )
    assert.ok(
      events.some((event) => event.event === 'audio'),
      'Recorded audio must finalize'
    )
    assert.ok(
      events.some((event) => event.event === 'refined'),
      'Final refinement must execute'
    )
    assert.ok(
      events.some((event) => event.event === 'segments-replaced'),
      'Final transcript must replace provisional text'
    )
    assert.equal(events.filter((event) => event.event === 'error').length, 0)
    const text = events
      .filter((event) => event.event === 'refined')
      .flatMap((event) => event.transcripts.map((t) => t.text))
      .join(' ')
    assert.ok(
      text.toLowerCase().includes(expected.toLowerCase()),
      'Expected synthetic phrase must survive refinement'
    )
    const sessions = path.join(profile, 'sessions')
    assert.ok(
      fs.readdirSync(sessions).some((name) => name.endsWith('.json')),
      'Final transcript must persist'
    )
    console.log(`Packaged Windows capture/refinement passed: ${actual.version}`)
    console.log(`Isolated QA evidence: ${profile}`)
  } finally {
    // Terminate only this test process tree, including native model workers.
    spawnSync('taskkill', ['/PID', String(electron.process().pid), '/T', '/F'], {
      windowsHide: true
    })
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
