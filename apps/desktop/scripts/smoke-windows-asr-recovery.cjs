// Packaged Windows speech-model recovery smoke (isolated profiles, synthetic audio):
//  1. upgrade: a profile that only has the earlier builds' cached Zipformer can
//     record at once (with an honest notice) and gets a transcript; Parakeet
//     downloads in the background and the next recording uses it;
//  2. repair: a Parakeet model with the right sizes but damaged contents
//     (which aborts the native loader) is verified and downloaded again when
//     setup is retried.
// Both download the 502 MB model from the pinned k2-fsa release.
//
//   node smoke-windows-asr-recovery.cjs <exe> <models-dir> <synthetic.wav>
//
// <models-dir> must contain sherpa-onnx-streaming-zipformer-en-2023-06-26 and
// sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming.
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')

const ZIPFORMER = 'sherpa-onnx-streaming-zipformer-en-2023-06-26'
const UNIFIED = 'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming'

async function launch(profile, speech) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const electron = await _electron.launch({
    executablePath: path.resolve(process.argv[2]),
    args: [
      `--user-data-dir=${profile}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve(speech)}%noloop`
    ],
    env,
    timeout: 60000
  })
  const page = await electron.firstWindow()
  await page.evaluate(() => {
    localStorage.setItem('doodle-setup-wizard-done', '1')
    localStorage.setItem('doodle-onboarding-done', '1')
  })
  await page.reload()
  return { electron, page }
}

function close(electron) {
  spawnSync('taskkill', ['/PID', String(electron.process().pid), '/T', '/F'], { windowsHide: true })
}

/** Record ~14 s through the recorder and return the engine events. */
async function record(page) {
  await page.evaluate(() => {
    window.__events = []
    window.engine.onEvent((event) => window.__events.push(event))
  })
  await page.evaluate(() => window.recording.requestStart())
  await page.waitForFunction(() => window.__events.some((e) => e.event === 'ready'), null, {
    timeout: 30000
  })
  await page.waitForTimeout(14000)
  const notices = await page.locator('.saved-audio-warning').allInnerTexts()
  await page.evaluate(() => window.engine.stop())
  await page.waitForFunction(() => window.__events.some((e) => e.event === 'exit'), null, {
    timeout: 60000
  })
  return { events: await page.evaluate(() => window.__events), notices }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function upgrade(models, speech) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doodlenote-upgrade-'))
  fs.cpSync(path.join(models, ZIPFORMER), path.join(profile, 'asr-models', ZIPFORMER), { recursive: true })
  const { electron, page } = await launch(profile, speech)
  try {
    const began = Date.now()
    const ready = await page.evaluate(() => window.wizard.runPreflight())
    const readyMs = Date.now() - began
    assert.equal(ready.ok, true, 'an updated install with the cached model is ready at once')
    const first = await record(page)
    const stages = first.events.filter((e) => e.event === 'status').map((e) => e.stage)
    assert.ok(stages.includes('legacy_model'), 'the capture reports the previous model')
    assert.ok(first.notices.some((n) => /previous speech model/.test(n)), 'the notice is visible')
    const legacyText = first.events
      .filter((e) => e.event === 'final')
      .map((e) => e.text)
      .join(' ')
    assert.match(legacyText, /CONFIRMATION NUMBER/, `legacy transcript: ${legacyText}`)
    const unifiedDir = path.join(profile, 'asr-models', UNIFIED)
    await waitFor(
      () => fs.existsSync(path.join(unifiedDir, 'encoder.int8.onnx')),
      300000,
      'background Parakeet download'
    )
    const downloadedMs = Date.now() - began
    // Allow the worker to load the new model between sessions.
    await page.waitForTimeout(8000)
    await page.reload()
    const second = await record(page)
    const secondStages = second.events.filter((e) => e.event === 'status').map((e) => e.stage)
    assert.ok(!secondStages.includes('legacy_model'), 'the next recording uses Parakeet')
    const parakeetText = second.events
      .filter((e) => e.event === 'final')
      .map((e) => e.text)
      .join(' ')
    assert.match(parakeetText, /[a-z]/, 'Parakeet output is cased')
    return { profile, readyMs, downloadedMs, legacyText, parakeetText, notices: first.notices }
  } finally {
    close(electron)
  }
}

async function repair(models, speech) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doodlenote-repair-'))
  const target = path.join(profile, 'asr-models', UNIFIED)
  fs.cpSync(path.join(models, UNIFIED), target, { recursive: true })
  // Same size, damaged contents.
  const encoder = path.join(target, 'encoder.int8.onnx')
  const fd = fs.openSync(encoder, 'r+')
  fs.writeSync(fd, Buffer.alloc(4096, 0), 0, 4096, 1000)
  fs.writeSync(fd, Buffer.alloc(65536, 0xff), 0, 65536, 300_000_000)
  fs.closeSync(fd)
  const { electron, page } = await launch(profile, speech)
  try {
    const failed = await page.evaluate(() => window.wizard.runPreflight())
    assert.equal(failed.ok, false, 'the damaged model fails to load')
    const began = Date.now()
    const repaired = await page.evaluate(() => window.wizard.runPreflight())
    assert.equal(repaired.ok, true, `retry repairs the model: ${JSON.stringify(repaired)}`)
    return { profile, firstError: failed.error, repairMs: Date.now() - began }
  } finally {
    close(electron)
  }
}

async function main() {
  const [, , , models, speech] = process.argv
  if (!process.argv[2] || !models || !speech) {
    throw new Error('Usage: node smoke-windows-asr-recovery.cjs <exe> <models-dir> <synthetic.wav>')
  }
  const results = {}
  if (process.env.DOODLE_SMOKE_SKIP_UPGRADE !== '1') results.upgrade = await upgrade(models, speech)
  if (process.env.DOODLE_SMOKE_SKIP_REPAIR !== '1') results.repair = await repair(models, speech)
  console.log(JSON.stringify(results))
  console.log('Packaged Windows speech-model recovery smoke passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
