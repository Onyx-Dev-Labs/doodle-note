import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import type { WizardPreflightEvent } from '../shared/wizard-api'

const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load
loader._load = (id, ...args) =>
  id === 'electron'
    ? {
        app: {},
        utilityProcess: {
          fork: () => {
            throw new Error('Preflight tests never start a worker')
          }
        }
      }
    : originalLoad(id, ...args)
const { WinEngineHost } = require('./engine-host-win') as typeof import('./engine-host-win')
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
