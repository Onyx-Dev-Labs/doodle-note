import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import type { EngineCaptureControl, EngineEvent } from '../shared/engine-events'

// Load WinEngineHost with a stand-in Electron (the same pattern as win-engine-finish.test.ts).
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
    this.emit('exit', 0)
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

function host(): {
  host: InstanceType<typeof WinEngineHost>
  worker: Worker
  broadcasts: Array<{ channel: string; payload: Record<string, unknown> }>
  dictation: EngineCaptureControl[]
  events: EngineEvent[]
} {
  const broadcasts: Array<{ channel: string; payload: Record<string, unknown> }> = []
  const dictation: EngineCaptureControl[] = []
  const events: EngineEvent[] = []
  const h = new WinEngineHost((channel, payload) =>
    broadcasts.push({ channel, payload: payload as Record<string, unknown> })
  )
  h.setDictationCaptureSink((control) => dictation.push(control))
  h.onEvent((event) => events.push(event))
  h.startServe()
  const worker = workers.at(-1)!
  worker.event({
    event: 'status',
    stage: 'serve_ready',
    calibrationRtf: 0.1,
    captionMode: 'interim'
  })
  return { host: h, worker, broadcasts, dictation, events }
}

test('a meeting still captures in every window with Chromium voice processing (unchanged payloads)', () => {
  const { host: h, broadcasts, dictation } = host()
  try {
    h.start('live', undefined, { source: 'both', inputDevice: 'mic-1' })
    assert.deepEqual(broadcasts, [
      {
        channel: 'engine:capture-control',
        payload: {
          action: 'start',
          sessionId: 1,
          channels: ['mic', 'system'],
          inputDevice: 'mic-1'
        }
      }
    ])
    h.setInputDevice('mic-2')
    assert.deepEqual(broadcasts.at(-1)?.payload, {
      action: 'switch-input',
      sessionId: 1,
      inputDevice: 'mic-2'
    })
    h.stop()
    assert.deepEqual(broadcasts.at(-1)?.payload, { action: 'stop', sessionId: 1 })
    assert.deepEqual(dictation, [], 'the dictation window never hears about a meeting')
  } finally {
    h.dispose()
  }
})

test('dictation goes to its own window, raw, with microphone levels', () => {
  const { host: h, worker, broadcasts, dictation, events } = host()
  try {
    assert.equal(h.warm, true)
    assert.deepEqual(h.tryStartLive({ source: 'mic', levels: true, captureProfile: 'dictation' }), {
      started: true
    })
    assert.deepEqual(broadcasts, [], 'no window but the dictation one is asked to capture')
    assert.deepEqual(dictation, [
      { action: 'start', sessionId: 1, channels: ['mic'], profile: 'dictation' }
    ])
    h.captureStatus({ type: 'ready', sessionId: 1 })
    assert.deepEqual(worker.messages.at(-1), { t: 'start', sessionId: 1, channels: ['mic'] })
    const frame = new Float32Array(1024)
    frame[10] = -0.5
    frame[20] = 0.25
    h.pushAudio(1, 'mic', frame)
    assert.deepEqual(
      events.filter((e) => e.event === 'level'),
      [{ event: 'level', channel: 'mic', peak: 0.5 }]
    )
    assert.equal(worker.messages.at(-1)?.t, 'audio')
    h.stop()
    assert.deepEqual(dictation.at(-1), { action: 'stop', sessionId: 1, profile: 'dictation' })
  } finally {
    h.dispose()
  }
})

test('tryStartLive refuses over a running session and never supersedes it', () => {
  const { host: h, dictation, broadcasts } = host()
  try {
    h.start('live', undefined, { source: 'both' })
    assert.deepEqual(h.tryStartLive({ source: 'mic', captureProfile: 'dictation' }), {
      started: false,
      reason: 'The speech engine is busy with another session.'
    })
    assert.equal(broadcasts.length, 1)
    assert.deepEqual(dictation, [])
  } finally {
    h.dispose()
  }
})

test('a meeting session emits no level events', () => {
  const { host: h, events } = host()
  try {
    h.start('live', undefined, { source: 'mic' })
    h.captureStatus({ type: 'ready', sessionId: 1 })
    h.pushAudio(1, 'mic', new Float32Array(4096).fill(0.3))
    assert.equal(events.filter((e) => e.event === 'level').length, 0)
  } finally {
    h.dispose()
  }
})

test('keep-warm reloads a worker closed while idle, and warm reflects it', () => {
  const { host: h } = host()
  const before = workers.length
  try {
    // Close the idle worker the way the idle timer does.
    ;(h as unknown as { unloading: boolean; ready: boolean }).unloading = true
    ;(h as unknown as { ready: boolean }).ready = false
    workers.at(-1)!.kill()
    assert.equal(h.warm, false)
    h.setKeepWarm(true)
    assert.equal(workers.length, before + 1, 'a new worker loads at once')
    workers
      .at(-1)!
      .event({ event: 'status', stage: 'serve_ready', calibrationRtf: 0.1, captionMode: 'interim' })
    assert.equal(h.warm, true)
  } finally {
    h.dispose()
  }
})
