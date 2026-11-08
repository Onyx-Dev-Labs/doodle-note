import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BARK_HELPER_IDENTITY,
  DictationHelperClient,
  barkHelperIdentity,
  WINDOWS_EXIT_GRACE_MS,
  helperSpawnEnv,
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
const LOG = process.argv[2] // passed as an argument, never built into the code
process.stdin.on('end', () => { fs.appendFileSync(LOG, 'stdin-closed\\n'); setTimeout(() => { fs.appendFileSync(LOG, 'cleaned-up\\n'); process.exit(0) }, 200) })
process.on('SIGTERM', () => { fs.appendFileSync(LOG, 'sigterm\\n'); process.exit(0) })
`
  )
  return { command: process.execPath, args: [script, log], log }
}

const read = async (file: string): Promise<string> => {
  const { readFileSync, existsSync } = await import('node:fs')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/**
 * Wait until a condition holds (checked every 20 ms). The cap only bounds a failing test; a passing
 * test never depends on how long anything takes.
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  capMs = 10_000
): Promise<boolean> {
  for (let waited = 0; waited <= capMs; waited += 20) {
    if (await condition()) return true
    await sleep(20)
  }
  return false
}

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
  // The stand-in takes 200 ms to clean up after stdin closes; a forced end would cut that short.
  await waitFor(async () => (await read(fake.log)).includes('cleaned-up'))
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
    await waitFor(async () => /sigterm/.test(await read(fake.log)))
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
  // ~300 chars (the helper's per-character typing estimate, boundaries, confirm/settle) must fit.
  const long = windowsDeliverBudget('a'.repeat(300))
  assert.ok(long.timeout > short.timeout)
  assert.ok(long.deadlineMs > 8_000)
  // Capped so a pathological length does not wait forever.
  const huge = windowsDeliverBudget('x'.repeat(100_000))
  assert.equal(huge.deadlineMs, 60_000)
  assert.ok(huge.timeout <= 90_000)
})

test('Windows: a deliver carries a length-sized deadline; macOS sends none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-deadline-'))
  const makeHelper = (): string => {
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
    if (req.op === 'deliver') { fs.writeFileSync(process.argv[2], JSON.stringify(req)); send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'paste', verified: true, clipboard: 'restored' }) }
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
    args: [makeHelper(), winSeen],
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
    args: [makeHelper(), macSeen],
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
fs.appendFileSync(process.argv[2], 'start\\n')
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
    args: [script, starts],
    platform: 'win32'
  })
  try {
    assert.equal(await client.muteOutput(), true)
    // Crash the helper while the sound is muted.
    client.restart()
    // Wait for the automatic restart (after its backoff) to launch a fresh helper.
    const startCount = async (): Promise<number> =>
      (await read(starts)).split('\n').filter(Boolean).length
    await waitFor(async () => (await startCount()) >= 2)
    // restoreOutput gives the sound back through the replacement helper.
    await client.restoreOutput()
    const count = await startCount()
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
    await waitFor(() => phases.length >= 2)
    assert.deepEqual(phases, ['lost', 'restored'])
  } finally {
    await client.dispose()
  }
})

import {
  HELPER_DELIVER_MARGIN_MS,
  helperDeliverEstimateMs
} from '../shared/dictation-helper-protocol'

test('the deliver budget clears the helper estimate for short and long text (D)', () => {
  for (const text of [
    'Hi.',
    'Thank you.',
    'hello',
    'hello world',
    'a'.repeat(300),
    'word '.repeat(80)
  ]) {
    const estimate = helperDeliverEstimateMs(text)
    const { timeout, deadlineMs } = windowsDeliverBudget(text)
    // The deadline the helper enforces must leave room for its own worst-case estimate.
    assert.ok(
      deadlineMs >= estimate,
      `deadline ${deadlineMs} < estimate ${estimate} for ${JSON.stringify(text)}`
    )
    assert.ok(deadlineMs <= estimate + HELPER_DELIVER_MARGIN_MS + 1)
    assert.ok(timeout > deadlineMs, 'the wait clears the deadline plus the reply round trip')
  }
})

test('macOS: a helper that dies after a mute is NOT relaunched by restoreOutput (G)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-mac-'))
  const script = join(dir, 'helper.js')
  const starts = join(dir, 'starts.txt')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
fs.appendFileSync(process.argv[2], 'start\\n')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'mute-output') send({ event: 'reply', id: req.id, ok: true, outcome: 'muted' })
    else send({ event: 'reply', id: req.id, ok: true })
  }
})
`
  )
  const mac = new DictationHelperClient({
    command: process.execPath,
    args: [script, starts],
    platform: 'darwin'
  })
  try {
    assert.equal(await mac.muteOutput(), true)
    const exited = new Promise<void>((resolve) => mac.onExit(resolve))
    mac.restart() // the helper dies while the sound is muted
    await exited
    // If restoreOutput relaunched a helper it would wait for that helper's reply, which the stand-in
    // only sends after logging its start: once it returns, the start count is final.
    await mac.restoreOutput()
    const count = (await read(starts)).split('\n').filter(Boolean).length
    assert.equal(count, 1, 'darwin never relaunches the helper from restoreOutput')
  } finally {
    await mac.dispose()
  }
})

