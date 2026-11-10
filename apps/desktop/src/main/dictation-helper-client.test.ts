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
    if (req.op === 'status') send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: false, secureInput: false, conflicts: ['Wispr Flow'], holdActive: false, mouseActive: true, inputMonitoringAccess: mode === 'not-asked' ? 'not-determined' : 'granted', fnKeyAction: 2 })
    else if (req.op === 'snapshot') send({ event: 'reply', id: req.id, ok: true, snapshotId: req.snapshotId, pid: 42, bundleId: 'com.apple.TextEdit', appName: 'TextEdit', appPath: '/System/Applications/TextEdit.app', hasElement: true, accessibility: true, role: 'AXTextArea', secure: false, editable: true })
    else if (req.op === 'app-icon') {
      if (req.path === '/Applications/Missing.app') send({ event: 'reply', id: req.id, ok: false, reason: 'no-icon' })
      else send({ event: 'reply', id: req.id, ok: true, png: 'QUJD' })
    } else if (req.op === 'app-info') {
      send({ event: 'reply', id: req.id, ok: true, apps: [
        { bundleId: req.bundleIds[0], name: 'Slack', png: 'QUJD' },
        { bundleId: req.bundleIds[1] || 'x' },
        'junk',
        { name: 'no id' }
      ] })
    } else if (req.op === 'watch-read') {
      if (req.watchId === 'gone') send({ event: 'reply', id: req.id, ok: true, state: 'gone' })
      else if (req.watchId === 'secure') send({ event: 'reply', id: req.id, ok: true, state: 'secure' })
      else if (req.watchId === 'odd') send({ event: 'reply', id: req.id, ok: true, state: 'surprise' })
      else send({ event: 'reply', id: req.id, ok: true, state: 'ok', value: 'typed words', focused: true })
    } else if (req.op === 'watch-stop') {
      send({ event: 'reply', id: req.id, ok: true })
    } else if (req.op === 'selection') {
      if (mode === 'secure') send({ event: 'reply', id: req.id, ok: false, reason: 'secure-field' })
      else send({ event: 'reply', id: req.id, ok: true, text: 'picked words' })
    } else if (req.op === 'deliver') {
      if (req.replace === 'gone') { send({ event: 'reply', id: req.id, ok: true, outcome: 'refused', reason: 'text-changed', verified: false, clipboard: 'untouched' }); return }
      if (req.expectSelection === 'stale') { send({ event: 'reply', id: req.id, ok: true, outcome: 'refused', reason: 'selection-changed', verified: false, clipboard: 'untouched' }); return }
      if (mode === 'hang') return
      if (mode === 'crash') process.exit(1)
      send({ event: 'reply', id: req.id, ok: true, outcome: 'delivered', method: 'ax', verified: true, clipboard: 'untouched' })
    } else if (req.op === 'input-state') {
      if (req.uid === 'gone') send({ event: 'reply', id: req.id, ok: false, reason: 'no-input-device' })
      else if (req.uid === 'bare') send({ event: 'reply', id: req.id, ok: true })
      else send({ event: 'reply', id: req.id, ok: true, muted: true, volume: 0 })
    } else if (req.op === 'mute-output') {
      send({ event: 'reply', id: req.id, ok: true, outcome: mode === 'silent' ? 'already-silent' : 'muted' })
    } else if (req.op === 'restore-output') {
      send({ event: 'reply', id: req.id, ok: true, outcome: 'restored' })
    } else if (req.op === 'request-accessibility') {
      send({ event: 'reply', id: req.id, ok: true, trusted: mode === 'grant' })
    } else if (req.op === 'request-input-monitoring') {
      send({ event: 'reply', id: req.id, ok: true, granted: mode === 'grant', state: 'not-determined' })
    } else if (req.op === 'mouse-start') {
      // Replies prove the fields arrived as encoded: only button 3 with swallow true swallows.
      if (!Number.isInteger(req.button) || req.button < 2) send({ event: 'reply', id: req.id, ok: false, reason: 'invalid-button' })
      else if (mode === 'no-permission') send({ event: 'reply', id: req.id, ok: false, reason: 'input-monitoring-denied' })
      else send({ event: 'reply', id: req.id, ok: true, swallowing: req.swallow === true && req.button === 3 && req.minHoldMs === 150 && (req.mode === 'click' || req.mode === 'hold') })
      if (mode === 'clicks') { send({ event: 'click' }); send({ event: 'click' }) }
    } else if (req.op === 'mouse-stop') {
      send({ event: 'reply', id: req.id, ok: true })
      send({ event: 'stopped-marker' })
    } else if (req.op === 'mouse-capture') {
      if (mode === 'primary') send({ event: 'reply', id: req.id, ok: false, reason: 'primary-button' })
      else if (mode === 'no-permission') send({ event: 'reply', id: req.id, ok: false, reason: 'input-monitoring-denied' })
      else if (mode === 'timeout') send({ event: 'reply', id: req.id, ok: false, reason: 'timeout' })
      else send({ event: 'reply', id: req.id, ok: true, button: 4 })
    } else if (req.op === 'toggle-key-set') {
      send({ event: 'reply', id: req.id, ok: mode !== 'no-permission', reason: 'input-monitoring-denied' })
      // Include a deliberately stale off event: the client must suppress it.
      if (mode === 'toggle-events') send({ event: 'key-toggle' })
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

const fast = {
  status: 500,
  snapshot: 500,
  deliver: 300,
  hold: 500,
  capture: 1_500,
  permission: 800
}

test('status, snapshot and deliver round-trip with typed fields', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    const status = await client.status()
    assert.equal(status?.accessibility, true)
    assert.equal(status?.inputMonitoring, false)
    assert.deepEqual(status?.conflicts, ['Wispr Flow'])
    assert.equal(status?.fnKeyAction, 2)
    assert.equal(status?.mouseActive, true)
    const target = await client.snapshot('s-1')
    assert.equal(target?.appName, 'TextEdit')
    assert.equal(target?.appPath, '/System/Applications/TextEdit.app')
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

test('the mouse button request carries the button, swallow flag and hold delay; the reply is decoded', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await client.setMouseButton(3, true), { ok: true, swallowing: true })
    assert.deepEqual(await client.setMouseButton(3, false), { ok: true, swallowing: false })
    assert.deepEqual(await client.setMouseButton(4, true), { ok: true, swallowing: false })
    assert.deepEqual(await client.setMouseButton(1, false), {
      ok: false,
      failure: 'invalid-button'
    })
    assert.equal(await client.setMouseButton(null, true), null)
  } finally {
    await client.dispose()
  }
})

