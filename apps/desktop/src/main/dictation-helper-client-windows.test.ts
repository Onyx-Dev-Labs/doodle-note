import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DictationHelperClient, WINDOWS_EXIT_GRACE_MS } from './dictation-helper-client'

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
