/* Built worker protocol, synthetic only. Plain Node or approved fresh Electron helper. */
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { Worker } = require('node:worker_threads')
const assert = require('node:assert/strict')
const root = mkdtempSync(join(tmpdir(), 'dev507-emitted-'))
const dir = join(root, 'meetings')
mkdirSync(dir)
const file = join(dir, 'synthetic.json'),
  raw = JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'ΚΟΣΜΟΣ original', segments: [] })
writeFileSync(file, raw)
const worker = new Worker(
  resolve(process.env.DOODLE_SOURCE_WORKER || 'out/main/source-index-worker.js'),
  { workerData: { meetingsDir: dir, cacheDir: join(root, 'cache') } }
)
let id = 0
const pending = new Map()
const ready = new Promise((resolve, reject) => {
  worker.once('error', reject)
  worker.once('message', resolve)
})
worker.on('message', (m) => {
  const p = pending.get(m.id)
  if (p) {
    clearTimeout(p.timer)
    pending.delete(m.id)
    m.error ? p.reject(Error(m.error)) : p.resolve(m.result)
  }
})
async function call(scope, operation, fields = {}) {
  const request = ++id
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('emitted worker timed out')), 15000)
    pending.set(request, { resolve, reject, timer })
    worker.postMessage({
      id: request,
      generation: 0,
      cancellation: new SharedArrayBuffer(4),
      context: { meetingsDir: dir, scope, authorized: true },
      operation,
      ...fields
    })
  })
}
async function run() {
  try {
    const { scope } = await ready
    const bundle = await call(scope, 'retrieve-evidence', {
      selection: { mode: 'question', question: 'ΚΟΣΜΟΣ', filters: {} }
    })
    assert.equal(bundle.coverage.scanComplete, true)
    assert.equal(bundle.ranges.length, 1)
    assert.equal(await call(scope, 'validate-evidence', { manifest: bundle.manifest }), 'valid')
    const source = await call(scope, 'resolve', { anchor: bundle.ranges[0].anchor })
    assert.equal(source.status, 'resolved')
    const census = await call(scope, 'census', {
      census: { filters: {}, predicate: { kind: 'literal', text: 'ΚΟΣΜΟΣ' } }
    })
    assert.equal(census.exact, true)
    assert.equal(census.meetingCount, 1)
    const empty = await call(scope, 'retrieve-evidence', {
      selection: { mode: 'linked-history', meetingIds: [] }
    })
    assert.equal(empty.coverage.scannedMeetingCount, 0)
    assert.equal(readFileSync(file, 'utf8'), raw)
    writeFileSync(file, JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'changed' }))
    assert.equal(await call(scope, 'validate-evidence', { manifest: bundle.manifest }), 'stale')
    console.log(
      JSON.stringify({
        passed: true,
        node: process.versions.node,
        electron: process.versions.electron ?? null,
        worker: process.env.DOODLE_SOURCE_WORKER || 'out/main/source-index-worker.js',
        checks: [
          'retrieval',
          'Greek exact match',
          'manifest valid/stale',
          'resolve',
          'census',
          'explicit empty subset',
          'original byte preservation'
        ],
        nativeApp: false
      })
    )
  } finally {
    await worker.terminate()
    for (const p of pending.values()) clearTimeout(p.timer)
    rmSync(root, { recursive: true, force: true })
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
