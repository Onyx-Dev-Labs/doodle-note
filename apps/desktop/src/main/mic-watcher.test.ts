import assert from 'node:assert/strict'
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test, type Mock, type TestContext } from 'node:test'
import { MicWatcher } from './mic-watcher'
import { MEETING_END_DEBOUNCE_MS, MIC_COOLDOWN_MS, MIC_DEBOUNCE_MS } from './mic-watcher-logic'

// Keep the real NDJSON parsing, state transitions, timers, and callbacks.
// Only the native process and clock are replaced; no microphone is opened.
function harness(t: TestContext): {
  watcher: MicWatcher
  prompts: Array<string | null>
  ended: Mock<() => void>
  emit: (bundles: string[], running?: boolean, outputBundles?: string[]) => void
  tick: (ms: number) => void
} {
  const dir = mkdtempSync(join(tmpdir(), 'doodlenote-micwatch-'))
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: () => true
  })
  t.mock.method(childProcess, 'spawn', () => child as unknown as ChildProcessWithoutNullStreams)
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const prompts: Array<string | null> = []
  const ended = t.mock.fn()
  const watcher = new MicWatcher('unused-engine', dir, (label) => prompts.push(label), ended)
  t.after(() => {
    watcher.stop()
    t.mock.timers.reset()
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    rmSync(dir, { recursive: true, force: true })
  })
  watcher.start()
  return {
    watcher,
    prompts,
    ended,
    emit(bundles: string[], running = false, outputBundles: string[] = []) {
      child.stdout.emit(
        'data',
        JSON.stringify({ event: 'micmon', running, bundles, outputBundles }) + '\n'
      )
    },
    tick: (ms: number) => t.mock.timers.tick(ms)
  }
}

for (const [bundle, label] of [
  ['com.tinyspeck.slackmacgap.helper', 'Slack'],
  ['us.zoom.xos', 'Zoom'],
  ['com.microsoft.teams2', 'Teams']
]) {
  test(`${label} on a non-default input delivers one debounced prompt`, (t) => {
    const h = harness(t)
    h.emit([bundle])
    h.tick(MIC_DEBOUNCE_MS - 1)
    assert.deepEqual(h.prompts, [])
    h.tick(1)
    assert.deepEqual(h.prompts, [label])
    h.tick(MIC_COOLDOWN_MS)
    h.emit([bundle], true) // Default-device activity changes, same meeting input.
    h.tick(MIC_DEBOUNCE_MS)
    assert.deepEqual(h.prompts, [label])
    h.emit([])
    h.tick(1_000)
    h.emit([bundle]) // A brief reconnect still belongs to the same meeting.
    h.tick(MIC_DEBOUNCE_MS)
    assert.deepEqual(h.prompts, [label])
  })
}

test('non-default input obeys disabled detection, recording suppression, and cooldown', (t) => {
  const h = harness(t)
  const bundles = ['us.zoom.xos']
  h.watcher.setEnabled(false)
  h.emit(bundles)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, [])
  h.emit([])
  h.watcher.setEnabled(true)
  h.watcher.setSuppressed(true)
  h.emit(bundles)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, [])
  h.emit([])
  h.watcher.setSuppressed(false)
  h.emit(bundles)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, ['Zoom'])
  h.emit([])
  h.tick(121_000) // A separate meeting, but still within the five-minute cooldown.
  h.emit(bundles)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, ['Zoom'])
})

test('active non-default input keeps recording alive and releasing it auto-stops once', (t) => {
  const h = harness(t)
  const bundles = ['us.zoom.xos']
  h.emit(bundles, true)
  h.watcher.setSuppressed(true)
  h.emit(bundles, false) // Default input becomes idle, meeting input stays active.
  h.tick(MEETING_END_DEBOUNCE_MS)
  assert.equal(h.ended.mock.callCount(), 0)
  h.emit([], false, bundles) // Meeting output can linger after input is released.
  h.tick(MEETING_END_DEBOUNCE_MS - 1)
  assert.equal(h.ended.mock.callCount(), 0)
  h.tick(1)
  assert.equal(h.ended.mock.callCount(), 1)
  h.emit([])
  h.tick(MEETING_END_DEBOUNCE_MS)
  assert.equal(h.ended.mock.callCount(), 1)
  assert.deepEqual(h.prompts, [])
})

test('non-default input seeds auto-stop when capture starts after the meeting', (t) => {
  const h = harness(t)
  const bundles = ['com.tinyspeck.slackmacgap.helper']
  h.emit(bundles)
  h.watcher.setSuppressed(true)
  h.emit([])
  h.tick(MEETING_END_DEBOUNCE_MS)
  assert.equal(h.ended.mock.callCount(), 1)
})

test('output-only and dictation activity never reach the prompt callback', (t) => {
  const h = harness(t)
  const output = [
    'us.zoom.ZoomPhone',
    'com.tinyspeck.slackmacgap.helper',
    'com.google.Chrome.helper'
  ]
  h.emit([], false, output)
  h.tick(MIC_DEBOUNCE_MS)
  h.emit(['com.electron.wispr-flow.helper'], true, output)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, [])
})

test('Windows-style active ConsentStore input still prompts and idle input does not', (t) => {
  const h = harness(t)
  h.emit([], false)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, [])
  h.emit(['msteams_8wekyb3d8bbwe'], true)
  h.tick(MIC_DEBOUNCE_MS)
  assert.deepEqual(h.prompts, ['Teams'])
})
