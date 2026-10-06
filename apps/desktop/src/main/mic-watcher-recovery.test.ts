import assert from 'node:assert/strict'
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { MicWatcher } from './mic-watcher'

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed: boolean
  kill: () => boolean
}

function harness(t: TestContext): {
  watcher: MicWatcher
  ended: number[]
  emit: (present: boolean, child?: FakeChild, valid?: boolean) => boolean
  children: FakeChild[]
  tick: (ms: number) => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'doodle-autostop-'))
  const children: Array<ReturnType<typeof makeChild>> = []
  function makeChild(): FakeChild {
    return Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: () => true
    })
  }
  t.mock.method(childProcess, 'spawn', () => {
    const child = makeChild()
    children.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const ended: number[] = []
  const watcher = new MicWatcher(
    'synthetic',
    dir,
    () => {},
    () => ended.push(Date.now())
  )
  watcher.start()
  t.after(() => {
    watcher.stop()
    t.mock.timers.reset()
    for (const c of children) {
      c.stdin.destroy()
      c.stdout.destroy()
      c.stderr.destroy()
    }
    rmSync(dir, { recursive: true, force: true })
  })
  const emit = (present: boolean, child = children.at(-1)!, valid = true): boolean =>
    child.stdout.emit(
      'data',
      JSON.stringify({
        event: 'micmon',
        running: present,
        bundles: present ? ['msteams_8wekyb3d8bbwe'] : [],
        outputBundles: [],
        valid
      }) + '\n'
    )
  return { watcher, ended, emit, children, tick: (ms: number) => t.mock.timers.tick(ms) }
}

test('repeated absent events stop at first absence plus twelve seconds', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.tick(1000)
  h.emit(false)
  for (let i = 0; i < 11; i++) {
    h.tick(1000)
    h.emit(false)
  }
  assert.deepEqual(h.ended, [])
  h.tick(1000)
  assert.deepEqual(h.ended, [1_013_000])
})

test('returning input cancels the deadline and later absence gets a fresh deadline', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.emit(false)
  h.tick(11000)
  h.emit(true)
  h.tick(10000)
  assert.deepEqual(h.ended, [])
  h.emit(false)
  h.tick(11999)
  assert.deepEqual(h.ended, [])
  h.tick(1)
  assert.equal(h.ended.length, 1)
})

test('re-enabling during a known meeting seeds auto-stop without a new input edge', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.watcher.setAutoStop(false)
  h.watcher.setAutoStop(true)
  h.emit(false)
  h.tick(12000)
  assert.equal(h.ended.length, 1)
})

test('monitor exit cancels pending stop and stale child events cannot rearm it', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.emit(false)
  h.tick(1000)
  const old = h.children[0]
  old.emit('exit')
  h.tick(5000)
  h.emit(true, old)
  h.emit(false, old)
  h.tick(20000)
  assert.deepEqual(h.ended, [])
  h.emit(false)
  h.tick(20000)
  assert.deepEqual(h.ended, [])
  h.emit(true)
  h.emit(false)
  h.tick(12000)
  assert.equal(h.ended.length, 1)
})

test('invalid monitor samples are unknown rather than evidence that input ended', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.emit(false)
  h.tick(1000)
  h.emit(false, undefined, false)
  h.tick(30000)
  assert.deepEqual(h.ended, [])
  h.emit(false)
  h.tick(30000)
  assert.deepEqual(h.ended, [])
})

test('disable, capture replacement and watcher shutdown cancel old deadlines', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.emit(false)
  h.tick(1000)
  h.watcher.setAutoStop(false)
  h.tick(20000)
  assert.deepEqual(h.ended, [])
  h.watcher.setAutoStop(true)
  h.emit(true)
  h.emit(false)
  h.watcher.setSuppressed(false)
  h.watcher.setSuppressed(true)
  h.tick(20000)
  assert.deepEqual(h.ended, [])
  h.emit(true)
  h.emit(false)
  h.watcher.stop()
  h.tick(20000)
  assert.deepEqual(h.ended, [])
})

test('sleep and wake require fresh recognized input and publish honest detector state', (t) => {
  const h = harness(t)
  assert.equal(h.watcher.autoStopStatus, 'unavailable')
  h.emit(false)
  h.watcher.setSuppressed(true, 'capture-one')
  assert.equal(h.watcher.autoStopStatus, 'waiting')
  h.emit(true)
  assert.equal(h.watcher.autoStopStatus, 'armed')
  h.emit(false)
  h.tick(1000)
  h.watcher.suspend()
  assert.equal(h.watcher.autoStopStatus, 'unavailable')
  h.tick(120000)
  h.watcher.resume()
  h.emit(false)
  h.tick(20000)
  assert.deepEqual(h.ended, [])
  assert.equal(h.watcher.autoStopStatus, 'waiting')
  h.emit(true)
  h.emit(false)
  h.tick(12000)
  assert.equal(h.ended.length, 1)
  assert.equal(h.watcher.autoStopStatus, 'stopping')
  h.watcher.setAutoStop(false)
  assert.equal(h.watcher.autoStopStatus, 'disabled')
})

test('quiet change-only input remains healthy throughout a long meeting', (t) => {
  const h = harness(t)
  h.emit(true)
  h.watcher.setSuppressed(true)
  h.tick(4 * 60 * 60 * 1000)
  assert.deepEqual(h.ended, [])
  assert.equal(h.watcher.autoStopStatus, 'armed')
  h.emit(false)
  h.tick(12000)
  assert.equal(h.ended.length, 1)
})