test('Windows: a late ready (after the readiness window) is still honoured for the session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-late-'))
  const script = join(dir, 'helper.js')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    send({ event: 'reply', id: req.id, ok: true, outcome: 'muted' })
  }
})
// Announce readiness only when the test says so (after the readiness window has expired), then a
// tap, which tells the test the client has processed the ready line.
const signal = process.argv[2]
const wait = setInterval(() => { if (fs.existsSync(signal)) { clearInterval(wait); send({ event: 'ready', pid: process.pid, platform: 'win32' }); send({ event: 'tap' }) } }, 5)
`
  )
  const signal = join(dir, 'ready-now')
  const client = new DictationHelperClient({
    command: process.execPath,
    args: [script, signal],
    platform: 'win32',
    readyTimeoutMs: 50
  })
  let tapped = false
  client.onTap(() => {
    tapped = true
  })
  try {
    const early = await client.muteOutput() // the readiness window expires first: refused
    assert.equal(early, false, 'a request inside the unready window does not reach the helper')
    writeFileSync(signal, '') // now the (late) ready arrives
    assert.ok(await waitFor(() => tapped), 'the late ready was processed')
    const late = await client.muteOutput()
    assert.equal(late, true, 'a request after the late ready reaches the helper')
  } finally {
    await client.dispose()
  }
})

test('short transcripts clear the deadline against a C#-faithful estimate helper (D)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-est-'))
  const script = join(dir, 'helper.js')
  // The fake helper applies the helper's own estimate (mirroring Delivery.cs) and refuses when the
  // deadline cannot cover it — so an undersized client budget would surface as a real failure.
  writeFileSync(
    script,
    `
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
const PER_CHAR = 50, BOUNDARY = 70, OVERHEAD = 3000, PASTE = 1600
function estimate(text) {
  const n = text.replace(/\\r\\n/g, '\\n')
  let b = 0
  for (const u of n) if (/[\\s\\p{P}]/u.test(u)) b++
  return Math.max(PASTE, n.length * PER_CHAR + b * BOUNDARY + OVERHEAD)
}
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'deliver') {
      const est = estimate(req.text)
      if (req.deadlineMs > 0 && est > req.deadlineMs) send({ event: 'reply', id: req.id, ok: true, outcome: 'refused', reason: 'deadline-exceeded', verified: false, clipboard: 'untouched' })
      else send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'type', verified: true, clipboard: 'untouched' })
    } else send({ event: 'reply', id: req.id, ok: true })
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
    for (const text of ['Hi.', 'Thank you.', 'hello', 'hello world']) {
      const result = await client.deliver('s', text)
      assert.equal(
        result.outcome,
        'delivered',
        `${JSON.stringify(text)} should type, not be refused`
      )
    }
  } finally {
    await client.dispose()
  }
})

/**
 * A helper that records every op it receives (and its environment). With `signal`, it announces
 * readiness only once that file exists, followed by a tap event (so the test knows the client has
 * processed the ready); otherwise at once.
 */
