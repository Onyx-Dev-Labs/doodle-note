const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { mailbox, stopChild, mcpSmoke, workerSmoke } = require('./mac-candidate-runtime-smoke.cjs')

test('mailbox correlates out-of-order responses and accepts notifications', async () => {
  const box = mailbox(1000)
  const a = box.wait(1), b = box.wait(2)
  box.accept({ method: 'notifications/logging', params: {} })
  box.accept({ id: 2, result: 'second' }); box.accept({ id: 1, result: 'first' })
  assert.equal((await a).result, 'first'); assert.equal((await b).result, 'second')
  box.close()
})

test('missing response times out and makes subsequent requests fail', async () => {
  const box = mailbox(10)
  await assert.rejects(box.wait(1), /timeout/)
  await assert.rejects(box.wait(2), /timeout/)
})

for (const invalid of [null, { id: 'wrong' }]) {
  test(`invalid protocol reply fails pending requests: ${JSON.stringify(invalid)}`, async () => {
    const box = mailbox()
    const pending = box.wait(1)
    box.accept(invalid)
    await assert.rejects(pending, /Malformed|Unexpected/)
  })
}

test('child failure rejects every outstanding request', async () => {
  const box = mailbox()
  const pending = [box.wait(1), box.wait(2)]
  box.fail(new Error('Child exited'))
  for (const request of pending) await assert.rejects(request, /Child exited/)
})

async function fixture(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-protocol-test-'))
  try { await work(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

for (const [name, source, pattern] of [
  ['exit', 'process.exit(1)', /exited/],
  ['malformed output', 'console.log("not JSON"); setInterval(()=>{},1000)', /Invalid MCP JSON/],
  ['wrong request id', 'console.log(JSON.stringify({id:999})); setInterval(()=>{},1000)', /Unexpected protocol/]
]) {
  test(`actual stdio subprocess ${name} is a failed smoke and is cleaned up`, async () => fixture(async (root) => {
    const cli = path.join(root, 'fake.cjs')
    const pid = path.join(root, 'pid')
    fs.writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(pid)},String(process.pid));\n${source}`)
    await assert.rejects(mcpSmoke(cli, root), pattern)
    const childPid = Number(fs.readFileSync(pid, 'utf8'))
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' })
  }))
}

test('actual worker error fails the smoke and worker is terminated', async () => fixture(async (root) => {
  const worker = path.join(root, 'bad-worker.cjs')
  fs.writeFileSync(worker, 'throw new Error("synthetic startup failure")')
  await assert.rejects(workerSmoke(worker, root), /synthetic startup failure/)
}))

test('child cleanup escalates when SIGTERM is ignored', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'],
    { stdio: ['ignore', 'pipe', 'ignore'] })
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject) })
  await stopChild(child)
  assert.equal(child.signalCode, 'SIGKILL')
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
})
