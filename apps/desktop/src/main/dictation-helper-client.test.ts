import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DictationHelperClient, type HoldEvent } from './dictation-helper-client'

/** A scripted stand-in for the native helper, speaking the same NDJSON. */
function fakeHelper(behavior: string): { command: string; args: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-fake-'))
  const script = join(dir, 'helper.js')
  writeFileSync(
    script,
    `
const mode = process.argv[2]
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
send({ event: 'ready', pid: process.pid })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  for (let i = buf.indexOf('\\n'); i !== -1; i = buf.indexOf('\\n')) {
    const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    if (req.op === 'status') send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: false, secureInput: false, conflicts: ['Wispr Flow'], holdActive: false })
    else if (req.op === 'snapshot') send({ event: 'reply', id: req.id, ok: true, snapshotId: req.snapshotId, pid: 42, bundleId: 'com.apple.TextEdit', appName: 'TextEdit', hasElement: true, accessibility: true, role: 'AXTextArea', secure: false, editable: true })
    else if (req.op === 'deliver') {
      if (mode === 'hang') return
      if (mode === 'crash') process.exit(1)
      send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'ax', verified: true, clipboard: 'untouched' })
    } else if (req.op === 'input-state') {
      if (req.uid === 'gone') send({ event: 'reply', id: req.id, ok: false, reason: 'no-input-device' })
      else if (req.uid === 'bare') send({ event: 'reply', id: req.id, ok: true })
      else send({ event: 'reply', id: req.id, ok: true, muted: true, volume: 0 })
    } else if (req.op === 'hold-start' && mode === 'taps') {
      send({ event: 'reply', id: req.id, ok: true })
      send({ event: 'tap' })
      send({ event: 'tap' })
    } else if (req.op === 'hold-start') {
      send({ event: 'reply', id: req.id, ok: true })
      send({ event: 'hold', phase: 'down', holdId: 1 })
      send({ event: 'hold', phase: 'up', holdId: 1, reason: 'released' })
    } else send({ event: 'reply', id: req.id, ok: true })
  }
})
process.stdin.on('end', () => process.exit(0))
`
  )
  return { command: process.execPath, args: [script, behavior] }
}

const fast = { status: 500, snapshot: 500, deliver: 300, hold: 500 }

test('status, snapshot and deliver round-trip with typed fields', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    const status = await client.status()
    assert.equal(status?.accessibility, true)
    assert.equal(status?.inputMonitoring, false)
    assert.deepEqual(status?.conflicts, ['Wispr Flow'])
    const target = await client.snapshot('s-1')
    assert.equal(target?.appName, 'TextEdit')
    assert.equal(target?.editable, true)
    const result = await client.deliver('s-1', 'hello')
    assert.deepEqual(result, {
      outcome: 'delivered',
      method: 'ax',
      verified: true,
      clipboard: 'untouched'
    })
  } finally {
    await client.dispose()
  }
})

test('a stalled delivery is uncertain, never a retry-safe failure', async () => {
  const client = new DictationHelperClient(fakeHelper('hang'), fast)
  try {
    const result = await client.deliver('s-1', 'hello')
    assert.equal(result.outcome, 'uncertain')
    assert.equal(result.reason, 'helper-timeout')
  } finally {
    await client.dispose()
  }
})

test('a helper that dies mid-delivery reports uncertain, then recovers on demand', async () => {
  const client = new DictationHelperClient(fakeHelper('crash'), fast)
  let exits = 0
  client.onExit(() => exits++)
  try {
    const result = await client.deliver('s-1', 'hello')
    assert.equal(result.outcome, 'uncertain')
    assert.equal(exits, 1)
    // Immediately after a crash the client refuses instead of spinning.
    const refused = await client.deliver('s-2', 'again')
    assert.equal(refused.outcome, 'refused')
    assert.equal(refused.reason, 'helper-unavailable')
    await new Promise((r) => setTimeout(r, 600))
    assert.ok((await client.status()) !== null, 'a later request restarts the helper')
  } finally {
    await client.dispose()
  }
})

test('a missing helper binary is reported as unavailable', async () => {
  const client = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.equal(client.available, false)
  const result = await client.deliver('s-1', 'hello')
  assert.equal(result.outcome, 'refused')
  assert.equal(result.reason, 'helper-unavailable')
  assert.equal(await client.status(), null)
})

test('hold events arrive paired and in order', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  const events: HoldEvent[] = []
  client.onHold((e) => events.push(e))
  try {
    assert.equal(await client.setHoldKey('rightOption'), null)
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(events, [
      { phase: 'down', holdId: 1 },
      { phase: 'up', holdId: 1 }
    ])
  } finally {
    await client.dispose()
  }
})

test('quick taps of the hold key arrive as tap events, separate from holds', async () => {
  const client = new DictationHelperClient(fakeHelper('taps'), fast)
  let taps = 0
  const holds: HoldEvent[] = []
  client.onTap(() => taps++)
  client.onHold((e) => holds.push(e))
  try {
    assert.equal(await client.setHoldKey('rightOption'), null)
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(taps, 2)
    assert.deepEqual(holds, [])
  } finally {
    await client.dispose()
  }
})

test('input state reports mute and volume, and is null when the helper cannot say', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await client.inputState('usb-1'), { muted: true, volume: 0 })
    assert.deepEqual(await client.inputState('bare'), { muted: null, volume: null })
    assert.equal(await client.inputState('gone'), null)
  } finally {
    await client.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.equal(await missing.inputState(null), null)
})
