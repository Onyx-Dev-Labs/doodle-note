import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { EngineChannel, EngineEvent } from '../shared/engine-events'
import type { BatchProgress, BatchTranscription } from './import-logic'

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
let worker: Worker
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
const { WinEngineHost } = require('./engine-host-win') as typeof import('./engine-host-win')
loader._load = originalLoad

async function batch(
  mode: 'mixed' | 'split',
  run: (worker: Worker) => void,
  channels: EngineChannel[] = ['mic']
): Promise<{ result: BatchTranscription; control: Record<string, unknown> }> {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-refinement-'))
  const file = join(dir, 'synthetic.wav')
  writeFileSync(file, 'synthetic fixture transport only')
  const transcriber = new WinBatchTranscriber(async () => ({
    ok: true,
    micGranted: true,
    screenGranted: true
  }))
  transcriber.registerIpc()
  try {
    const result = transcriber.transcribe(file, undefined, { channels: mode })
    // Attach a rejection handler before delivering worker messages.
    void result.catch(() => {})
    const deadline = Date.now() + 1000
    while (!worker?.messages.some((message) => message.t === 'init')) {
      assert.ok(Date.now() < deadline, 'Batch worker did not initialize')
      await new Promise((resolve) => setImmediate(resolve))
    }
    worker.event({ event: 'status', stage: 'serve_ready' })
    const control = [...controls].reverse().find((value) => value.action === 'decode')!
    await handlers.get('engine:batch-data')!(
      { sender: { id: 1 } },
      { type: 'begin', jobId: control.jobId, channels, audioSeconds: 2 }
    )
    run(worker)
    return { result: await result, control }
  } finally {
    transcriber.dispose()
    worker = undefined as unknown as Worker
    controls.length = 0
    rmSync(dir, { recursive: true, force: true })
  }
}

function live(worker: Worker): void {
  worker.event({
    event: 'timings',
    channel: 'mic',
    tokens: [{ token: ' ORIGINAL WORDS', startSec: 0, endSec: 1, confidence: 0.9 }]
  })
  worker.event({ event: 'final', quality: 'live', channel: 'mic', text: 'ORIGINAL WORDS' })
}

test('empty final-model output cannot be reported as successful uppercase streaming text', async () => {
  await assert.rejects(
    batch('split', (worker) => {
      live(worker)
      worker.event({ event: 'final', quality: 'final', channel: 'mic', text: '', audioSeconds: 2 })
      worker.event({ event: 'done' })
    }),
    /high-accuracy|refinement/i
  )
})

test('missing final-model completion rejects instead of recycling the streaming final', async () => {
  await assert.rejects(
    batch('split', (worker) => {
      live(worker)
      worker.event({ event: 'done' })
    }),
    /high-accuracy|refinement/i
  )
})

test('mixed imports carry a neutral identity and explicit decoder mode after refinement', async () => {
  const { result, control } = await batch('mixed', (worker) => {
    live(worker)
    worker.event({
      event: 'final',
      quality: 'final',
      channel: 'mic',
      text: 'Original words.',
      audioSeconds: 2
    })
    worker.event({ event: 'done' })
  })
  assert.equal(control.channels, 'mixed')
  assert.deepEqual(
    result.segments.map(({ text, speaker, speakerId }) => ({ text, speaker, speakerId })),
    [{ text: 'Original words.', speaker: 'Speaker', speakerId: 'imported-speaker' }]
  )
})

test('proven split recordings retain microphone attribution and corrected casing', async () => {
  const { result, control } = await batch('split', (worker) => {
    live(worker)
    worker.event({
      event: 'final',
      quality: 'final',
      channel: 'mic',
      text: 'Original words.',
      audioSeconds: 2
    })
    worker.event({ event: 'done' })
  })
  assert.equal(control.channels, 'split')
  assert.equal(result.segments[0]?.speakerId, 'self')
  assert.equal(result.segments[0]?.text, 'Original words.')
})

