#!/usr/bin/env node
// Smoke test for Bark's Windows dictation helper: it starts, announces itself, answers
// the NDJSON protocol, and leaves when stdin closes. Needs no desktop interaction.
//   node scripts/test-dictation-helper-win.cjs <path to dictation-helper.exe>
const { spawn } = require('node:child_process')
const helper = process.argv[2]
if (!helper) {
  console.error('usage: test-dictation-helper-win.cjs <dictation-helper.exe>')
  process.exit(2)
}
const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
const lines = []
let buffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
    lines.push(JSON.parse(buffer.slice(0, i)))
    buffer = buffer.slice(i + 1)
  }
})
const wait = (predicate, ms) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = lines.find(predicate)
      if (found) {
        clearInterval(timer)
        resolve(found)
      } else if (Date.now() - started > ms) {
        clearInterval(timer)
        reject(new Error(`timed out; saw ${JSON.stringify(lines)}`))
      }
    }, 20)
  })
const send = (request) => child.stdin.write(`${JSON.stringify(request)}\n`)
async function main() {
  child.on('error', (error) => {
    console.error(`the helper did not start: ${error.code ?? error.message}`)
    process.exit(1)
  })
  const ready = await wait((l) => l.event === 'ready', 10_000)
  if (ready.platform !== 'win32') throw new Error('ready event without platform')
  send({ op: 'status', id: 's' })
  send({ op: 'request-accessibility', id: 'a' })
  send({ op: 'hold-start', id: 'f', key: 'fn', minHoldMs: 150 })
  send({ op: 'deliver', id: 'd', snapshotId: 'none', text: 'x' })
  send({ op: 'nope', id: 'u' })
  const status = await wait((l) => l.id === 's', 10_000)
  const access = await wait((l) => l.id === 'a', 5_000)
  const fn = await wait((l) => l.id === 'f', 5_000)
  const deliver = await wait((l) => l.id === 'd', 5_000)
  const unknown = await wait((l) => l.id === 'u', 5_000)
  const checks = [
    [
      'status reply',
      status.ok === true &&
        status.accessibility === true &&
        typeof status.inputMonitoring === 'boolean'
    ],
    ['no Accessibility permission on Windows', access.trusted === true],
    ['Fn is not a Windows key', fn.ok === false && fn.reason === 'unknown-key'],
    [
      'a delivery without a snapshot is refused',
      deliver.outcome === 'refused' && deliver.reason === 'no-target'
    ],
    ['unknown op', unknown.ok === false && unknown.reason === 'unknown-op']
  ]
  const code = await new Promise((resolve) => {
    child.on('exit', resolve)
    child.stdin.end()
    setTimeout(() => resolve('timeout'), 5_000)
  })
  checks.push(['exits when stdin closes', code === 0])
  for (const [name, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${name}`)
  console.log(`hooks allowed: ${status.inputMonitoring}`)
  if (checks.some(([, ok]) => !ok)) process.exit(1)
  console.log('Windows dictation helper smoke passed')
}
main().catch((error) => {
  console.error(error)
  child.kill()
  process.exit(1)
})
