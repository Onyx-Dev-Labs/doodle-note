// Real packaged Windows model initialization. Requiring the addon alone does
// not exercise ORT's API version check (and missed the System32 DLL collision).
const assert = require('node:assert/strict')
const { cpSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')

async function main() {
  assert.equal(process.platform, 'win32', 'Run Windows acceptance in Windows')
  const executablePath = resolve(process.argv[2])
  const profile = mkdtempSync(join(tmpdir(), 'doodle-asr-runtime-'))
  if (process.env.DOODLE_WINDOWS_ASR_MODELS) {
    cpSync(process.env.DOODLE_WINDOWS_ASR_MODELS, join(profile, 'asr-models'), { recursive: true })
  }
  let app
  try {
    app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`] })
    const page = await app.firstWindow()
    const result = await page.evaluate(async () => {
      let timer
      try {
        return await Promise.race([
          window.wizard.runPreflight(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Native ASR setup timed out')), 600_000)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    // Exercise the same compiled worker's stream construction and finalization
    // with bounded synthetic silence. This does not open any capture device.
    const stream = await app.evaluate(async ({ utilityProcess, app }) => {
      return await new Promise((resolve, reject) => {
        const worker = utilityProcess.fork(`${app.getAppPath()}\\out\\main\\engine-win.js`)
        const timer = setTimeout(() => finish(new Error('Native ASR stream timed out')), 60_000)
        let settled = false
        let ready = false
        function finish(error) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          worker.kill()
          error ? reject(error) : resolve({ ready, finalized: true })
        }
        worker.on('exit', (code) => finish(new Error(`Native ASR exited: ${code}`)))
        worker.on('message', (message) => {
          const event = message.event
          if (!event) return
          if (event.event === 'error') return finish(new Error(event.message))
          if (event.event === 'status' && event.stage === 'serve_ready') {
            worker.postMessage({ t: 'start', channels: ['system'], sessionId: 1 })
          }
          if (event.event === 'ready') {
            ready = true
            worker.postMessage({
              t: 'audio',
              channel: 'system',
              sessionId: 1,
              samples: new Float32Array(16_000)
            })
            worker.postMessage({ t: 'stop', sessionId: 1 })
          }
          if (event.event === 'done') finish()
        })
        worker.postMessage({ t: 'init', modelsDir: `${app.getPath('userData')}\\asr-models` })
      })
    })
    assert.deepEqual(stream, { ready: true, finalized: true })
    console.log(JSON.stringify({ executablePath, profile, preflight: result, stream }))
  } finally {
    await app?.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
