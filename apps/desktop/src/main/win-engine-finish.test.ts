import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
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

test('an idle worker is closed to free its model and reloaded, losing no audio, at the next start', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controls: Array<Record<string, unknown>> = []
  const events: EngineEvent[] = []
  const host = new WinEngineHost((_channel, payload) => controls.push(payload as never), {
    idleUnloadMs: 60_000
  })
  host.onEvent((event) => events.push(event))
  try {
    host.startServe()
    const first = workers.at(-1)!
    first.event({ event: 'status', stage: 'serve_ready' })
    t.mock.timers.tick(60_001)
    assert.equal(first.kills, 1, 'idle worker closed')
    first.emit('exit', 0)
    t.mock.timers.tick(10_000)
    const count = workers.length
    assert.equal(workers.at(-1), first, 'an idle close does not restart the worker')
    // Setup stays complete while unloaded.
    assert.equal((await host.preflight()).ok, true)

    host.start('live', undefined, { source: 'mic' })
    assert.equal(workers.length, count + 1, 'the next recording reloads the worker')
    const second = workers.at(-1)!
    const sessionId = controls.at(-1)!.sessionId as number
    host.captureStatus({ type: 'ready', sessionId })
    // Capture runs while the model loads; frames wait in the host.
    host.pushAudio(sessionId, 'mic', new Float32Array([0.1]))
    host.pushAudio(sessionId, 'mic', new Float32Array([0.2]))
    assert.equal(second.messages.filter((message) => message.t === 'audio').length, 0)
    second.event({ event: 'status', stage: 'serve_ready' })
    assert.deepEqual(
      second.messages.map((message) => message.t),
      ['init', 'start', 'audio', 'audio']
    )
    host.pushAudio(sessionId, 'mic', new Float32Array([0.3]))
    assert.equal(second.messages.filter((message) => message.t === 'audio').length, 3)
  } finally {
    host.dispose()
  }
})

test('Stop during a reload still transcribes the buffered audio before finishing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controls: Array<Record<string, unknown>> = []
  const host = new WinEngineHost((_channel, payload) => controls.push(payload as never), {
    idleUnloadMs: 1_000
  })
  try {
    host.startServe()
    const first = workers.at(-1)!
    first.event({ event: 'status', stage: 'serve_ready' })
    t.mock.timers.tick(1_001)
    first.emit('exit', 0)
    host.start('live', undefined, { source: 'mic' })
    const second = workers.at(-1)!
    const sessionId = controls.at(-1)!.sessionId as number
    host.captureStatus({ type: 'ready', sessionId })
    host.pushAudio(sessionId, 'mic', new Float32Array([0.5]))
    host.stop()
    host.captureStatus({ type: 'drained', sessionId })
    second.event({ event: 'status', stage: 'serve_ready' })
    assert.deepEqual(
      second.messages.map((message) => message.t),
      ['init', 'start', 'audio', 'stop']
    )
  } finally {
    host.dispose()
  }
})

test('a worker downloading the new model in the background is never closed as idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = new WinEngineHost(() => {}, { idleUnloadMs: 60_000 })
  try {
    host.startServe()
    const worker = workers.at(-1)!
    // Upgrade fallback: ready at once on the cached model, then downloading.
    worker.event({ event: 'status', stage: 'serve_ready', captionMode: 'legacy' })
    worker.event({ event: 'status', stage: 'model_download', progress: 0 })
    t.mock.timers.tick(10 * 60_000)
    assert.equal(worker.kills, 0, 'the download keeps its worker')
    worker.event({ event: 'status', stage: 'model_download_failed' })
    t.mock.timers.tick(60_001)
    assert.equal(worker.kills, 1, 'idle close resumes once the download has ended')
  } finally {
    host.dispose()
  }
})

test('a reload that fails during a recording ends it cleanly and keeps its audio', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controls: Array<Record<string, unknown>> = []
  const events: EngineEvent[] = []
  const host = new WinEngineHost((_channel, payload) => controls.push(payload as never), {
    idleUnloadMs: 1_000
  })
  host.onEvent((event) => events.push(event))
  const audioDir = mkdtempSync(join(tmpdir(), 'doodlenote-reload-fail-'))
  try {
    host.startServe()
    const first = workers.at(-1)!
    first.event({
      event: 'status',
      stage: 'serve_ready',
      calibrationRtf: 0.11,
      captionMode: 'interim'
    })
    t.mock.timers.tick(1_001)
    first.emit('exit', 0)
    host.start('live', undefined, { source: 'mic', audioDir })
    const second = workers.at(-1)!
    // The reload reuses the first calibration instead of measuring a busy PC.
    assert.deepEqual(second.messages[0]!.calibration, {
      calibrationRtf: 0.11,
      captionMode: 'interim'
    })
    const sessionId = controls.at(-1)!.sessionId as number
    host.captureStatus({ type: 'ready', sessionId })
    for (let i = 0; i < 2_000; i++) host.pushAudio(sessionId, 'mic', new Float32Array(4096))
    second.event({ event: 'error', message: 'The speech model could not be downloaded.' })
    for (let i = 0; i < 200 && !events.some((event) => event.event === 'exit'); i++) {
      t.mock.timers.tick(50)
      await new Promise((resolve) => setImmediate(resolve))
    }
    const names = events.map((event) => event.event)
    assert.ok(names.includes('error'))
    assert.match(
      String(events.find((event) => event.event === 'error')!.message),
      /could not start.*audio of this recording is saved/
    )
    assert.ok(names.includes('audio'), 'the recording is merged now, not at next launch')
    assert.equal(names.at(-1), 'exit')
    assert.equal(second.kills, 1)
    assert.equal(second.messages.filter((message) => message.t === 'audio').length, 0)
  } finally {
    host.dispose()
    rmSync(audioDir, { recursive: true, force: true })
  }
})

test('audio buffered across a reload is not counted as lag', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const controls: Array<Record<string, unknown>> = []
  const host = new WinEngineHost((_channel, payload) => controls.push(payload as never), {
    idleUnloadMs: 1_000
  })
  try {
    host.startServe()
    const first = workers.at(-1)!
    first.event({ event: 'status', stage: 'serve_ready' })
    t.mock.timers.tick(1_001)
    first.emit('exit', 0)
    host.start('live', undefined, { source: 'mic' })
    const second = workers.at(-1)!
    const sessionId = controls.at(-1)!.sessionId as number
    host.captureStatus({ type: 'ready', sessionId })
    host.pushAudio(sessionId, 'mic', new Float32Array(4096))
    t.mock.timers.tick(5_000) // the model takes 5 s to load
    second.event({ event: 'status', stage: 'serve_ready' })
    const frame = second.messages.find((message) => message.t === 'audio')!
    assert.equal(frame.sentAt, Date.now())
  } finally {
    host.dispose()
  }
})