test('a missing permission or a missing helper is reported for the mouse button', async () => {
  const denied = new DictationHelperClient(fakeHelper('no-permission'), fast)
  try {
    assert.deepEqual(await denied.setMouseButton(3, true), {
      ok: false,
      failure: 'input-monitoring-denied'
    })
    assert.deepEqual(await denied.captureMouseButton(), {
      ok: false,
      failure: 'input-monitoring-denied'
    })
  } finally {
    await denied.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.deepEqual(await missing.setMouseButton(3, true), {
    ok: false,
    failure: 'helper-unavailable'
  })
  assert.deepEqual(await missing.captureMouseButton(), { ok: false, failure: 'helper-unavailable' })
})

test('capturing a mouse button returns the number, or says why not', async () => {
  const good = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await good.captureMouseButton(), { ok: true, button: 4 })
  } finally {
    await good.dispose()
  }
  for (const [mode, failure] of [
    ['primary', 'primary-button'],
    ['timeout', 'timeout']
  ] as const) {
    const client = new DictationHelperClient(fakeHelper(mode), fast)
    try {
      assert.deepEqual(await client.captureMouseButton(), { ok: false, failure })
    } finally {
      await client.dispose()
    }
  }
})

test('permission requests go to the helper and report whether the grant already happened', async () => {
  const prompted = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.equal(await prompted.requestAccessibility(), false)
    assert.equal(await prompted.requestInputMonitoring(), false)
  } finally {
    await prompted.dispose()
  }
  const granted = new DictationHelperClient(fakeHelper('grant'), fast)
  try {
    assert.equal(await granted.requestAccessibility(), true)
    assert.equal(await granted.requestInputMonitoring(), true)
  } finally {
    await granted.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.equal(await missing.requestAccessibility(), null)
  assert.equal(await missing.requestInputMonitoring(), null)
})

test('the helper status carries Input Monitoring as three states', async () => {
  for (const [mode, expected] of [
    ['ok', 'granted'],
    ['not-asked', 'not-determined']
  ] as const) {
    const client = new DictationHelperClient(fakeHelper(mode), fast)
    try {
      assert.equal((await client.status())?.inputMonitoringAccess, expected)
    } finally {
      await client.dispose()
    }
  }
})

