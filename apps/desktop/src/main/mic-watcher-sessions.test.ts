import assert from 'node:assert/strict'
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { MicWatcher } from './mic-watcher'

// Exercise the real native-event parser, timers and callback without opening audio.
function harness(t: TestContext): {
  watcher: MicWatcher
  prompts: Array<{ label: string | null; id?: string }>
  disconnect: () => boolean
  tick: (ms: number) => void
  emit: (bundles: string[], outputBundles?: string[]) => boolean
} {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-session-test-'))
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: () => true
  })
  t.mock.method(childProcess, 'spawn', () => child as unknown as ChildProcessWithoutNullStreams)
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const prompts: Array<{ label: string | null; id?: string }> = []
  const watcher = new MicWatcher(
    'synthetic-engine',
    dir,
    (label, id) => prompts.push({ label, id }),
    () => {}
  )
  watcher.start()
  t.after(() => {
    watcher.stop()
    t.mock.timers.reset()
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    watcher,
    prompts,
    disconnect: () => child.emit('exit'),
    tick: (ms: number) => t.mock.timers.tick(ms),
    emit: (bundles: string[], outputBundles: string[] = []) =>
      child.stdout.emit(
        'data',
        JSON.stringify({ event: 'micmon', running: bundles.length > 0, bundles, outputBundles }) +
          '\n'
      )
  }
}
const macOnly = { skip: process.platform !== 'darwin' }
for (const [bundle, label] of [
  ['com.microsoft.teams2', 'Teams'],
  ['us.zoom.xos', 'Zoom'],
  ['com.google.Chrome.helper', 'browser']
]) {
  test(`${label}: delivers separate call IDs promptly despite output churn`, macOnly, (t) => {
    const h = harness(t)
    h.emit([bundle])
    h.tick(2000)
    h.emit([bundle], ['com.apple.systemsoundserverd'])
    h.tick(1999)
    assert.equal(h.prompts.length, 0)
    h.tick(1)
    assert.equal(h.prompts.length, 1)
    assert.equal(h.prompts[0].label, label)
    h.emit([], [bundle])
    h.tick(3000) // muted, with call output still active
    h.emit([bundle], [bundle])
    h.tick(4000)
    assert.equal(h.prompts.length, 1)
    h.emit([])
    h.tick(2500) // call ended, then another join
    h.emit([bundle])
    h.tick(4000)
    assert.equal(h.prompts.length, 2)
    assert.ok(h.prompts[0].id && h.prompts[1].id)
    assert.notEqual(h.prompts[0].id, h.prompts[1].id)
  })
}
test(
  'disabled detection, recording, mute and short reconnect cannot duplicate a prompt',
  macOnly,
  (t) => {
    const h = harness(t)
    const bundle = ['us.zoom.xos']
    h.watcher.setEnabled(false)
    h.emit(bundle)
    h.tick(5000)
    assert.equal(h.prompts.length, 0)
    h.watcher.setEnabled(true)
    h.emit(bundle)
    h.tick(2000)
    h.watcher.setSuppressed(true)
    h.tick(5000)
    h.watcher.setSuppressed(false)
    h.emit(bundle)
    h.tick(5000)
    assert.equal(h.prompts.length, 0, 'Stop while still on the call does not prompt')
    h.emit([])
    h.tick(1000)
    h.emit(bundle)
    h.tick(5000)
    assert.equal(h.prompts.length, 0, 'route jitter remains consumed')
    h.emit([])
    h.tick(2500)
    h.emit(bundle)
    h.tick(4000)
    assert.equal(h.prompts.length, 1)
    h.watcher.setEnabled(false)
    h.emit([])
    h.tick(2500)
    h.emit(bundle)
    h.tick(4000)
    assert.equal(h.prompts.length, 1)
  }
)
test('output-only meeting app activity never prompts', macOnly, (t) => {
  const h = harness(t)
  h.emit([], ['us.zoom.xos', 'com.microsoft.teams2', 'com.google.Chrome.helper'])
  h.tick(600000)
  assert.deepEqual(h.prompts, [])
})

test('monitor restart re-debounces input without duplicating a consumed call', macOnly, (t) => {
  const h = harness(t)
  const bundle = ['com.microsoft.teams2']
  h.emit(bundle)
  h.tick(1000)
  h.disconnect()
  h.tick(5000)
  h.emit(bundle)
  h.tick(3999)
  assert.equal(h.prompts.length, 0)
  h.tick(1)
  assert.equal(h.prompts.length, 1)
  h.disconnect()
  h.tick(5000)
  h.emit(bundle)
  h.tick(4000)
  assert.equal(h.prompts.length, 1)
})
