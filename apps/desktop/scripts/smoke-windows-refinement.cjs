// Packaged Windows capture smoke: live captions, Stop, saved audio, playback
// data and an audio import, with synthetic speech and an isolated profile.
// There is no post-stop refinement pass (Mac parity): the live Parakeet
// transcript is final, and this script asserts that no refinement runs.
// Requires Playwright 1.62.1 (set DOODLE_PLAYWRIGHT_MODULE for an external install).
//
//   node smoke-windows-refinement.cjs <exe> <models-dir> <synthetic.wav> <expected phrase>
//
// <models-dir> must contain the live models
// (sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming and silero-vad)
// and, for the import, sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8; they are
// copied into the temporary profile.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
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
    const meetingId = 'synthetic-release-qa'
    const started = Date.now()
    const events = await page.evaluate(async (meetingId) => {
      const ready = await window.wizard.runPreflight()
      if (!ready.ok) throw new Error(`Live model preflight failed: ${ready.error ?? ''}`)
      return new Promise((resolve, reject) => {
        const events = []
        const timeout = setTimeout(() => reject(new Error('Capture did not finish')), 120000)
        const unsubscribe = window.engine.onEvent((event) => {
          events.push({ ...event, at: Date.now() })
          if (event.event === 'ready' && event.mode === 'live')
            setTimeout(() => window.engine.stop(), 14000)
          if (event.event === 'exit') {
            clearTimeout(timeout)
            unsubscribe()
            resolve(events)
          }
        })
        window.engine.start('live', undefined, { source: 'mic', meetingId, persistAudio: true })
      })
    }, meetingId)
    // Event log (no audio) next to the isolated profile, for diagnosing failures.
    fs.writeFileSync(path.join(profile, 'smoke-events.json'), JSON.stringify(events, null, 1))
    const partials = events.filter((event) => event.event === 'partial' && event.text)
    assert.ok(partials.length > 0, 'Live captions must be available')
    const timings = events.flatMap((event) => (event.event === 'timings' ? event.tokens : []))
    assert.ok(timings.length > 0, 'Live token timings must be emitted')
    assert.ok(
      timings.some((token) => token.confidence !== 0.9),
      'Token confidences must come from the model'
    )
    const finalText = events
      .filter((event) => event.event === 'final')
      .map((event) => event.text)
      .join(' ')
    assert.match(finalText, /[A-Z]/, 'Live transcript keeps casing')
    assert.match(finalText, /[.,?!]/, 'Live transcript keeps punctuation')
    assert.ok(
      normalize(finalText).includes(normalize(expected)),
      `Expected synthetic phrase must be in the live transcript: ${finalText}`
    )
    const stopAt = events.find((event) => event.event === 'status' && event.stage === 'finishing')?.at
    const exitAt = events.find((event) => event.event === 'exit')?.at
    assert.ok(
      events.some((event) => event.event === 'audio'),
      'Recorded audio must finalize'
    )
    assert.ok(
      !events.some((event) => event.event === 'refined' || event.stage === 'refining_transcript'),
      'Windows has no post-stop refinement pass'
    )
    assert.equal(events.filter((event) => event.event === 'error').length, 0)
    const sessions = path.join(profile, 'sessions')
    assert.ok(
      fs.readdirSync(sessions).some((name) => name.endsWith('.json')),
      'Final transcript must persist'
    )

    // Playback data for the saved recording.
    const playback = await page.evaluate(async (meetingId) => {
      const parts = await window.audio.list(meetingId)
      const first = parts[0] ? await window.audio.read(parts[0].url) : null
      return {
        parts: parts.length,
        bytes: first?.data?.byteLength ?? first?.bytes?.byteLength ?? 0,
        durationMs: parts[0]?.durationMs
      }
    }, meetingId)
    assert.ok(playback.parts > 0, 'Saved recording must be listed for playback')
    assert.ok(playback.bytes > 44, 'Saved recording must be readable for playback')

    // Import the same speech as an external file: one neutral speaker.
    await electron.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, path.resolve(speech))
    const imported = await page.evaluate(async () => {
      const result = await window.importer.importAudio()
      if (!result.meetingId) return { result }
      const meeting = await window.meetings.get(result.meetingId)
      return { result, segments: meeting?.segments ?? [] }
    })
    assert.ok(imported.result.meetingId, `Import failed: ${JSON.stringify(imported.result)}`)
    const importedText = imported.segments.map((segment) => segment.text).join(' ')
    assert.ok(
      normalize(importedText).includes(normalize(expected)),
      `Expected synthetic phrase must be in the imported transcript: ${importedText}`
    )
    assert.ok(imported.segments.every((segment) => segment.speaker === 'Speaker'))

    console.log(
      JSON.stringify({
        version: actual.version,
        profile,
        liveFinal: finalText,
        partials: partials.length,
        tokens: timings.length,
        stopToExitMs: stopAt && exitAt ? exitAt - stopAt : null,
        captureMs: Date.now() - started,
        playback,
        importedText,
        importedSegments: imported.segments.length
      })
    )
    console.log(`Packaged Windows capture and import passed: ${actual.version}`)
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