function recordingHelper(signal: string | null): { command: string; args: string[]; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-rec-'))
  const script = join(dir, 'helper.js')
  const log = join(dir, 'ops.txt')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
const note = (line) => fs.appendFileSync(process.argv[2], line + '\\n')
note('started test=' + (process.env.DICTATION_HELPER_TEST || '') + ' other=' + (process.env.DN_KEEP_ME || '') + ' identity=' + (process.env.DICTATION_HELPER_IDENTITY || ''))
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    note('op ' + req.op)
    send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: true, conflicts: [] })
  }
})
const signal = process.argv[3]
const announce = () => { send({ event: 'ready', pid: process.pid, platform: 'test' }); send({ event: 'tap' }) }
if (signal === '-') announce()
else { const wait = setInterval(() => { if (fs.existsSync(signal)) { clearInterval(wait); announce() } }, 5) }
process.stdin.on('end', () => process.exit(0))
`
  )
  return { command: process.execPath, args: [script, log, signal ?? '-'], log }
}

for (const platform of ['darwin', 'win32'] as const) {
  test(`${platform}: a ready that arrives after the readiness window ${platform === 'win32' ? 're-arms' : 'does NOT re-arm'} the hold key`, async () => {
    const signal = join(mkdtempSync(join(tmpdir(), 'dictation-sig-')), 'ready-now')
    const fake = recordingHelper(signal)
    const client = new DictationHelperClient({ ...fake, platform, readyTimeoutMs: 50 })
    let tapped = false
    client.onTap(() => {
      tapped = true
    })
    try {
      // The readiness window expires before the ready: the first start fails (as before on both).
      assert.equal(await client.setHoldKey('rightOption'), 'helper-unavailable')
      writeFileSync(signal, '') // the late ready
      assert.ok(await waitFor(() => tapped), 'the client processed the late ready')
      // A barrier through the same pipe: release() is written without waiting for readiness on both
      // platforms, after any re-arm the ready triggered. Once the helper logs it, every earlier
      // write has been read, so the presence or absence of hold-start below is final.
      client.release('barrier')
      assert.ok(await waitFor(async () => /op release/.test(await read(fake.log))), 'barrier seen')
      const ops = await read(fake.log)
      if (platform === 'win32')
        assert.match(ops, /op hold-start/, 'Windows re-arms on the late ready')
      else
        assert.doesNotMatch(ops, /op hold-start/, 'macOS keeps the base behaviour: no late re-arm')
    } finally {
      await client.dispose()
    }
  })
}

test('Windows: a helper that fails its integrity check is never executed (status included)', async () => {
  const fake = recordingHelper(null)
  let checks = 0
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    verify: async () => {
      checks += 1
      return { ok: false }
    }
  })
  try {
    assert.equal(await client.status(), null)
    assert.equal(await client.setHoldKey('rightControl'), 'helper-unavailable')
    assert.equal(await read(fake.log), '', 'the helper never started')
    assert.ok(checks >= 2, 'every spawn attempt is gated (status and hold-start)')
  } finally {
    await client.dispose()
  }
})

test('Windows: a verified helper starts, and the check runs again before a respawn', async () => {
  const fake = recordingHelper(null)
  let checks = 0
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    verify: async () => {
      checks += 1
      return { ok: true }
    }
  })
  try {
    assert.ok(await client.status())
    assert.equal(checks, 1)
    assert.ok(await client.status())
    assert.equal(checks, 1, 'a running helper is not re-verified per request')
  } finally {
    await client.dispose()
  }
})

test('Windows: a hold lost after the spawn: the helper is ended unseen, re-checked and re-spawned', async () => {
  const fake = recordingHelper(null)
  const events: string[] = []
  let checks = 0
  let taps = 0
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    verify: async () => {
      checks += 1
      const attempt = checks
      let asked = 0
      events.push(`verify ${attempt}`)
      return {
        ok: true,
        locked: true,
        // The first lease is held before the spawn and lost after it (a killed speech worker).
        confirm: async () => {
          asked += 1
          events.push(`confirm ${attempt}.${asked}`)
          return attempt > 1 || asked === 1
        },
        release: () => events.push(`release ${attempt}`)
      }
    }
  })
  client.onTap(() => {
    taps += 1
  })
  try {
    assert.ok(await client.status(), 'the second, confirmed spawn serves the request')
    assert.deepEqual(events, [
      'verify 1',
      'confirm 1.1',
      'confirm 1.2',
      'release 1',
      'verify 2',
      'confirm 2.1',
      'confirm 2.2',
      'release 2'
    ])
    // The first helper announced ready and a tap at once, but it was gated: nothing of it reached
    // the app, and the one status request went to the confirmed helper.
    assert.equal(taps, 1, "only the confirmed helper's tap was seen")
    // The launch's own first status (it marks the launch successful), then the caller's.
    const ops = (await read(fake.log)).split('\n').filter((line) => line.startsWith('op '))
    assert.deepEqual(ops, ['op status', 'op status'])
  } finally {
    await client.dispose()
  }
})

test('Windows: nothing reaches the helper until the post-spawn hold confirmation returns', async () => {
  const fake = recordingHelper(null)
  const events: string[] = []
  let checks = 0
  let resolvePost: ((held: boolean) => void) | null = null
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    verify: async () => {
      checks += 1
      let asked = 0
      events.push('verify')
      return {
        ok: true,
        locked: true,
        confirm: () => {
          asked += 1
          events.push(`confirm ${asked}`)
          if (asked === 1) return Promise.resolve(true)
          return new Promise<boolean>((resolve) => {
            resolvePost = resolve
          })
        },
        release: () => events.push('release')
      }
    }
  })
  let taps = 0
  client.onTap(() => {
    taps += 1
  })
  try {
    // Several callers at once: a status, a delivery, and arming the hold key (a trigger re-arm).
    const status = client.status()
    const delivery = client.deliver('s1', 'hello')
    const hold = client.setHoldKey('rightControl')
    assert.ok(await waitFor(() => resolvePost !== null), 'the post-spawn confirmation is pending')
    // The helper process is running (it logged its start) but is gated.
    assert.ok(
      await waitFor(async () => /started/.test(await read(fake.log))),
      'the helper process started'
    )
    await sleep(300)
    const before = await read(fake.log)
    assert.doesNotMatch(before, /op /, 'no request reached the unconfirmed helper')
    assert.equal(taps, 0, 'its events were held back')
    assert.deepEqual(
      events,
      ['verify', 'confirm 1', 'confirm 2'],
      'one launch for every caller; the lease is not released'
    )
    resolvePost!(true)
    assert.ok(await status)
    assert.notEqual(
      (await delivery).reason,
      'helper-timeout',
      'the delivery was answered by the confirmed helper'
    )
    assert.equal(await hold, null)
    assert.deepEqual(
      events,
      ['verify', 'confirm 1', 'confirm 2', 'release'],
      'released once, after the confirmation'
    )
    assert.equal(checks, 1)
    assert.equal(taps, 1)
    const ops = await read(fake.log)
    assert.match(ops, /op status/)
    assert.match(ops, /op deliver/)
    assert.match(ops, /op hold-start/)
  } finally {
    await client.dispose()
  }
})

test('Windows: a hold that keeps being lost stops after the attempt limit; nothing runs unconfirmed', async () => {
  const fake = recordingHelper(null)
  let checks = 0
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    verify: async () => {
      checks += 1
      return { ok: true, locked: true, confirm: async () => false }
    }
  })
  try {
    assert.equal(await client.status(), null)
    assert.equal(checks, 3, 'three attempts, each with a fresh check')
    assert.equal(
      await read(fake.log),
      '',
      'the pre-spawn confirmation failed each time: never started'
    )
  } finally {
    await client.dispose()
  }
})

test('Windows: a helper that exits because its provider calls are stuck is restarted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-busy-'))
  const script = join(dir, 'helper.js')
  const log = join(dir, 'log.txt')
  writeFileSync(
    script,
    `
