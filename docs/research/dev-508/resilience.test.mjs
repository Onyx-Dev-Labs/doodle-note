import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import { atomicJSON, CaptureModel, LIMITS, readJournal, SOURCES } from './capture-model.mjs'

const fixture = fileURLToPath(new URL('./process-fixture.mjs', import.meta.url))
const measurements = []
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'dev508-synthetic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const model = new CaptureModel(root)
  assert.equal(model.reserve('attempt-A', 'meeting-A'), true)
  assert.equal(model.start('attempt-A', 'capture-A'), true)
  return { root, model }
}
function record(name, model, extra = {}) {
  const result = { name, sources: Object.fromEntries(SOURCES.map(source => [source, model.coverage(source)])),
    peakPendingBytes: model.peakPendingBytes, rejectedEvents: model.rejected, ...extra }
  measurements.push(result)
  console.log(JSON.stringify(result))
}
async function until(predicate, limit = 3000) {
  const deadline = Date.now() + limit
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('fixture deadline exceeded')
    await delay(5)
  }
}
function child(t, args) {
  const proc = fork(fixture, args, { stdio: ['pipe', 'ignore', 'inherit', 'ipc'] })
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const closed = once(proc, 'close')
      proc.kill('SIGKILL')
      await closed
    }
  })
  return proc
}
async function worker(t) {
  const proc = child(t, ['asr'])
  const [ready] = await once(proc, 'message')
  assert.equal(ready.ready, true)
  return proc
}
async function decode(proc, token, record, hang = false) {
  return new Promise((resolve, reject) => {
    const listener = message => { cleanup(); resolve(message) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('ASR deadline')) }, LIMITS.deadlineMs)
    function cleanup() { clearTimeout(timer); proc.off('message', listener) }
    proc.on('message', listener)
    proc.send({ token, record, hang })
  })
}
function transcribe(model, record, text = 'synthetic') {
  assert.equal(model.accept(model.token(record.source), record, text), true)
}

test('ASR hang, real child kill/restart and bounded replay keep both source IDs', { timeout: 10000 }, async t => {
  const { model } = setup(t)
  const first = await worker(t)
  const emitted = SOURCES.flatMap(source => Array.from({ length: 3 }, () => model.capture(source)))
  const oldToken = model.token('mic')
  assert.equal(model.attempt(emitted[0]), true)
  await assert.rejects(decode(first, oldToken, emitted[0], true), /ASR deadline/)
  const exited = once(first, 'close')
  first.kill('SIGKILL')
  await exited
  assert.equal(model.restartWorker(), true)
  const second = await worker(t)
  for (const source of SOURCES) {
    for (const item of model.replay(source)) {
      assert.equal(model.attempt(item), true)
      const result = await decode(second, model.token(source), item)
      assert.equal(model.accept(result.token, item, result.text), true)
    }
    model.commit(source)
  }
  assert.equal(model.accept(oldToken, emitted[0], 'late prior worker'), false)
  assert.equal(model.restartWorker(), false)
  for (const source of SOURCES) {
    assert.equal(model.coverage(source).missingTranscriptFrames, 0)
    assert.equal(model.coverage(source).duplicateRows, 0)
    assert.equal(model.replay(source).length, 0)
  }
  record('asr-hang-restart', model, { emittedIds: emitted.map(item => item.id), workers: 2,
    maxAttempts: Math.max(...SOURCES.flatMap(source => [...model.session.sources[source].attempts.values()])) })
})

test('missing chunk preserves a measured hole; committed maximum is not contiguous coverage', t => {
  const { model } = setup(t)
  const emitted = Array.from({ length: 3 }, () => model.capture('mic'))
  rmSync(emitted[1].path)
  for (const item of model.replay('mic')) transcribe(model, item)
  model.commit('mic')
  assert.deepEqual(model.coverage('mic').gapIds, [emitted[1].id])
  assert.equal(model.coverage('mic').committedFrames, 32000)
  assert.equal(model.coverage('mic').committedContiguousFrames, 16000)
  assert.equal(model.coverage('mic').missingTranscriptFrames, 16000)
  record('missing-chunk', model, { emittedIds: emitted.map(item => item.id) })
})

