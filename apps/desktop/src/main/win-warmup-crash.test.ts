import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
const workers: EventEmitter[] = []
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: { getPath: () => tmpdir() },
        utilityProcess: {
          fork: () => {
            const child = Object.assign(new EventEmitter(), {
              postMessage() {
                /* No model process is started by this lifecycle test. */
              },
              kill() {
                /* Dispose only releases the fake worker. */
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

test('a native startup crash settles setup and does not enter a restart loop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const host = new WinEngineHost(() => {})
  try {
    host.startServe()
    let result: { ok: boolean; error?: string } | undefined
    const preflight = host.preflight().then((value) => {
      result = value
    })
    workers.at(-1)!.emit('exit', -36861)
    await Promise.resolve()
    assert.equal(result?.ok, false, 'setup must report a failed native engine instead of hanging')
    assert.match(result?.error ?? '', /exited.*-36861/)
    await preflight
    const count = workers.length
    t.mock.timers.tick(10_000)
    assert.equal(workers.length, count, 'a broken native startup must not repeatedly crash')
    assert.equal((await host.preflight()).ok, false, 'late setup subscribers see the failure')
  } finally {
    host.dispose()
  }
})
