// Executed only after artifact, receipt and signatures are verified. No app GUI.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { createInterface } = require('node:readline')

// One bounded mailbox for both worker and stdio protocols. Unexpected exits,
// malformed replies and timeout are failures, never successful skips.
function mailbox(timeoutMs = 10000) {
  const pending = new Map()
  let failed
  const fail = (error) => {
    failed = error
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    pending.clear()
  }
  return {
    wait(id) {
      if (failed) return Promise.reject(failed)
      assert.ok(!pending.has(id), 'Duplicate request identity')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`Protocol timeout: ${id}`)), timeoutMs)
        pending.set(id, { resolve, reject, timer })
      })
    },
    accept(message) {
      if (!message || typeof message !== 'object') { fail(new Error('Malformed protocol reply')); return }
      const key = message.ready ? 'ready' : message.id
      // Notifications have no id; they are not responses to pending requests.
      if (key === undefined && typeof message.method === 'string') return
      const waiter = pending.get(key)
      if (!waiter) { fail(new Error('Unexpected protocol identity')); return }
      pending.delete(key)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    },
    fail,
    close() { fail(new Error('Protocol closed')) }
  }
}

async function workerSmoke(workerPath, root) {
  const meetingsDir = path.join(root, 'worker-originals')
  fs.mkdirSync(meetingsDir)
  const originalPath = path.join(meetingsDir, 'synthetic.json')
  const original = JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'Café needle original', segments: [] })
  fs.writeFileSync(originalPath, original)
  const inbox = mailbox()
  const ready = inbox.wait('ready')
  const worker = new Worker(workerPath, { workerData: { meetingsDir, cacheDir: path.join(root, 'worker-cache') } })
  worker.on('message', (m) => inbox.accept(m))
  worker.on('error', (e) => inbox.fail(e))
  worker.on('exit', () => inbox.fail(new Error('Worker exited')))
  let next = 0
  try {
    const { scope } = await ready
    assert.equal(typeof scope.libraryId, 'string')
    assert.equal(scope.accountId, null)
    assert.equal(scope.workspaceId, null)
    const context = { meetingsDir, scope, authorized: true }
    const request = async (extra = {}) => {
      const id = ++next
      const result = inbox.wait(id)
      worker.postMessage({ id, generation: 17, cancellation: new SharedArrayBuffer(4), context,
        operation: 'search', query: 'needle', limit: 10, ...extra })
      const reply = await result
      assert.equal(reply.generation, 17)
      return reply
    }
    const search = await request()
    assert.equal(search.error, undefined)
    assert.equal(search.result.freshness, 'reconciled')
    assert.equal(search.result.hits.length, 1)
    const anchor = search.result.hits[0].anchor
    assert.equal((await request({ operation: 'resolve', anchor })).result.status, 'resolved')
    assert.equal(fs.readFileSync(originalPath, 'utf8'), original)
    const edited = JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'Edited needle original' })
    fs.writeFileSync(originalPath, edited)
    assert.equal((await request({ operation: 'resolve', anchor })).result.status, 'stale')
    assert.ok((await request({ context: { ...context, authorized: false } })).error)
    assert.ok((await request({ context: { ...context, scope: { ...scope, libraryId: 'wrong' } } })).error)
    const cancellation = new SharedArrayBuffer(4)
    Atomics.store(new Int32Array(cancellation), 0, 1)
    assert.equal((await request({ cancellation })).cancelled, true)
    assert.equal(fs.readFileSync(originalPath, 'utf8'), edited)
    assert.deepEqual(fs.readdirSync(meetingsDir).sort(), ['.doodlenote-source-library.json', 'synthetic.json'])
    return ['worker ready/search/resolve/stale/cancel/scope refusal', 'worker originals preserved']
  } finally {
    inbox.close()
    await worker.terminate()
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve, reject) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
    const timeout = setTimeout(() => reject(new Error('Child cleanup timeout')), 5000)
    child.once('exit', () => { clearTimeout(kill); clearTimeout(timeout); resolve() })
    child.kill('SIGTERM')
  })
}