test('write failure does not advance acknowledgement or overwrite prior manual edits', t => {
  const { root, model } = setup(t)
  const first = model.capture('mic')
  transcribe(model, first)
  model.commit('mic')
  assert.equal(model.edit(first.id, 'human correction', 0), true)
  assert.equal(model.edit(first.id, 'stale editor', 0), false)
  const second = model.capture('mic')
  transcribe(model, second)
  const before = readFileSync(join(root, 'commits.json'))
  assert.throws(() => model.commit('mic', stage => {
    if (stage === 'file-synced') throw Object.assign(new Error('injected write boundary EIO'), { code: 'EIO' })
  }), /injected write boundary EIO/)
  assert.deepEqual(readFileSync(join(root, 'commits.json')), before)
  assert.equal(model.session.sources.mic.committed.has(second.id), false)
  assert.equal(existsSync(second.path), true)
  // Also exercise a real filesystem error without filling a disk.
  writeFileSync(join(root, 'not-a-directory'), '')
  assert.throws(() => atomicJSON(join(root, 'not-a-directory', 'record.json'), {}), { code: 'ENOTDIR' })
  transcribe(model, first, 'late ASR rewrite')
  model.commit('mic')
  const rows = readJournal(root).rows
  assert.equal(rows[first.id].text, 'human correction')
  assert.equal(rows[first.id].revision, 1)
  assert.equal(Object.keys(rows).length, 2)
  record('disk-write-failure-retry-manual-edit', model, { injectedError: 'EIO before rename', realError: 'ENOTDIR' })
})

test('lost acknowledgement after sync replays idempotently from the actual journal', t => {
  const { root, model } = setup(t)
  const item = model.capture('system')
  transcribe(model, item)
  assert.throws(() => model.commit('system', stage => {
    if (stage === 'directory-synced') throw new Error('lost acknowledgement')
  }), /lost acknowledgement/)
  assert.equal(model.session.sources.system.committed.size, 0)
  assert.equal(Object.keys(readJournal(root).rows).length, 1)
  assert.equal(existsSync(item.path), true)
  model.commit('system')
  assert.equal(Object.keys(readJournal(root).rows).length, 1)
  record('lost-acknowledgement', model, { replayedIds: [item.id], duplicateRows: 0 })
})

test('persistent storage failure exhausts two writes, stops admission and retains recovery input', t => {
  const { model } = setup(t)
  const item = model.capture('mic')
  transcribe(model, item)
  let writes = 0
  const fail = () => { writes++; throw new Error('injected storage unavailable') }
  for (let i = 0; i < 2; i++) assert.throws(() => model.commit('mic', fail), /storage unavailable/)
  assert.throws(() => model.commit('mic', fail), /budget exhausted/)
  assert.equal(writes, 2)
  assert.equal(model.session.phase, 'stopping')
  assert.equal(existsSync(item.path), true)
  assert.equal(model.coverage('mic').committedFrames, 0)
  record('persistent-storage-failure', model, { writeAttempts: writes, retainedFrames: 16000 })
})

test('device generation changes reject stale audio results without resetting source positions', t => {
  const { model } = setup(t)
  const item = model.capture('mic')
  const old = model.token('mic')
  model.switchDevice('mic')
  assert.equal(model.accept(old, item, 'stale device'), false)
  transcribe(model, item, 'replayed saved input')
  const next = model.capture('mic')
  assert.equal(next.start, 16000)
  transcribe(model, next)
  model.commit('mic')
  assert.equal(model.session.sources.system.generation, 0)
  record('device-change-model', model)
})

test('pending B failure cannot relabel empty ended A; stale terminal cannot stop subsequent B', t => {
  const { model } = setup(t)
  const a = model.token('mic')
  model.stop('capture-A')
  model.terminal(a) // Deliberately zero segments, matching the production ownership hazard.
  assert.equal(model.reserve('attempt-B1', 'meeting-B'), true)
  assert.equal(model.snapshot('meeting-B'), null)
  assert.equal(model.failStart('attempt-B1'), true)
  assert.equal(model.snapshot('meeting-B'), null)
  assert.equal(model.snapshot('meeting-A').captureId, 'capture-A')
  assert.equal(model.reserve('attempt-B2', 'meeting-B'), true)
  assert.equal(model.start('attempt-B1', 'stale-capture'), false)
  assert.equal(model.start('attempt-B2', 'capture-B'), true)
  assert.equal(model.terminal(a), false)
  assert.equal(model.session.phase, 'recording')
  const b = model.capture('mic')
  transcribe(model, b)
  model.commit('mic')
  assert.deepEqual(model.coverage('mic').committedIds, ['capture-B-mic-0'])
  model.stop('capture-B')
  model.terminal(model.token('mic'))
  model.reserve('attempt-C', 'meeting-C')
  assert.equal(model.start('attempt-C', 'capture-A'), false)
  assert.equal(model.start('attempt-C', 'capture-C'), false)
  record('pending-attempt-stale-terminal', model)
})

