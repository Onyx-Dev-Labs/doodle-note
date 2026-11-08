// Real packaged Windows model initialization. Requiring the addon alone does
// not exercise ORT's API version check (and missed the System32 DLL collision).
const assert = require('node:assert/strict')
const { cpSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require(process.env.DOODLE_PLAYWRIGHT_MODULE || 'playwright')

// The production package's own APP_GUID (electron-builder's UUID v5 of com.doodlenote.desktop);
// the worker may touch nothing else. Another (all-zero) GUID must be refused.
const PRODUCTION_GUID = 'f85f8dcf-6782-5a3e-a989-3eae169d6efb'
const OTHER_GUID = '00000000-0000-0000-0000-000000000000'

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
            serve = {
              model: event.model,
              calibrationRtf: event.calibrationRtf,
              captionMode: event.captionMode
            }
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
    // Round 9: its scope is its own identity only, so this smoke only reads the production
    // identity's own values (absent on a fresh runner; nothing is written) and checks that
    // everything else is refused before any Win32 call. The write and delete paths run for
    // real in the windows-installer-e2e job (the installed QA app writes its status and
    // consumes its record) and in windows-registry.test.ts.
    const registry = await app.evaluate(
      async ({ utilityProcess, app }, [guid, other]) => {
        // As engine-host-win.ts forks it: the identity on its command line
        // (speech-worker-env.ts workerIdentityArgs); and once without one.
        const workers = []
        const open = (args) => {
          const worker = utilityProcess.fork(`${app.getAppPath()}\\out\\main\\engine-win.js`, args)
          workers.push(worker)
          let next = 1
          const pending = new Map()
          worker.on('message', (message) => {
            if (message.t !== 'helper' || message.op !== 'reg') return
            pending.get(message.id)?.(message)
            pending.delete(message.id)
          })
          return (body) =>
            new Promise((resolve, reject) => {
              const id = next++
              const timer = setTimeout(
                () => reject(new Error('registry request timed out')),
                60_000
              )
              pending.set(id, (reply) => {
                clearTimeout(timer)
                resolve(reply)
              })
              worker.postMessage({ t: 'reg', id, ...body })
            })
        }
        const ask = open(['--doodlenote-registry-identity=com.doodlenote.desktop'])
        const anonymous = open([])
        const status = `Software\\DoodleNote-InstallStatus\\${guid}`
        const run = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
        const approved = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
        try {
          return {
            record: await ask({ op: 'read', subKey: `Software\\${guid}`, name: 'MigrationRecord' }),
            status: await ask({ op: 'read', subKey: status, name: 'AppMigration' }),
            // Round 8: the login item's Run value (a dotted name, the appId) is readable.
            runValue: await ask({ op: 'read', subKey: run, name: 'com.doodlenote.desktop' }),
            // Round 10: its Task Manager state (REG_BINARY, as hex, or null).
            approved: await ask({
              op: 'readBinary',
              subKey: approved,
              name: 'com.doodlenote.desktop'
            }),
            refused: [
              await ask({ op: 'write', subKey: status, values: [['LastResult', 'x']] }),
              await ask({ op: 'read', subKey: `Software\\${other}`, name: 'MigrationRecord' }),
              await ask({
                op: 'write',
                subKey: `Software\\DoodleNote-InstallStatus\\${other}`,
                values: [['AppMigration', 'x']]
              }),
              await ask({ op: 'delete', subKey: `Software\\${other}`, name: 'MigrationRecord' }),
              await ask({ op: 'read', subKey: `Software\\${guid}`, name: 'InstallLocation' }),
              await ask({ op: 'read', subKey: run, name: 'com.doodlenote.desktop.qa' }),
              await ask({ op: 'readBinary', subKey: approved, name: 'com.doodlenote.desktop.qa' }),
              await ask({ op: 'read', subKey: approved, name: 'com.doodlenote.desktop' }),
              await ask({
                op: 'read',
                subKey: 'Software\\Microsoft\\Windows\\CurrentVersion',
                name: 'ProgramFilesDir'
              }),
              // Without an identity on its command line the worker may touch nothing.
              await anonymous({ op: 'read', subKey: `Software\\${guid}`, name: 'MigrationRecord' })
            ]
          }
        } finally {
          for (const worker of workers) worker.kill()
        }
      },
      [PRODUCTION_GUID, OTHER_GUID]
    )
    for (const read of [registry.record, registry.status, registry.runValue])
      assert.ok(
        read.ok && (read.value === null || typeof read.value === 'string'),
        JSON.stringify(registry)
      )
    assert.ok(
      registry.approved.ok &&
        (registry.approved.value === null || /^([0-9a-f]{2})+$/.test(registry.approved.value)),
      JSON.stringify(registry)
    )
    for (const refused of registry.refused)
      assert.deepEqual([refused.ok, refused.code], [false, 'SCOPE'], JSON.stringify(registry))
    console.log(JSON.stringify({ executablePath, profile, preflight: result, stream, registry }))
  } finally {
    await app?.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
