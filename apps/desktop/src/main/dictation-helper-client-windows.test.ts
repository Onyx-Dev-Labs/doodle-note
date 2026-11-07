import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DictationHelperClient,
  WINDOWS_EXIT_GRACE_MS,
  windowsDeliverBudget
} from './dictation-helper-client'

/** A stand-in helper (run by Node) that logs how it was asked to leave. */
function lingeringHelper(): { command: string; args: string[]; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-win-'))
  const script = join(dir, 'helper.js')
  const log = join(dir, 'log.txt')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'deliver') send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'type', verified: true, clipboard: 'untouched' })
    else if (req.op === 'status') send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: true, inputMonitoringAccess: 'granted', secureInput: false, conflicts: [], holdActive: false, mouseActive: false, platform: 'win32' })
    else send({ event: 'reply', id: req.id, ok: true })
  }
})
// Like the Windows helper: closing stdin is the request to leave; clean-up takes a moment.
process.stdin.on('end', () => { fs.appendFileSync(${JSON.stringify(log)}, 'stdin-closed\\n'); setTimeout(() => { fs.appendFileSync(${JSON.stringify(log)}, 'cleaned-up\\n'); process.exit(0) }, 200) })
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, 'sigterm\\n'); process.exit(0) })
`
  )
  return { command: process.execPath, args: [script], log }
}

const read = async (file: string): Promise<string> => {
  const { readFileSync, existsSync } = await import('node:fs')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('Windows: the helper reports typing as its delivery method', async () => {
  const fake = lingeringHelper()
  const client = new DictationHelperClient({ ...fake, platform: 'win32' })
  const result = await client.deliver('s1', 'hello')
  assert.equal(result.method, 'type')
  assert.equal(result.outcome, 'delivered')
  await client.dispose()
})

test('Windows: dispose lets the helper clean up (no forced end inside the grace period)', async () => {
  const fake = lingeringHelper()
  const client = new DictationHelperClient({ ...fake, platform: 'win32' })
  assert.ok(await client.status())
  await client.dispose()
  await sleep(600)
  assert.equal(await read(fake.log), 'stdin-closed\ncleaned-up\n')
  assert.ok(WINDOWS_EXIT_GRACE_MS > 600)
})

test(
  'macOS: dispose still sends SIGTERM at once, as before',
  { skip: process.platform === 'win32' },
  async () => {
    const fake = lingeringHelper()
    const client = new DictationHelperClient({ ...fake, platform: 'darwin' })
    assert.ok(await client.status())
    await client.dispose()
    await sleep(400)
    assert.match(await read(fake.log), /sigterm/)
    assert.doesNotMatch(await read(fake.log), /cleaned-up/)
  }
)

test('Windows: a helper that Windows refuses to start is reported as blocked, never on macOS', async () => {
  // A file that exists but cannot be started: on Windows a .exe that is not a real program
  // fails with UNKNOWN, the code Windows Application Control blocks produce (seen on Dev04).
  const dir = mkdtempSync(join(tmpdir(), 'dictation-blocked-'))
  const command = join(dir, process.platform === 'win32' ? 'helper.exe' : 'helper')
  writeFileSync(command, 'not a program')
  const windows = new DictationHelperClient({ command, platform: 'win32' })
  assert.equal(windows.available, true)
  assert.equal(windows.blocked, false, 'nothing known before the first start')
  assert.equal(await windows.status(), null)
  assert.equal(windows.blocked, true)
  const mac = new DictationHelperClient({ command, platform: 'darwin' })
  assert.equal(await mac.status(), null)
  assert.equal(mac.blocked, false)
})

test('the Windows deliver budget grows with the text so a long typing fallback never times out', () => {
  const short = windowsDeliverBudget('hello')
  assert.ok(short.timeout >= 3_500)
  assert.ok(short.deadlineMs < short.timeout)
  // ~300 chars (typing ~ 300*8 + boundaries*70 + confirm/settle) must fit in the budget.
  const long = windowsDeliverBudget('a'.repeat(300))
  assert.ok(long.timeout > short.timeout)
  assert.ok(long.deadlineMs > 8_000)
  // Capped so a pathological length does not wait forever.
  assert.equal(windowsDeliverBudget('x'.repeat(100_000)).timeout, 60_000)
})

test('Windows: a deliver carries a length-sized deadline; macOS sends none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-deadline-'))
  const makeHelper = (seenPath: string): string => {
    const file = join(dir, `helper-${Math.random().toString(36).slice(2)}.js`)
    writeFileSync(
      file,
      `