test('renderer replacement reattaches without another capture or loss; Stop needs no subscriber', t => {
  const { model } = setup(t)
  const a = model.capture('mic')
  transcribe(model, a)
  model.commit('mic')
  model.replaceRenderer()
  const b = model.capture('mic')
  transcribe(model, b)
  model.commit('mic')
  assert.equal(model.snapshot('meeting-A').captureId, 'capture-A')
  assert.equal(model.reserve('duplicate', 'meeting-A'), false)
  assert.equal(model.stop('capture-A'), true)
  assert.equal(model.capture('mic'), null)
  record('renderer-replacement-model', model, { rendererGeneration: model.renderer })
})

test('retention and retry ceilings stop admission without evicting uncommitted PCM', t => {
  const { model } = setup(t)
  for (const source of SOURCES) for (let i = 0; i < 4; i++) model.capture(source)
  assert.equal(model.peakPendingBytes, 256000)
  const item = model.replay('mic')[0]
  assert.equal(model.attempt(item), true)
  assert.equal(model.attempt(item), true)
  assert.equal(model.attempt(item), false)
  assert.equal(model.capture('mic'), null)
  assert.equal(model.session.phase, 'stopping')
  assert.equal(model.replay('mic').length, 4)
  assert.equal(model.replay('system').length, 4)
  record('bounded-retention-retry', model, { pendingPcmBytes: 256000, attempts: 2 })
})

test('total fixture metadata stays bounded even when every chunk commits', t => {
  const { model } = setup(t)
  for (let i = 0; i < LIMITS.recordsPerSource; i++) {
    const item = model.capture('mic')
    transcribe(model, item)
    model.commit('mic')
  }
  assert.equal(model.capture('mic'), null)
  assert.equal(model.session.sources.mic.records.size, 32)
  record('bounded-session-metadata', model, { maxRecordsPerSource: 32 })
})

test('real writer SIGKILL at file-sync, rename and directory-sync boundaries', { timeout: 15000 }, async t => {
  const { root } = setup(t)
  for (const stage of ['file-synced', 'renamed', 'directory-synced']) {
    const path = join(root, `${stage}.json`)
    atomicJSON(path, { rows: {} })
    const proc = child(t, ['writer', path, stage])
    await until(() => existsSync(`${path}.boundary`))
    const closed = once(proc, 'close')
    proc.kill('SIGKILL')
    await closed
    const rows = JSON.parse(readFileSync(path, 'utf8')).rows
    assert.equal(Object.keys(rows).length, stage === 'file-synced' ? 0 : 1)
    const result = { name: 'writer-process-kill', stage, acknowledged: false,
      reopenedRows: Object.keys(rows).length, powerLossTest: false }
    measurements.push(result)
    console.log(JSON.stringify(result))
  }
})

test('independent Stop and real host SIGKILL both cease synthetic capture', { timeout: 10000 }, async t => {
  const { root } = setup(t)
  for (const action of ['stop', 'kill']) {
    const path = join(root, `${action}.json`)
    const host = child(t, ['host', path])
    const [ready] = await once(host, 'message')
    assert.equal(ready.ready, true)
    // Track the grandchild too: fixture cleanup must work even on assertion failure.
    t.after(() => { try { process.kill(ready.pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e } })
    await delay(25)
    const start = Date.now()
    if (action === 'stop') host.send('stop')
    else host.kill('SIGKILL')
    await until(() => existsSync(path))
    const receipt = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(receipt.reason, action === 'stop' ? 'independent-stop' : 'host-eof')
    assert.ok(receipt.ticks > 0)
    assert.ok(receipt.stoppedAt - start < 3000)
    const saved = readFileSync(path)
    await delay(50)
    assert.deepEqual(readFileSync(path), saved)
    const result = { name: 'capture-process-shutdown', action, ...receipt,
      observedShutdownMs: receipt.stoppedAt - start, nativeDeviceProof: false }
    measurements.push(result)
    console.log(JSON.stringify(result))
  }
})

after(() => {
  if (process.env.DEV508_RECEIPT) writeFileSync(process.env.DEV508_RECEIPT,
    JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
      limits: LIMITS, measurements, runnerMemoryAtEnd: process.memoryUsage() }, null, 2) + '\n')
})