test('a silent channel with explicit empty high-accuracy completion produces no invented text', async () => {
  const { result } = await batch('split', (worker) => {
    worker.event({ event: 'final', quality: 'live', channel: 'mic', text: '' })
    worker.event({ event: 'final', quality: 'final', channel: 'mic', text: '', audioSeconds: 2 })
    worker.event({ event: 'done' })
  })
  assert.deepEqual(result.segments, [])
})

test('final-only mixed speech uses neutral identity even without provisional timing segments', async () => {
  const { result } = await batch('mixed', (worker) => {
    worker.event({
      event: 'final',
      quality: 'final',
      channel: 'mic',
      text: 'NASA review.',
      audioSeconds: 2
    })
    worker.event({ event: 'done' })
  })
  assert.equal(result.segments[0]?.speakerId, 'imported-speaker')
  assert.equal(result.segments[0]?.text, 'NASA review.')
})

type HostState = {
  sessionActive: boolean
  activeSessionId: number
  captureState: string
  recorder: unknown
  child: Worker
  ephemeralAudioDir: string | null
  completeSession: () => Promise<void>
}

function finishingHost(finish: () => Promise<unknown>): {
  host: InstanceType<typeof WinEngineHost>
  state: HostState
  events: EngineEvent[]
} {
  const events: EngineEvent[] = []
  const host = new WinEngineHost(() => {})
  host.onEvent((event) => events.push(event))
  const state = host as unknown as HostState
  Object.assign(state, {
    sessionActive: true,
    activeSessionId: 1,
    captureState: 'finishing',
    child: new Worker(),
    recorder: { dir: '/synthetic', finish, abort: () => {} }
  })
  return { host, state, events }
}

for (const stage of ['audio', 'refinement'] as const) {
  for (const outcome of ['resolve', 'reject'] as const) {
    test(`stale ${stage} ${outcome} after worker restart cannot affect the next capture`, async () => {
      const host = new WinEngineHost(() => {})
      const state = host as unknown as HostState
      const events: EngineEvent[] = []
      host.onEvent((event) => events.push(event))
      let settleAudio!: (value: { durationMs: number; startEpochMs: number }) => void
      let failAudio!: (error: Error) => void
      let settleRefinement!: (value: BatchTranscription) => void
      let failRefinement!: (error: Error) => void
      let progress: ((value: BatchProgress) => void) | undefined
      let refinementCalls = 0
      host.setFinalRefiner((_, onProgress) => {
        refinementCalls++
        progress = onProgress
        return new Promise((resolve, reject) => {
          settleRefinement = resolve
          failRefinement = reject
        })
      })
      try {
        host.startServe()
        worker.event({ event: 'status', stage: 'serve_ready' })
        host.start('live')
        const dir = state.ephemeralAudioDir!
        state.recorder = {
          dir,
          finish: () =>
            stage === 'audio'
              ? new Promise((resolve, reject) => {
                  settleAudio = resolve
                  failAudio = reject
                })
              : Promise.resolve({ durationMs: 1000, startEpochMs: 0 })
        }
        const finishing = state.completeSession()
        await new Promise((resolve) => setImmediate(resolve))
        worker.emit('exit')
        host.startServe()
        worker.event({ event: 'status', stage: 'serve_ready' })
        host.start('live')
        const nextId = state.activeSessionId
        const nextDir = state.ephemeralAudioDir!
        const checkpoint = join(nextDir, 'synthetic-current-capture.txt')
        writeFileSync(checkpoint, 'Synthetic current capture checkpoint')
        events.length = 0
        const callsBefore = refinementCalls
        if (stage === 'audio') {
          if (outcome === 'resolve') settleAudio({ durationMs: 1000, startEpochMs: 0 })
          else failAudio(new Error('Synthetic stale recorder failure'))
          await new Promise((resolve) => setImmediate(resolve))
          // Unblock a buggy late refiner so failure is an assertion, not a hung test.
          if (refinementCalls > callsBefore) failRefinement(new Error('Stale refiner started'))
        } else {
          progress?.({ stage: 'downloading_model', progress: 0.5 })
          progress?.({ stage: 'transcribing' })
          if (outcome === 'resolve')
            settleRefinement({
              segments: [
                {
                  id: 'retired-capture-text',
                  channel: 'mic',
                  speaker: 'You',
                  text: 'Synthetic retired capture text.',
                  startMs: 0,
                  endMs: 1000,
                  confidence: 1
                }
              ],
              audioSeconds: 1
            })
          else failRefinement(new Error('Synthetic stale refinement failure'))
        }
        await finishing
        assert.deepEqual([...events], [], 'A retired capture must not publish into the new capture')
        assert.equal(refinementCalls, callsBefore, 'Late audio must not start refinement')
        assert.equal(host.running, true)
        assert.equal(state.activeSessionId, nextId)
        assert.equal(state.captureState, 'starting')
        assert.equal(state.ephemeralAudioDir, nextDir)
        assert.equal(existsSync(checkpoint), true, 'The current capture owns its audio cleanup')
      } finally {
        host.dispose()
        worker = undefined as unknown as Worker
      }
    })
  }
}