async function mcpSmoke(cli, root, executable = process.execPath) {
  const dir = path.join(root, 'mcp-originals')
  fs.mkdirSync(dir)
  const config = path.join(root, 'mcp.json')
  fs.writeFileSync(config, JSON.stringify({ enabled: true, meetingsDir: dir }))
  const originalPath = path.join(dir, 'synthetic.json')
  const original = { id: 'synthetic', segments: [{ id: 'one', channel: 'system', speakerId: 'far',
    text: 'offline needle', speaker: 'Them' }], participants: [{ id: 'far', name: 'Alice', source: 'manual', confidence: 1 }] }
  const save = () => fs.writeFileSync(originalPath, JSON.stringify(original))
  save()
  const child = spawn(executable, [cli], { env: { ...process.env, DOODLE_NOTE_MCP_CONFIG: config },
    stdio: ['pipe', 'pipe', 'pipe'] })
  const inbox = mailbox()
  child.on('error', (e) => inbox.fail(e))
  child.on('exit', () => inbox.fail(new Error('MCP exited')))
  child.stdin.on('error', (e) => inbox.fail(e))
  // Drain stderr without exposing uncontrolled diagnostics or pipe deadlock.
  child.stderr.resume()
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try { inbox.accept(JSON.parse(line)) } catch { inbox.fail(new Error('Invalid MCP JSON')) }
  })
  let next = 0
  const call = async (method, params) => {
    const id = ++next
    const reply = inbox.wait(id)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    const message = await reply
    assert.equal(message.jsonrpc, '2.0')
    assert.equal(message.error, undefined)
    return message.result
  }
  const tool = async (name, args) => {
    const result = await call('tools/call', { name, arguments: args })
    assert.ok(!result.isError, 'MCP tool failed')
    return JSON.parse(result.content[0].text)
  }
  try {
    assert.ok(await call('initialize', { protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'signed-candidate-smoke', version: '1' } }))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    assert.ok((await call('tools/list', {})).tools.some((t) => t.name === 'search_meeting_sources'))
    const search = await tool('search_meeting_sources', { query: 'needle' })
    assert.equal(search.hits.length, 1)
    assert.equal(search.hits[0].speaker, 'Alice')
    const anchor = search.hits[0].anchor
    assert.equal((await tool('resolve_meeting_source', { anchor })).status, 'resolved')
    assert.equal(fs.readFileSync(originalPath, 'utf8'), JSON.stringify(original))
    original.participants[0].name = 'Bob'; save()
    const corrected = await tool('search_meeting_sources', { query: 'needle' })
    assert.equal(corrected.hits[0].speaker, 'Bob')
    assert.notEqual(corrected.hits[0].anchor.revisionId, anchor.revisionId)
    assert.equal((await tool('resolve_meeting_source', { anchor })).status, 'stale')
    fs.writeFileSync(config, JSON.stringify({ enabled: false, meetingsDir: dir }))
    assert.equal((await call('tools/call', { name: 'search_meeting_sources', arguments: { query: 'needle' } })).isError, true)
    assert.equal(fs.readFileSync(originalPath, 'utf8'), JSON.stringify(original))
    assert.deepEqual(fs.readdirSync(dir), ['synthetic.json'])
    return ['MCP stdio initialize/tools/search/resolve/participant correction/stale/revocation', 'MCP originals preserved']
  } finally {
    inbox.close()
    lines.close()
    await stopChild(child)
  }
}

function findAddon(root) {
  const matches = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) matches.push(...findAddon(file))
    else if (entry.isFile() && entry.name === 'llama-addon.node') matches.push(file)
  }
  return matches
}

async function main(app, root) {
  assert.equal(process.platform, 'darwin')
  assert.equal(process.arch, 'arm64')
  assert.ok(process.versions.electron, 'Must use the packaged Electron runtime')
  fs.mkdirSync(root)
  const resources = path.join(app, 'Contents/Resources')
  const addons = findAddon(path.join(resources, 'app.asar.unpacked/node_modules/@node-llama-cpp/mac-arm64-metal'))
  assert.equal(addons.length, 1, 'Expected one packaged Metal addon')
  require(addons[0]) // Module load only: no getLlama, model or native build.
  const { DatabaseSync } = require('node:sqlite')
  const database = new DatabaseSync(':memory:')
  let sqlite
  try {
    for (const tokenizer of ['unicode61', 'trigram']) database.exec(`CREATE VIRTUAL TABLE ${tokenizer} USING fts5(text, tokenize='${tokenizer}')`)
    sqlite = database.prepare('SELECT sqlite_version() version').get().version
  } finally { database.close() }
  const checks = [
    'packaged llama addon and SQLite FTS5 load (no inference)',
    ...await workerSmoke(path.join(resources, 'app.asar/out/main/source-index-worker.js'), root),
    ...await mcpSmoke(path.join(resources, 'mcp/cli.js'), root)
  ]
  return { passed: true, electron: process.versions.electron, node: process.versions.node,
    sqlite, arch: process.arch, checks }
}

module.exports = { mailbox, stopChild, workerSmoke, mcpSmoke }
if (require.main === module) {
  main(path.resolve(process.argv[2]), path.resolve(process.argv[3])).then((result) => {
    // Native module teardown is not part of this load/protocol smoke.
    process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0))
  }).catch((error) => { console.error(error.message); process.exit(1) })
}