const fs = require('node:fs')
fs.appendFileSync(process.argv[2], 'started\\n')
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid, platform: 'win32' })
const starts = fs.readFileSync(process.argv[2], 'utf8').split('started').length - 1
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    // The first helper: every call is stuck past the cap, so it says so and restarts itself.
    if (starts === 1 && req.op === 'deliver') { send({ event: 'reply', id: req.id, ok: true, outcome: 'refused', reason: 'helper-busy', verified: false, clipboard: 'untouched' }); send({ event: 'restarting', reason: 'helper-busy' }); setTimeout(() => process.exit(3), 50) }
    else send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: true, conflicts: [] })
  }
})
process.stdin.on('end', () => process.exit(0))
`
  )
  const client = new DictationHelperClient({
    command: process.execPath,
    args: [script, log],
    platform: 'win32'
  })
  try {
    assert.equal(await client.setHoldKey('rightControl'), null)
    const busy = await client.deliver('s1', 'x')
    assert.equal(busy.reason, 'helper-busy')
    // The client's automatic restart brings a fresh helper (the hold key wants one).
    assert.ok(
      await waitFor(async () => (await read(log)).split('started').length - 1 >= 2),
      'restarted'
    )
    assert.ok(await client.status(), 'the fresh helper answers')
  } finally {
    await client.dispose()
  }
})

test('Windows: DICTATION_HELPER_* never reaches the helper unless the app is in test mode', async () => {
  const env = {
    DICTATION_HELPER_TEST: '1',
    dictation_helper_strategy: 'type',
    DN_KEEP_ME: 'yes',
    PATH: 'x'
  }
  const clean = helperSpawnEnv(env, false)
  assert.equal(clean.DICTATION_HELPER_TEST, undefined)
  assert.equal(clean.dictation_helper_strategy, undefined)
  assert.equal(clean.DN_KEEP_ME, 'yes')
  assert.equal(clean.PATH, 'x')
  assert.equal(helperSpawnEnv(env, true).DICTATION_HELPER_TEST, '1')
  // End to end: the spawned helper does not see the variable.
  const fake = recordingHelper(null)
  const client = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    env: helperSpawnEnv({ ...process.env, DICTATION_HELPER_TEST: '1', DN_KEEP_ME: 'yes' }, false)
  })
  try {
    assert.ok(await client.status())
    assert.match(await read(fake.log), /started test= other=yes/)
  } finally {
    await client.dispose()
  }
})

test('Windows: the helper is told the app identity, which the user environment cannot override', async () => {
  const fake = recordingHelper(null)
  const prod = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    env: helperSpawnEnv({ ...process.env, DICTATION_HELPER_IDENTITY: 'someone.else' }, false)
  })
  try {
    assert.ok(await prod.status())
    const lines = (await read(fake.log)).split(/\r?\n/)
    assert.ok(
      lines.some((line) => line.endsWith(` identity=${BARK_HELPER_IDENTITY}`)),
      'the production identity, not the one in the environment'
    )
  } finally {
    await prod.dispose()
  }
  const qaFake = recordingHelper(null)
  const qa = new DictationHelperClient({
    ...qaFake,
    platform: 'win32',
    identity: 'com.doodlenote.desktop.qa'
  })
  try {
    assert.ok(await qa.status())
    assert.match(await read(qaFake.log), /identity=com\.doodlenote\.desktop\.qa/)
  } finally {
    await qa.dispose()
  }
})

test('the helper identity follows the build channel; an identity module can override it', async () => {
  assert.equal(barkHelperIdentity('release'), 'com.doodlenote.desktop')
  assert.equal(
    barkHelperIdentity('dev'),
    'com.doodlenote.desktop.dev',
    'the Dev app keeps its own state'
  )
  assert.notEqual(barkHelperIdentity('dev'), barkHelperIdentity('release'))
  assert.equal(
    barkHelperIdentity('release', 'com.doodlenote.desktop.qa'),
    'com.doodlenote.desktop.qa'
  )
  assert.equal(
    barkHelperIdentity('dev', '  '),
    'com.doodlenote.desktop.dev',
    'a blank override is ignored'
  )
  // End to end: a Dev-channel client hands the helper the Dev identity.
  const fake = recordingHelper(null)
  const dev = new DictationHelperClient({
    ...fake,
    platform: 'win32',
    identity: barkHelperIdentity('dev')
  })
  try {
    assert.ok(await dev.status())
    assert.ok(
      (await read(fake.log))
        .split(/\r?\n/)
        .some((line) => line.endsWith(' identity=com.doodlenote.desktop.dev'))
    )
  } finally {
    await dev.dispose()
  }
})
