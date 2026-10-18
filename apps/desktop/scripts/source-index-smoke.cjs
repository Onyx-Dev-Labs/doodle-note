/* Run after desktop build: pnpm --filter desktop exec electron scripts/source-index-smoke.cjs
 * Uses an isolated synthetic library. Also runs in ELECTRON_RUN_AS_NODE mode. */
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { Worker } = require('node:worker_threads')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const root = mkdtempSync(join(tmpdir(), 'doodle-electron-index-'))
const electron = require('electron')
const app = typeof electron === 'object' ? electron.app : null
if (app) app.setPath('userData', join(root, 'profile'))
async function run() {
  const dir = join(root, 'meetings'); mkdirSync(dir)
  writeFileSync(join(dir, 'synthetic.json'), JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'Café original source', segments: [] }))
  const original = readFileSync(join(dir, 'synthetic.json'))
  const probe = new DatabaseSync(':memory:')
  for (const tokenizer of ['unicode61', 'trigram']) probe.exec(`CREATE VIRTUAL TABLE ${tokenizer} USING fts5(text, tokenize='${tokenizer}')`)
  const sqlite = probe.prepare('SELECT sqlite_version() version').get().version; probe.close()
  const worker = new Worker(resolve(process.env.DOODLE_SOURCE_WORKER || 'out/main/source-index-worker.js'), { workerData: { meetingsDir: dir, cacheDir: join(root, 'cache') } })
  const messages = []
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker smoke timed out')), 15000)
      worker.on('error', reject)
      worker.on('message', message => {
        messages.push(message)
        if (message.ready) worker.postMessage({ id: 1, generation: 0, cancellation: new SharedArrayBuffer(4), context: { meetingsDir: dir, scope: message.scope, authorized: true }, operation: 'search', query: 'cafe', limit: 10 })
        else { clearTimeout(timeout); if (message.error) reject(new Error(message.error)); else resolve() }
      })
    })
    assert.equal(messages[1].result.hits[0].text, 'Café original source')
    assert.equal(messages[1].result.freshness, 'reconciled')
    assert.deepEqual(readFileSync(join(dir, 'synthetic.json')), original)
    console.log(JSON.stringify({ passed: true, electron: process.versions.electron, node: process.versions.node, sqlite, arch: process.arch, worker: process.env.DOODLE_SOURCE_WORKER || 'out/main/source-index-worker.js', nativeAppProcess: !!app }))
  } finally { await worker.terminate() }
}
Promise.resolve(app ? app.whenReady() : undefined).then(run).then(() => { rmSync(root, { recursive: true, force: true }); if (app) app.exit(0) }).catch(error => { console.error(error); rmSync(root, { recursive: true, force: true }); if (app) app.exit(1); else process.exitCode = 1 })