const fs = require('node:fs')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'deliver') { fs.writeFileSync(${JSON.stringify(seenPath)}, JSON.stringify(req)); send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'paste', verified: true, clipboard: 'restored' }) }
    else send({ event: 'reply', id: req.id, ok: true })
  }
})
`
    )
    return file
  }
  const winSeen = join(dir, 'win-seen.json')
  const win = new DictationHelperClient({
    command: process.execPath,
    args: [makeHelper(winSeen)],
    platform: 'win32'
  })
  try {
    await win.deliver('s', 'hello world')
    const req = JSON.parse(readFileSync(winSeen, 'utf8'))
    assert.equal(typeof req.deadlineMs, 'number')
    assert.ok(req.deadlineMs > 0)
  } finally {
    await win.dispose()
  }

  const macSeen = join(dir, 'mac-seen.json')
  const mac = new DictationHelperClient({
    command: process.execPath,
    args: [makeHelper(macSeen)],
    platform: 'darwin'
  })
  try {
    await mac.deliver('s', 'hello world')
    const macReq = JSON.parse(readFileSync(macSeen, 'utf8'))
    assert.equal(macReq.deadlineMs, undefined)
  } finally {
    await mac.dispose()
  }
})
test('Windows: a helper that crashes while the sound is muted is replaced to give it back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-restart-'))
  const script = join(dir, 'helper.js')
  const starts = join(dir, 'starts.txt')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(starts)}, 'start\\n')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'mute-output') send({ event: 'reply', id: req.id, ok: true, outcome: 'muted' })
    else if (req.op === 'restore-output') { send({ event: 'reply', id: req.id, ok: true, outcome: 'restored' }); process.exit(0) }
    else send({ event: 'reply', id: req.id, ok: true })
  }
})
`
  )
  const client = new DictationHelperClient({
    command: process.execPath,
    args: [script],
    platform: 'win32'
  })
  try {
    assert.equal(await client.muteOutput(), true)
    // Crash the helper while the sound is muted.
    client.restart()
    // The automatic restart backoff is 500 ms; wait past it so a fresh helper has launched.
    await sleep(900)
    // restoreOutput gives the sound back through the replacement helper.
    await client.restoreOutput()
    await sleep(200)
    const count = (await read(starts)).split('\n').filter(Boolean).length
    assert.ok(count >= 2, `expected a restart, saw ${count} starts`)
  } finally {
    await client.dispose()
  }
})

test('Windows: a hooks event reaches onHooks listeners', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-hooks-'))
  const script = join(dir, 'helper.js')
  writeFileSync(
    script,
    `
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'status') { send({ event: 'hooks', phase: 'lost' }); send({ event: 'hooks', phase: 'restored' }) }
    send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: true, inputMonitoringAccess: 'granted', secureInput: false, conflicts: [], holdActive: false, mouseActive: false, hooksLive: true, platform: 'win32' })
  }
})
`
  )
  const client = new DictationHelperClient({
    command: process.execPath,
    args: [script],
    platform: 'win32'
  })
  const phases: string[] = []
  client.onHooks((phase) => phases.push(phase))
  try {
    const status = await client.status()
    assert.equal(status?.hooksLive, true)
    await sleep(100)
    assert.deepEqual(phases, ['lost', 'restored'])
  } finally {
    await client.dispose()
  }
})
