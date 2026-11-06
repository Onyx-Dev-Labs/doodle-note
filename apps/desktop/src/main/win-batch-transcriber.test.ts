import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineChannel, EngineTokenTiming } from '../shared/engine-events'
import type { BatchOptions, BatchTranscription } from './import-logic'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
const controls: Record<string, unknown>[] = []
class Worker extends EventEmitter {
  messages: Record<string, unknown>[] = []
  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message)
  }
  kill(): void {
    this.emit('exit', 0)
  }
  event(event: Record<string, unknown>): void {
    this.emit('message', { t: 'event', event })
  }
}
let worker: Worker | undefined
type IpcHandler = (event: unknown, message: unknown) => Promise<void>
const handlers = new Map<string, IpcHandler>()
const window = {
  isDestroyed: () => false,
  webContents: {
    id: 1,
    send: (_: string, control: Record<string, unknown>) => controls.push(control)
  }
}
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: { getPath: () => tmpdir() },
        utilityProcess: { fork: () => (worker = new Worker()) },
        BrowserWindow: { getFocusedWindow: () => window, getAllWindows: () => [window] },
        ipcMain: { handle: (name: string, handler: IpcHandler) => handlers.set(name, handler) }
      }
    : originalLoad(id, ...args)
const { WinBatchTranscriber } =
  require('./win-batch-transcriber') as typeof import('./win-batch-transcriber')
loader._load = originalLoad

const tokens = (words: string[], start: number): EngineTokenTiming[] =>
  words.map((word, index) => ({
    token: ` ${word}`,
    startSec: start + index * 0.3,
    endSec: start + index * 0.3 + 0.2,
    confidence: 0.95
  }))

async function batch(
  options: BatchOptions,
  channels: EngineChannel[],
  run: (worker: Worker) => void
): Promise<{
  result: BatchTranscription
  init: Record<string, unknown>
  control: Record<string, unknown>
}> {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-win-batch-'))
  const file = join(dir, 'synthetic.wav')
  writeFileSync(file, 'synthetic fixture transport only')
  const transcriber = new WinBatchTranscriber(async () => ({
    ok: true,
    micGranted: true,
    screenGranted: true
  }))
  transcriber.registerIpc()
  try {
    const pending = transcriber.transcribe(file, undefined, options)
    void pending.catch(() => {})
    const deadline = Date.now() + 2000
    while (!worker?.messages.some((message) => message.t === 'init')) {
      assert.ok(Date.now() < deadline, 'Batch worker did not initialize')
      await new Promise((resolve) => setImmediate(resolve))
    }
    const init = worker.messages.find((message) => message.t === 'init')!
    worker.event({ event: 'status', stage: 'serve_ready' })
    const control = [...controls].reverse().find((value) => value.action === 'decode')!
    await handlers.get('engine:batch-data')!(
      { sender: { id: 1 } },
      { type: 'begin', jobId: control.jobId, channels, audioSeconds: 4 }
    )
    run(worker)
    return { result: await pending, init, control }
  } finally {
    transcriber.dispose()
    worker = undefined
    controls.length = 0
    rmSync(dir, { recursive: true, force: true })
  }
}

test('imports use the batch Parakeet setting and mix external files to one neutral speaker', async () => {
  const { result, init, control } = await batch(
    { channels: 'mixed', settings: { backend: 'parakeet', parakeetModel: 'v3', language: 'auto' } },
    ['mic'],
    (w) => {
      w.event({ event: 'timings', channel: 'mic', tokens: tokens(['Hola', 'a', 'todos.'], 0.5) })
      w.event({ event: 'final', channel: 'mic', text: 'Hola a todos.' })
      w.event({ event: 'done' })
    }
  )
  assert.equal(init.quality, 'final')
  assert.equal(init.parakeetModel, 'v3')
  assert.equal(control.channels, 'mixed')
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0]!.text, 'Hola a todos.')
  assert.equal(result.segments[0]!.speaker, 'Speaker')
  assert.equal(result.segments[0]!.speakerId, 'imported-speaker')
  assert.equal(result.segments[0]!.startMs, 500)
  assert.equal(result.audioSeconds, 4)
})

test('saved DoodleNote parts keep microphone and system speakers with real token times', async () => {
  const { result, init, control } = await batch({ channels: 'split' }, ['mic', 'system'], (w) => {
    w.event({
      event: 'timings',
      channel: 'system',
      tokens: tokens(['Can', 'you', 'hear', 'me?'], 2)
    })
    w.event({ event: 'timings', channel: 'mic', tokens: tokens(['Yes,', 'clearly.'], 0.2) })
    w.event({ event: 'final', channel: 'mic', text: 'Yes, clearly.' })
    w.event({ event: 'final', channel: 'system', text: 'Can you hear me?' })
    w.event({ event: 'done' })
  })
  assert.equal(init.parakeetModel, 'v2')
  assert.equal(control.channels, 'split')
  assert.deepEqual(
    result.segments.map((segment) => [segment.channel, segment.text, segment.startMs]),
    [
      ['mic', 'Yes, clearly.', 200],
      ['system', 'Can you hear me?', 2000]
    ]
  )
  assert.notEqual(result.segments[0]!.speaker, 'Speaker')
})

test('a worker error rejects the import instead of returning partial text', async () => {
  await assert.rejects(
    batch({}, ['mic'], (w) => {
      w.event({ event: 'timings', channel: 'mic', tokens: tokens(['partial'], 0) })
      w.event({ event: 'error', message: 'The speech model could not be prepared.' })
    }),
    /could not be prepared/
  )
})
