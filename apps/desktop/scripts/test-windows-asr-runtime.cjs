// Real packaged Windows model initialization. Requiring the addon alone does
// not exercise ORT's API version check (and missed the System32 DLL collision).
const assert = require('node:assert/strict')
const { cpSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')

const REGISTRY_TEST_GUID = '00000000-0000-0000-0000-000000000000'

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
        let serve = null
        let final = null
        function finish(error) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          worker.kill()
          error ? reject(error) : resolve({ ready, finalized: final !== null, serve })
        }
        worker.on('exit', (code) => finish(new Error(`Native ASR exited: ${code}`)))
        worker.on('message', (message) => {
          const event = message.event
          if (!event) return
          if (event.event === 'error') return finish(new Error(event.message))
          if (event.event === 'status' && event.stage === 'serve_ready') {
            serve = { model: event.model, calibrationRtf: event.calibrationRtf, captionMode: event.captionMode }
            worker.postMessage({ t: 'start', channels: ['system'], sessionId: 1 })
          }
          if (event.event === 'final') final = event
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
    assert.equal(stream.ready, true)
    assert.equal(stream.finalized, true)
    // The live model is Parakeet Unified behind Silero VAD; calibration ran natively.
    assert.equal(stream.serve.model, 'sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming')
    assert.ok(stream.serve.calibrationRtf > 0, JSON.stringify(stream.serve))
    assert.ok(['interim', 'utterance'].includes(stream.serve.captionMode))
    // Round 7: the same packaged worker reads and writes the install folder move's registry
    // values for the app (windows-registry.ts): no PowerShell or reg.exe in the app's path.
    // A throwaway all-zero GUID identity, removed below.
    const registry = await app.evaluate(async ({ utilityProcess, app }, guid) => {
      const worker = utilityProcess.fork(`${app.getAppPath()}\\out\\main\\engine-win.js`)
      let next = 1
      const pending = new Map()
      worker.on('message', (message) => {
        if (message.t !== 'helper' || message.op !== 'reg') return
        pending.get(message.id)?.(message)
        pending.delete(message.id)
      })
      const ask = (body) =>
        new Promise((resolve, reject) => {
          const id = next++
          const timer = setTimeout(() => reject(new Error('registry request timed out')), 60_000)
          pending.set(id, (reply) => {
            clearTimeout(timer)
            resolve(reply)
          })
          worker.postMessage({ t: 'reg', id, ...body })
        })
      const status = `Software\\DoodleNote-InstallStatus\\${guid}`
      try {
        return {
          absent: await ask({ op: 'read', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
          write: await ask({
            op: 'write',
            subKey: status,
            values: [
              ['AppMigrationReason', 'ci Jörg 李'],
              ['AppMigration', 'pending']
            ]
          }),
          readBack: await ask({ op: 'read', subKey: status, name: 'AppMigrationReason' }),
          refused: await ask({ op: 'write', subKey: status, values: [['LastResult', 'x']] }),
          deleted: await ask({ op: 'delete', subKey: `Software\\${guid}`, name: 'MigrationRecord' })
        }
      } finally {
        worker.kill()
      }
    }, REGISTRY_TEST_GUID)
    assert.deepEqual(registry.absent.ok, true, JSON.stringify(registry))
    assert.equal(registry.absent.value, null)
    assert.equal(registry.write.ok, true, JSON.stringify(registry))
    assert.equal(registry.readBack.value, 'ci Jörg 李')
    assert.deepEqual([registry.refused.ok, registry.refused.code], [false, 'SCOPE'])
    assert.equal(registry.deleted.ok, true)
    console.log(JSON.stringify({ executablePath, profile, preflight: result, stream, registry }))
  } finally {
    await app?.close()
    try {
      execFileSync(
        'reg.exe',
        ['delete', `HKCU\\Software\\DoodleNote-InstallStatus\\${REGISTRY_TEST_GUID}`, '/f'],
        {
          stdio: 'ignore'
        }
      )
    } catch {
      // Not created.
    }
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
