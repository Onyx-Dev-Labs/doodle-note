import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
type FakeWorker = EventEmitter & { killed: number }
const workers: FakeWorker[] = []
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: { getPath: () => tmpdir() },
        utilityProcess: {
          fork: () => {
            const child = Object.assign(new EventEmitter(), {
              killed: 0,
              postMessage() {
                /* The fake worker loads no model. */
              },
              kill() {
                child.killed += 1
              }
            })
            workers.push(child)
            return child
          }
        }
      }
    : originalLoad(id, ...args)
const { WinEngineHost } = require('./engine-host-win') as typeof import('./engine-host-win')
loader._load = originalLoad

function event(worker: EventEmitter, payload: Record<string, unknown>): void {
  worker.emit('message', { t: 'event', event: payload })
}

test('a model download retry restarts the worker, and the failure clears only on new progress', () => {
  const host = new WinEngineHost(() => {}, { idleUnloadMs: 0 })
  try {
    host.startServe()
    const first = workers.at(-1)!
    event(first, { event: 'status', stage: 'serve_ready', model: 'zipformer-fallback' })
    event(first, { event: 'status', stage: 'model_download_failed' })
    assert.equal(host.dictationModelState().downloadFailed, true)

    assert.equal(host.retryDictationModel(), 'started')
    assert.equal(first.killed, 1, 'the running worker is closed')
    assert.equal(
      host.dictationModelState().downloadFailed,
      true,
      'not cleared before the retry runs'
    )
    assert.equal(host.retryDictationModel(), 'in-progress', 'a second attempt does not kill again')
    assert.equal(first.killed, 1)

    const count = workers.length
    first.emit('exit', 0)
    assert.equal(workers.length, count + 1, 'the exit of the closed worker starts a fresh one')
    const second = workers.at(-1)!
    assert.equal(host.dictationModelState().downloadFailed, true)
    assert.equal(host.retryDictationModel(), 'in-progress')

    event(second, { event: 'status', stage: 'model_download', progress: 0.1 })
    assert.equal(
      host.dictationModelState().downloadFailed,
      false,
      'progress from the new worker clears it'
    )
    assert.equal(host.dictationModelState().downloadProgress, 0.1)

    // A second failure can be retried again.
    event(second, { event: 'status', stage: 'model_download_failed' })
    assert.equal(host.retryDictationModel(), 'started')
  } finally {
    host.dispose()
  }
})

test('with nothing failed there is nothing to retry, and a worker exit starts no retry worker', () => {
  const host = new WinEngineHost(() => {}, { idleUnloadMs: 0 })
  try {
    host.startServe()
    const worker = workers.at(-1)!
    assert.equal(host.retryDictationModel(), 'unavailable', 'nothing failed, nothing to retry')
    const count = workers.length
    worker.emit('exit', 0)
    // The worker died on its own (no deliberate close) and no retry was pending: no fresh worker now.
    assert.equal(workers.length, count)
  } finally {
    host.dispose()
  }
})
