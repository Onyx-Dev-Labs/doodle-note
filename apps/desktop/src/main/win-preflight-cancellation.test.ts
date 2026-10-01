import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { WizardPreflightEvent } from '../shared/wizard-api'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
let workersStarted = 0
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: {},
        utilityProcess: {
          fork: () => {
            workersStarted++
            throw new Error('Canceled preflight must not start an import worker')
          }
        }
      }
    : originalLoad(id, ...args)
const { WinEngineHost } = require('./engine-host-win') as typeof import('./engine-host-win')
const { WinBatchTranscriber } =
  require('./win-batch-transcriber') as typeof import('./win-batch-transcriber')
loader._load = originalLoad

function warmupEvent(
  host: InstanceType<typeof WinEngineHost>,
  event: Record<string, unknown>
): void {
  // Feed the same boundary used by utility-process model download messages.
  ;(
    host as unknown as { handleEngineEvent: (event: Record<string, unknown>) => void }
  ).handleEngineEvent(event)
}

test('canceling one Windows preflight detaches progress and preserves shared warmup', async () => {
  const host = new WinEngineHost(() => {})
  const controller = new AbortController()
  const canceledEvents: WizardPreflightEvent[] = []
  const otherEvents: WizardPreflightEvent[] = []
  const canceled = host.preflight((event) => canceledEvents.push(event), controller.signal)
  const rejected = assert.rejects(canceled, { name: 'AbortError' })
  const other = host.preflight((event) => otherEvents.push(event))
  warmupEvent(host, { event: 'download', progress: 0.25 })
  controller.abort()
  await rejected
  warmupEvent(host, { event: 'download', progress: 0.75 })
  warmupEvent(host, { event: 'status', stage: 'serve_ready' })
  assert.deepEqual(canceledEvents, [{ stage: 'models' }, { stage: 'download', progress: 0.25 }])
  assert.deepEqual(otherEvents.at(-1), { stage: 'ready' })
  assert.equal((await other).ok, true)
  assert.equal((await host.preflight()).ok, true)
})

test('already canceled preflight rejects without subscribing or emitting progress', async () => {
  const host = new WinEngineHost(() => {})
  const controller = new AbortController()
  controller.abort()
  let events = 0
  await assert.rejects(
    host.preflight(() => events++, controller.signal),
    { name: 'AbortError' }
  )
  warmupEvent(host, { event: 'status', stage: 'serve_ready' })
  await assert.rejects(
    host.preflight(() => events++, controller.signal),
    { name: 'AbortError' }
  )
  assert.equal(events, 0)
})

test('cancellation inside the initial preflight event does not leave a subscription', async () => {
  const host = new WinEngineHost(() => {})
  const controller = new AbortController()
  let events = 0
  await assert.rejects(
    host.preflight(() => {
      events++
      controller.abort()
    }, controller.signal),
    { name: 'AbortError' }
  )
  warmupEvent(host, { event: 'status', stage: 'serve_ready' })
  assert.equal(events, 1)
})

test('Windows import cancellation settles during warmup and allows retry without spawning', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-win-preflight-'))
  const file = join(dir, 'synthetic.wav')
  writeFileSync(file, 'synthetic audio')
  const host = new WinEngineHost(() => {})
  const transcriber = new WinBatchTranscriber((onEvent, signal) => host.preflight(onEvent, signal))
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      warmupEvent(host, { event: 'download', progress: 0.25 })
      const controller = new AbortController()
      const stages: string[] = []
      const result = transcriber.transcribe(
        file,
        (progress) => {
          stages.push(progress.stage)
          if (progress.stage === 'downloading_model') controller.abort()
        },
        { signal: controller.signal }
      )
      // A deadline makes the original uncancelable wait fail deterministically.
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await assert.rejects(
          Promise.race([
            result,
            new Promise((_, reject) => {
              deadline = setTimeout(() => reject(new Error('Cancellation did not settle')), 1000)
            })
          ]),
          { name: 'AbortError' }
        )
      } finally {
        clearTimeout(deadline)
      }
      assert.deepEqual(stages, ['starting', 'downloading_model'])
      warmupEvent(host, { event: 'download', progress: 0.5 })
      assert.deepEqual(stages, ['starting', 'downloading_model'])
    }
    warmupEvent(host, { event: 'status', stage: 'serve_ready' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(workersStarted, 0)
    assert.equal((await host.preflight()).ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