test('audio finalization failure retains the transcript and emits an actionable fallback before done', async () => {
  const { host, state, events } = finishingHost(async () => {
    throw new Error('private path must not leak')
  })
  host.setFinalRefiner(async () => {
    throw new Error('must not refine absent audio')
  })
  await state.completeSession()
  assert.ok(
    events.some(
      (event) =>
        event.event === 'error' &&
        event.refinementFailed === true &&
        /live transcript was kept/i.test(event.message)
    )
  )
  assert.ok(!JSON.stringify(events).includes('private path'))
  assert.equal(events.filter((event) => event.event === 'done').length, 1)
  assert.equal(events.filter((event) => event.event === 'refined').length, 0)
})

test('repeated Stop during refinement cannot restart finalization or finish the session early', async () => {
  const { host, state, events } = finishingHost(async () => ({ durationMs: 1000, startEpochMs: 0 }))
  let complete!: (value: { segments: []; audioSeconds: number }) => void
  host.setFinalRefiner(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const finishing = state.completeSession()
  await new Promise((resolve) => setImmediate(resolve))
  host.stop()
  assert.equal(state.captureState, 'refining')
  complete({ segments: [], audioSeconds: 1 })
  await finishing
  assert.equal(events.filter((event) => event.event === 'done').length, 1)
  assert.ok(events.some((event) => event.event === 'error'))
})

test('Windows capture confirmation waits for the matching drain acknowledgement', () => {
  const { host, state, events } = finishingHost(async () => null)
  Object.assign(state, { captureState: 'draining', workerStarted: true })
  host.captureStatus({ type: 'drained', sessionId: 0 })
  assert.ok(!events.some((event) => event.event === 'status' && event.stage === 'capture_stopped'))
  host.captureStatus({ type: 'drained', sessionId: 1 })
  assert.equal(
    events.filter((event) => event.event === 'status' && event.stage === 'capture_stopped').length,
    1
  )
  host.captureStatus({ type: 'drained', sessionId: 1 })
  assert.equal(
    events.filter((event) => event.event === 'status' && event.stage === 'capture_stopped').length,
    1
  )
  host.dispose()
})

test('failure on one split channel rejects the entire replacement', async () => {
  await assert.rejects(
    batch(
      'split',
      (worker) => {
        live(worker)
        worker.event({ event: 'final', quality: 'final', channel: 'mic', text: 'Original words.' })
        // No completed final-model result for system audio.
        worker.event({ event: 'done' })
      },
      ['mic', 'system']
    ),
    /high-accuracy|refinement/i
  )
})

test('system-only split recordings retain far-side attribution with a silent microphone slot', async () => {
  const { result } = await batch(
    'split',
    (worker) => {
      worker.event({ event: 'final', quality: 'final', channel: 'mic', text: '' })
      worker.event({
        event: 'final',
        quality: 'final',
        channel: 'system',
        text: 'Remote words.',
        audioSeconds: 2
      })
      worker.event({ event: 'done' })
    },
    ['mic', 'system']
  )
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0]?.channel, 'system')
  assert.equal(result.segments[0]?.speakerId, 'far')
})