test('click events from the mouse trigger reach the listener, and the mode is sent with the button', async () => {
  const client = new DictationHelperClient(fakeHelper('clicks'), fast)
  let clicks = 0
  client.onClick(() => clicks++)
  try {
    assert.deepEqual(await client.setMouseButton(3, true, 'click'), { ok: true, swallowing: true })
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(clicks, 2)
  } finally {
    await client.dispose()
  }
})

test('the selection comes back as text, or as the reason it could not be read', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await client.selection('s-1'), { ok: true, text: 'picked words' })
  } finally {
    await client.dispose()
  }
  const secure = new DictationHelperClient(fakeHelper('secure'), fast)
  try {
    assert.deepEqual(await secure.selection('s-1'), { ok: false, reason: 'secure-field' })
  } finally {
    await secure.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.deepEqual(await missing.selection('s-1'), { ok: false, reason: 'unavailable' })
})

test('delivery guards travel with the request and a refusal says why', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    const stale = await client.deliver('s-1', 'new text', { expectSelection: 'stale' })
    assert.equal(stale.outcome, 'refused')
    assert.equal(stale.reason, 'selection-changed')
    const gone = await client.deliver('s-1', 'old text', { replace: 'gone' })
    assert.equal(gone.reason, 'text-changed')
    const fine = await client.deliver('s-1', 'text', { replace: 'present' })
    assert.equal(fine.outcome, 'delivered')
  } finally {
    await client.dispose()
  }
})

test('an app icon comes back as a PNG data URL, or null when it cannot be drawn', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.equal(
      await client.appIcon('/System/Applications/TextEdit.app'),
      'data:image/png;base64,QUJD'
    )
    assert.equal(await client.appIcon('/Applications/Missing.app'), null)
  } finally {
    await client.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.equal(await missing.appIcon('/System/Applications/TextEdit.app'), null)
})

test('a watched field reads back as text, or as the reason it cannot', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await client.watchRead('w'), {
      state: 'ok',
      value: 'typed words',
      focused: true
    })
    assert.deepEqual(await client.watchRead('gone'), { state: 'gone' })
    assert.deepEqual(await client.watchRead('secure'), { state: 'secure' })
    assert.deepEqual(await client.watchRead('odd'), { state: 'unreadable' })
    client.watchStop('w')
  } finally {
    await client.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.deepEqual(await missing.watchRead('w'), { state: 'unreadable' })
})

test('app names and icons are decoded, and an app that is not installed has neither', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  try {
    assert.deepEqual(await client.appInfo(['com.tinyspeck.slackmacgap', 'com.example.none']), [
      { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack', icon: 'data:image/png;base64,QUJD' },
      { bundleId: 'com.example.none', name: null, icon: null }
    ])
  } finally {
    await client.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.deepEqual(await missing.appInfo(['a']), [])
})

test('muting the output says whether it was this call that did it; restoring is always safe', async () => {
  const client = new DictationHelperClient(fakeHelper('ok'), fast)
  const quiet = new DictationHelperClient(fakeHelper('silent'), fast)
  try {
    assert.equal(await client.muteOutput(), true)
    await client.restoreOutput()
    assert.equal(await quiet.muteOutput(), false, 'already silent: nothing to give back')
  } finally {
    await client.dispose()
    await quiet.dispose()
  }
  const missing = new DictationHelperClient({ command: '/nonexistent/dictation-helper' }, fast)
  assert.equal(await missing.muteOutput(), false)
  await missing.restoreOutput()
})

test('native toggle event is delivered when armed and suppressed after disarming', async () => {
  const client = new DictationHelperClient(fakeHelper('toggle-events'), fast)
  let toggles = 0
  let heard: () => void = () => {}
  const event = new Promise<void>((resolve) => {
    heard = resolve
  })
  client.onKeyToggle(() => {
    toggles++
    heard()
  })
  try {
    assert.equal(await client.setToggleKey('AltRight'), null)
    await event
    assert.equal(toggles, 1)
    assert.equal(await client.setToggleKey('off'), null)
    await client.status()
    assert.equal(toggles, 1)
  } finally {
    await client.dispose()
  }
})

test('native toggle permission denial propagates without a registration claim', async () => {
  const client = new DictationHelperClient(fakeHelper('no-permission'), fast)
  try {
    assert.equal(await client.setToggleKey('AltRight'), 'input-monitoring-denied')
  } finally {
    await client.dispose()
  }
})
