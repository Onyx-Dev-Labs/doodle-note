import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { test, type TestContext } from 'node:test'
import type { EngineEvent } from '../shared/engine-events'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
class Worker extends EventEmitter {
  messages: Array<Record<string, unknown>> = []
  kills = 0
  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message)
  }
  kill(): void {
    this.kills++
  }
  event(event: Record<string, unknown>): void {
    this.emit('message', { t: 'event', event })
  }
}
const workers: Worker[] = []
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: { getPath: () => tmpdir() },
        utilityProcess: {
          fork: () => {
            const worker = new Worker()
            workers.push(worker)
            return worker
          }
        }
      }
    : originalLoad(id, ...args)
const { WinEngineHost } = require('./engine-host-win') as typeof import('./engine-host-win')
loader._load = originalLoad

async function recording(t: TestContext): Promise<{
  host: InstanceType<typeof WinEngineHost>
  worker: Worker
  controls: Array<Record<string, unknown>>
  events: EngineEvent[]
  sessionId: number
}> {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controls: Array<Record<string, unknown>> = []
  const events: EngineEvent[] = []
  const host = new WinEngineHost((_channel, payload) => controls.push(payload as never))
  host.onEvent((event) => events.push(event))
  host.startServe()
  const worker = workers.at(-1)!
  worker.event({
    event: 'status',
    stage: 'serve_ready',
    calibrationRtf: 0.1,
    captionMode: 'interim'
  })
  host.start('live', undefined, { source: 'mic' })
  const sessionId = controls.at(-1)!.sessionId as number
  host.captureStatus({ type: 'ready', sessionId })
  assert.equal(worker.messages.at(-1)?.t, 'start')
  return { host, worker, controls, events, sessionId }
}

test('Stop waits for a slow worker while it keeps decoding, and kills only a silent one', async (t) => {
  const { host, worker, sessionId } = await recording(t)
  try {
    host.stop()
    host.captureStatus({ type: 'drained', sessionId })
    assert.equal(worker.messages.at(-1)?.t, 'stop')
    const tick = (ms: number): void => t.mock.timers.tick(ms)
    // Queued speech still decoding: every utterance is progress.
    for (let i = 0; i < 4; i++) {
      tick(10_000)
      worker.event({ event: 'timings', channel: 'mic', tokens: [] })
    }
    assert.equal(worker.kills, 0, 'a worker that is still producing text must not be killed')
    tick(15_001)
    assert.equal(worker.kills, 1, 'a worker silent for 15 s after Stop is ended')
  } finally {
    host.dispose()
  }
})

test('finishing saves audio and ends the session without a post-stop refinement pass', async (t) => {
  const { host, worker, controls, events, sessionId } = await recording(t)
  try {
    host.stop()
    host.captureStatus({ type: 'drained', sessionId })
    worker.event({ event: 'final', channel: 'mic', text: 'Hello there.' })
    worker.event({ event: 'done' })
    // Repeated Stop while the recording is being saved must not restart finalization.
    const stops = controls.filter((control) => control.action === 'stop').length
    host.stop()
    assert.equal(controls.filter((control) => control.action === 'stop').length, stops)
    for (let i = 0; i < 20 && !events.some((event) => event.event === 'exit'); i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    const names = events.map((event) => event.event)
    assert.ok(names.includes('final'))
    assert.ok(names.includes('done'))
    assert.equal(names.at(-1), 'exit')
    assert.ok(
      !events.some((event) => event.event === 'status' && event.stage === 'refining_transcript')
    )
    assert.equal(worker.messages.filter((message) => message.t === 'stop').length, 1)
  } finally {
    host.dispose()
  }
})

test('a failed speech-model download is retried by the next setup request', async () => {
  const host = new WinEngineHost(() => {})
  try {
    host.startServe()
    const worker = workers.at(-1)!
    const first = host.preflight()
    worker.event({ event: 'download', progress: 0.4 })
    worker.event({ event: 'error', message: 'The speech model download stalled.' })
    const failed = await first
    assert.equal(failed.ok, false)
    assert.equal(worker.messages.filter((message) => message.t === 'init').length, 1)
    const retry = host.preflight()
    assert.equal(worker.messages.filter((message) => message.t === 'init').length, 2)
    worker.event({ event: 'status', stage: 'serve_ready' })
    assert.equal((await retry).ok, true)
  } finally {
    host.dispose()
  }
})
