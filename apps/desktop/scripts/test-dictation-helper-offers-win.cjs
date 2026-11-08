#!/usr/bin/env node
// Clipboard offers end to end, against the SHIPPED helper: the release build must dispatch clipboard-offers,
// clipboard-restore and clipboard-dismiss (round 12 compiled them out), and a kept record must round-trip
// through them. Kept records are made the way a crash makes them: the test-ops build (same sources, with
// test hooks) runs one clipboard transaction (the __clipboard-txn op) and is ended at a journaled stage.
// No window, no input: only the clipboard, through user32 (koffi). Run on Windows (CI):
//   node scripts/test-dictation-helper-offers-win.cjs <release dictation-helper.exe> <dictation-helper-testops.exe>
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const koffi = require('koffi')

const [release, testops] = process.argv.slice(2)
if (!release || !testops) {
  console.error('usage: test-dictation-helper-offers-win.cjs <release helper> <test-ops helper>')
  process.exit(2)
}
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
console.log(`# release helper ${release} sha256 ${sha(release)}`)
console.log(`# test-ops helper ${testops} sha256 ${sha(testops)}`)

// ---- the clipboard, as another app sees it ----
const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void* h)')
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()')
const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()')
const SetClipboardData = user32.func('void* __stdcall SetClipboardData(uint32 f, void* h)')
const GetClipboardData = user32.func('void* __stdcall GetClipboardData(uint32 f)')
const EnumClipboardFormats = user32.func('uint32 __stdcall EnumClipboardFormats(uint32 f)')
const RegisterClipboardFormatW = user32.func('uint32 __stdcall RegisterClipboardFormatW(str16 n)')
const GetClipboardFormatNameW = user32.func(
  'int __stdcall GetClipboardFormatNameW(uint32 f, _Out_ uint16_t *b, int n)'
)
const GetClipboardSequenceNumber = user32.func('uint32 __stdcall GetClipboardSequenceNumber()')
const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint32 f, uintptr n)')
const GlobalLock = kernel32.func('void* __stdcall GlobalLock(void* h)')
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void* h)')
const GlobalSize = kernel32.func('uintptr __stdcall GlobalSize(void* h)')
const RtlMoveMemory = kernel32.func(
  'void __stdcall RtlMoveMemory(void* dst, const uint8_t* src, uintptr n)'
)
const RtlCopyOut = kernel32.func(
  'void __stdcall RtlMoveMemory(_Out_ uint8_t* dst, void* src, uintptr n)'
)
const block = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function open() {
  for (let i = 0; i < 150; i++) {
    if (OpenClipboard(null)) return true
    block(20)
  }
  return false
}
function setBytes(format, bytes) {
  const g = GlobalAlloc(2, Math.max(1, bytes.length))
  const p = GlobalLock(g)
  RtlMoveMemory(p, bytes, bytes.length)
  GlobalUnlock(g)
  return SetClipboardData(format, g) !== null
}
function readBytes(format) {
  const h = GetClipboardData(format)
  if (!h) return null
  const size = Number(GlobalSize(h))
  const p = GlobalLock(h)
  if (!p) return null
  const out = Buffer.alloc(size)
  RtlCopyOut(out, p, size)
  GlobalUnlock(h)
  return out
}
const EXTRA = 'DoodleNote.CI.Extra'
function copyMulti(text) {
  if (!open()) throw new Error('the clipboard could not be opened')
  EmptyClipboard()
  setBytes(13, Buffer.from(text + '\0', 'utf16le'))
  setBytes(RegisterClipboardFormatW(EXTRA), Buffer.from('extra bytes for ' + text))
  CloseClipboard()
}
function addFormat() {
  if (!open()) throw new Error('the clipboard could not be opened')
  setBytes(RegisterClipboardFormatW('DoodleNote.CI.Added'), Buffer.from('added later'))
  CloseClipboard()
}
function names() {
  if (!open()) return '(not opened)'
  const out = []
  for (let f = EnumClipboardFormats(0); f !== 0; f = EnumClipboardFormats(f)) {
    if (f < 0xc000) {
      out.push(String(f))
      continue
    }
    const b = new Uint16Array(256)
    const n = GetClipboardFormatNameW(f, b, 256)
    out.push(Buffer.from(b.buffer).toString('utf16le', 0, n * 2))
  }
  CloseClipboard()
  return out.sort().join(' ')
}
function text() {
  if (!open()) return null
  const b = readBytes(13)
  CloseClipboard()
  return b ? b.toString('utf16le').replace(/\0.*$/s, '') : null
}
/** A clipboard manager that kept every format of an entry replays it: read all, empty, set all again. */
function replayAll() {
  if (!open()) throw new Error('the clipboard could not be opened')
  const items = []
  for (let f = EnumClipboardFormats(0); f !== 0; f = EnumClipboardFormats(f)) {
    if ([2, 3, 9, 14].includes(f)) continue // GDI handles
    const bytes = readBytes(f)
    if (bytes) items.push([f, bytes])
  }
  CloseClipboard()
  if (!open()) throw new Error('the clipboard could not be opened')
  EmptyClipboard()
  for (const [f, bytes] of items) setBytes(f, bytes)
  CloseClipboard()
  return items.length
}

/** Another process adds a format WITHOUT emptying and then keeps the clipboard open for ms (a monitor holding it). */
function holdAfterAdding(ms) {
  const code = `
const koffi = require(${JSON.stringify(require.resolve('koffi'))})
const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll')
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void* h)')
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()')
const SetClipboardData = user32.func('void* __stdcall SetClipboardData(uint32 f, void* h)')
const RegisterClipboardFormatW = user32.func('uint32 __stdcall RegisterClipboardFormatW(str16 n)')
const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint32 f, uintptr n)')
const GlobalLock = kernel32.func('void* __stdcall GlobalLock(void* h)')
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void* h)')
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void* dst, const uint8_t* src, uintptr n)')
const block = (t) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, t)
let opened = false
for (let i = 0; i < 150 && !(opened = OpenClipboard(null)); i++) block(20)
if (opened) {
  const bytes = Buffer.from('held')
  const g = GlobalAlloc(2, bytes.length); const p = GlobalLock(g); RtlMoveMemory(p, bytes, bytes.length); GlobalUnlock(g)
  SetClipboardData(RegisterClipboardFormatW('DoodleNote.CI.Held'), g)
  block(${ms})
  CloseClipboard()
}
`
  return spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
}
/** Another process opens the clipboard (no change), holds it ms, then adds a format and closes. */
function holdThenAdd(ms) {
  const code = `
const koffi = require(${JSON.stringify(require.resolve('koffi'))})
const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll')
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void* h)')
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()')
const SetClipboardData = user32.func('void* __stdcall SetClipboardData(uint32 f, void* h)')
const RegisterClipboardFormatW = user32.func('uint32 __stdcall RegisterClipboardFormatW(str16 n)')
const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint32 f, uintptr n)')
const GlobalLock = kernel32.func('void* __stdcall GlobalLock(void* h)')
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void* h)')
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void* dst, const uint8_t* src, uintptr n)')
const block = (t) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, t)
let opened = false
for (let i = 0; i < 150 && !(opened = OpenClipboard(null)); i++) block(20)
if (opened) {
  block(${ms})
  const bytes = Buffer.from('held')
  const g = GlobalAlloc(2, bytes.length); const p = GlobalLock(g); RtlMoveMemory(p, bytes, bytes.length); GlobalUnlock(g)
  SetClipboardData(RegisterClipboardFormatW('DoodleNote.CI.Held'), g)
  CloseClipboard()
}
`
  return spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
}
/** Another process holds a file open with no sharing for ms (as an AV scan or an indexer can). */
function lockFile(file, ms) {
  const script = `$f = [System.IO.File]::Open($env:DN_LOCK, 'Open', 'ReadWrite', 'None'); Start-Sleep -Milliseconds ${ms}; $f.Close()`
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    env: { ...process.env, DN_LOCK: file }
  })
}
const waitExit = (child) =>
  new Promise((r) => (child.exitCode !== null ? r() : child.on('exit', r)))

// ---- helpers ----
const identity = `qa.ci-offers-${crypto.randomBytes(4).toString('hex')}`
const recordPrefix = `DoodleNote-Bark-clipboard-${identity}-`
const recordFiles = () =>
  fs
    .readdirSync(os.tmpdir())
    // The exact prefix, then a 32-hex id: no pattern is built from the identity (nothing to escape).
    .filter(
      (f) =>
        f.startsWith(recordPrefix) &&
        /^[0-9a-f]{32}\.(bin|state)$/.test(f.slice(recordPrefix.length))
    )
const stages = () =>
  recordFiles()
    .filter((f) => f.endsWith('.state'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), 'utf8')).stage
      } catch {
        return '?'
      }
    })
function start(exe, env = {}) {
  const child = spawn(exe, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DICTATION_HELPER_IDENTITY: identity, ...env }
  })
  const events = []
  const logs = []
  const waiting = new Map()
  let buffer = ''
  let seq = 1
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => logs.push(...c.split('\n').filter((l) => l.trim())))
  child.stdout.on('data', (c) => {
    buffer += c
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const m = JSON.parse(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
      if (m.event === 'reply' && waiting.has(m.id)) {
        waiting.get(m.id)(m)
        waiting.delete(m.id)
      } else events.push(m)
    }
  })
  const req = (op, fields = {}, ms = 30000) => {
    const id = 'r' + seq++
    child.stdin.write(JSON.stringify({ op, id, ...fields }) + '\n')
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), ms)
      waiting.set(id, (m) => {
        clearTimeout(t)
        resolve(m)
      })
    })
  }
  const ready = new Promise((resolve) => {
    const t = setInterval(() => {
      if (events.some((e) => e.event === 'ready')) {
        clearInterval(t)
        resolve(true)
      }
    }, 20)
    setTimeout(() => {
      clearInterval(t)
      resolve(false)
    }, 15000)
  })
  return {
    child,
    events,
    logs,
    req,
    ready,
    kill: async () => {
      child.kill()
      await sleep(500)
    },
    stop: async () => {
      child.stdin.end()
      await new Promise((r) => {
        child.on('exit', r)
        setTimeout(r, 8000)
      })
    }
  }
}
async function waitStage(name) {
  for (let i = 0; i < 200 && !stages().includes(name); i++) await sleep(50)
  return stages().includes(name)
}
/** A kept, not provably ours record: the test-ops transaction ended inside its put-back. */
async function keptRecord(dictated) {
  const h = start(testops, {
    DICTATION_HELPER_TEST: '1',
    DICTATION_HELPER_TEST_PUTBACK_STALL_AFTER: '1',
    DICTATION_HELPER_TEST_PUTBACK_STALL_MS: '15000'
  })
  await h.ready
  void h.req('__clipboard-txn', { text: dictated, holdMs: 200 })
  const reached = await waitStage('restore-emptied')
  await sleep(600)
  await h.kill()
  return reached
}

/**
 * The user's Restore as the app does it: with the offered sequence; if the clipboard changed since the offer
 * (also by our own later transactions), the card shows "changed" and the user confirms with the new sequence.
 */
async function restoreConfirming(h, offer) {
  const first = await h.req('clipboard-restore', { record: offer.record, sequence: offer.sequence })
  if (!first || first.result !== 'changed') return first
  return h.req('clipboard-restore', { record: offer.record, sequence: first.sequence })
}

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok' : 'not ok'} - ${name}${ok || !detail ? '' : ` (${detail})`}`)
}
const cleanup = () => {
  for (const f of recordFiles()) fs.rmSync(path.join(os.tmpdir(), f), { force: true })
}

async function main() {
  if (!open()) {
    check('the clipboard can be opened on this machine', false)
    process.exit(1)
  }
  CloseClipboard()
  const user = 'the user own clipboard ' + identity
  copyMulti(user)
  const userFormats = names()

  // 1. The release helper dispatches the production offer ops (round 12 answered unknown-op).
  {
    const h = start(release)
    check('the release helper starts', await h.ready)
    const offers = await h.req('clipboard-offers')
    check(
      'release: clipboard-offers answers ok with a list',
      !!offers && offers.ok === true && Array.isArray(offers.offers),
      JSON.stringify(offers)
    )
    const restore = await h.req('clipboard-restore', { record: '0'.repeat(32), sequence: 1 })
    check(
      'release: clipboard-restore answers (no such offer: gone)',
      !!restore && restore.ok === true && restore.result === 'gone',
      JSON.stringify(restore)
    )
    const dismiss = await h.req('clipboard-dismiss', { record: 'not-a-record' })
    check(
      'release: clipboard-dismiss answers with a real result (not a record: false)',
      !!dismiss && dismiss.ok === true && dismiss.dismissed === false,
      JSON.stringify(dismiss)
    )
    await h.stop()
  }

  // 2. A kept record round-trips through the RELEASE helper: offered, "changed" after a small copy, restored.
  {
    check(
      'a kept record is made (test-ops transaction ended inside its put-back)',
      await keptRecord('dictated text one')
    )
    const partial = names()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers && listed.offers[0]
    check(
      'release: the kept record is offered (formats and size only)',
      !!offer &&
        listed.offers.length === 1 &&
        Object.keys(offer).sort().join() ===
          'bytes,created,delivery,formats,likelyOurs,record,sequence',
      JSON.stringify(listed)
    )
    check(
      'release: nothing was written on its own',
      names() === partial,
      `${names()} vs ${partial}`
    )
    addFormat()
    const first = offer
      ? await h.req('clipboard-restore', { record: offer.record, sequence: offer.sequence })
      : null
    check(
      'release: a small change after the offer answers "changed" (formats, size, new sequence)',
      !!first &&
        first.result === 'changed' &&
        typeof first.formats === 'number' &&
        typeof first.sequence === 'number',
      JSON.stringify(first)
    )
    const second = first
      ? await h.req('clipboard-restore', { record: offer.record, sequence: first.sequence })
      : null
    check(
      'release: confirmed with the new sequence, it is restored',
      !!second && second.result === 'restored',
      JSON.stringify(second)
    )
    check(
      'release: the user clipboard is back and the record is gone',
      names() === userFormats && recordFiles().length === 0,
      `${names()}; ${recordFiles()}`
    )
    await h.stop()
  }

  // 3. Dismiss on the RELEASE helper deletes the record (the real deletion result).
  {
    copyMulti(user)
    await keptRecord('dictated text two')
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers && listed.offers[0]
    const dismissed = offer ? await h.req('clipboard-dismiss', { record: offer.record }) : null
    check(
      'release: Dismiss deletes the record and says so',
      !!dismissed && dismissed.dismissed === true && recordFiles().length === 0,
      JSON.stringify(dismissed)
    )
    check(
      'release: the offer-gone event went out',
      h.events.some((e) => e.phase === 'offer-gone')
    )
    await h.stop()
  }

  // 4. Pending, then another delivery: our own later transaction never deletes the older backup.
  {
    copyMulti(user)
    await keptRecord('dictated text A')
    const b = start(testops, { DICTATION_HELPER_TEST: '1' })
    await b.ready
    const txn = await b.req('__clipboard-txn', { text: 'dictated text B', holdMs: 200 })
    await b.stop()
    check(
      'another delivery ran to the end',
      !!txn && /^restored\|/.test(String(txn.result)),
      JSON.stringify(txn)
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'the older backup is still offered after another delivery (not deleted)',
      !!listed && listed.offers.length === 1,
      JSON.stringify(listed)
    )
    const offer = listed && listed.offers[0]
    const restored = offer ? await restoreConfirming(h, offer) : null
    check(
      'and restoring it gives back the user clipboard',
      !!restored && restored.result === 'restored' && names() === userFormats,
      `${JSON.stringify(restored)}; ${names()}`
    )
    await h.stop()
  }

  // 5. Two kept records: restoring one never deletes the other.
  {
    copyMulti(user)
    await keptRecord('dictated text C')
    // A second private format, so the second transaction saves more than what its cut-short put-back leaves
    // (a record whose saved content is already back on the clipboard is dropped as untouched, correctly).
    addFormat()
    await keptRecord('dictated text D')
    const h = start(release)
    await h.ready
    let listed = await h.req('clipboard-offers')
    check(
      'two kept records are both offered',
      !!listed && listed.offers.length === 2,
      JSON.stringify(listed)
    )
    const newest =
      listed &&
      [...listed.offers].sort((x, y) => String(y.created).localeCompare(String(x.created)))[0]
    const one = newest ? await restoreConfirming(h, newest) : null
    listed = await h.req('clipboard-offers')
    check(
      'restoring one keeps the other offered',
      !!one && one.result === 'restored' && !!listed && listed.offers.length === 1,
      `${JSON.stringify(one)}; ${JSON.stringify(listed)}`
    )
    const other = listed && listed.offers[0]
    const two = other ? await restoreConfirming(h, other) : null
    check(
      'restoring the other gives back the user clipboard',
      !!two && two.result === 'restored' && names() === userFormats,
      `${JSON.stringify(two)}; ${names()}`
    )
    await h.stop()
  }

  // 6. A clipboard manager replays every format of our write (sentinel too) after a crash: offered, not restored.
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text E', holdMs: 8000 })
    for (let i = 0; i < 200 && text() !== 'dictated text E'; i++) await sleep(50)
    await sleep(300)
    await a.kill()
    const replayed = replayAll()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'a replay of every format after the crash is offered, not restored on its own',
      replayed > 0 && !!listed && listed.offers.length === 1 && text() === 'dictated text E',
      `${replayed}; ${JSON.stringify(listed)}; ${text()}`
    )
    const offer = listed && listed.offers[0]
    const restored = offer
      ? await h.req('clipboard-restore', { record: offer.record, sequence: offer.sequence })
      : null
    check(
      'the user Restore of it gives back the user clipboard',
      !!restored && restored.result === 'restored' && names() === userFormats,
      `${JSON.stringify(restored)}; ${names()}`
    )
    await h.stop()
  }

  // 8. A crash after journaling "restoring" but before its empty, then a replay of every format: offered. A restore
  // that was only about to run establishes no continuity (Beyond counts only operations performed).
  {
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_RESTORE_STALL_BEFORE_EMPTY_MS: '15000'
    })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text G', holdMs: 200 })
    const reached = await waitStage('restoring')
    await sleep(500)
    await a.kill()
    const replayed = replayAll()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'crash before the restore empties, then a full replay: offered, not restored on its own',
      reached &&
        replayed > 0 &&
        !!listed &&
        listed.offers.length === 1 &&
        text() === 'dictated text G',
      `${reached}; ${JSON.stringify(listed)}; ${text()}`
    )
    const offer = listed && listed.offers[0]
    const restored = offer ? await restoreConfirming(h, offer) : null
    check(
      'and the user Restore of it gives back the user clipboard',
      !!restored && restored.result === 'restored' && names() === userFormats,
      `${JSON.stringify(restored)}; ${names()}`
    )
    await h.stop()
  }

  // 9. Right before Ctrl+V the clipboard moved under our ownership and cannot be opened (another app holds it):
  // no proof either way, so nothing is settled; the record is kept and offered (never "user-changed").
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text H', holdMs: 2500 })
    for (let i = 0; i < 200 && text() !== 'dictated text H'; i++) await sleep(50)
    const holder = holdAfterAdding(4000)
    const result = await reply
    await waitExit(holder)
    await a.stop()
    check(
      'an uninspectable clipboard keeps the record (not user-changed)',
      !!result &&
        /^uninspectable\/unrestored\|/.test(String(result.result)) &&
        recordFiles().length === 2,
      `${JSON.stringify(result)}; ${recordFiles()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'and it is offered, not restored over the added format',
      !!listed && listed.offers.length === 1 && names().includes('DoodleNote.CI.Held'),
      `${JSON.stringify(listed)}; ${names()}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 10. Our window still owns the clipboard, but an app added a format without emptying AFTER our write's
  // confirmation: kept as an offer.
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I', holdMs: 2500 })
    for (let i = 0; i < 200 && text() !== 'dictated text I'; i++) await sleep(50)
    // After our write's confirmation (it re-reads the clipboard right after the write): the change comes later.
    await sleep(700)
    addFormat()
    const result = await reply
    await a.stop()
    check(
      'owned but changed: kept, not user-changed',
      !!result &&
        /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
        recordFiles().length === 2,
      `${JSON.stringify(result)}; ${recordFiles()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'and it is offered, not restored over the added format',
      !!listed && listed.offers.length === 1 && names().includes('DoodleNote.CI.Added'),
      `${JSON.stringify(listed)}; ${names()}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 10b. B1 regression, the ORIGINAL timing of the first round-14 CI run (no delay: the addition lands while the
  // write is being confirmed or right after). Whichever comes first, the product must keep the record and the
  // addition (round 14's run 42505251118 reproduced the defect: restored, no record, the addition gone).
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I2', holdMs: 2500 })
    for (let i = 0; i < 200 && text() !== 'dictated text I2'; i++) await sleep(50)
    addFormat()
    const result = await reply
    await a.stop()
    check(
      'B1 regression (original timing): an addition next to our write is never adopted: kept, the addition stays',
      !!result &&
        /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
        recordFiles().length === 2 &&
        names().includes('DoodleNote.CI.Added'),
      `${JSON.stringify(result)}; ${recordFiles()}; ${names()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 10c. Another process copies over our write (the owner changes) right before the keys: their content is left
  // alone, and the user's saved clipboard is kept as an offer, never deleted on that guess.
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I3', holdMs: 2500 })
    for (let i = 0; i < 200 && text() !== 'dictated text I3'; i++) await sleep(50)
    await sleep(700)
    copyMulti('a copy by another app')
    const theirs = names()
    const result = await reply
    await a.stop()
    check(
      'an owner change keeps the saved clipboard as an offer (user-changed, record kept, their copy untouched)',
      !!result &&
        /^user-changed\|/.test(String(result.result)) &&
        recordFiles().length === 2 &&
        names() === theirs,
      `${JSON.stringify(result)}; ${recordFiles()}; ${names()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check('and it is offered', !!listed && listed.offers.length === 1, JSON.stringify(listed))
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 11. The same addition BEFORE our write's confirmation (the confirmation is held open by a test hook, so the
  // order is fixed, not timed): the confirmation must not adopt it. Kept as an offer, the addition stays.
  {
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_CONFIRM_DELAY_MS: '2500'
    })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text J', holdMs: 300 })
    for (let i = 0; i < 200 && text() !== 'dictated text J'; i++) await sleep(50)
    addFormat() // inside the confirmation's delay
    const result = await reply
    await a.stop()
    check(
      'an addition before the confirmation is not adopted: kept, not restored',
      !!result &&
        /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
        recordFiles().length === 2 &&
        names().includes('DoodleNote.CI.Added'),
      `${JSON.stringify(result)}; ${recordFiles()}; ${names()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'and it is offered by the release helper',
      !!listed && listed.offers.length === 1,
      JSON.stringify(listed)
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 12. After the paste, the restore finds the clipboard busy (another app holds it open, sequence unchanged), and
  // that app then adds a format while our window still owns the clipboard: the retry must not restore on
  // ownership alone. Offered, the addition stays.
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text K', holdMs: 2500 })
    for (let i = 0; i < 200 && text() !== 'dictated text K'; i++) await sleep(50)
    await sleep(1500)
    const holder = holdThenAdd(1800) // opens now, holds through the restore attempt, then adds and closes
    const result = await reply
    await waitExit(holder)
    await sleep(4500) // the helper's own retry (3 s) runs on the changed clipboard
    const kept = recordFiles().length
    await a.stop()
    check(
      'a busy restore keeps the record (unrestored)',
      !!result && /^unrestored\|/.test(String(result.result)),
      JSON.stringify(result)
    )
    check(
      'and the retry does not restore on ownership alone (record kept, addition there)',
      kept === 2 && names().includes('DoodleNote.CI.Held'),
      `${kept}; ${names()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check('and it is offered', !!listed && listed.offers.length === 1, JSON.stringify(listed))
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 13. Dismiss while a record file is held by another process (its .state.tmp locked): failure is reported and
  // the record stays whole; once released, Dismiss deletes it.
  {
    copyMulti(user)
    await keptRecord('dictated text L')
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    let first = null
    let second = null
    if (offer) {
      const tmp = path.join(os.tmpdir(), `${recordPrefix}${offer.record}.state.tmp`)
      fs.writeFileSync(tmp, '{}')
      const lock = lockFile(tmp, 4000)
      await sleep(800)
      first = await h.req('clipboard-dismiss', { record: offer.record })
      const whole = recordFiles().length
      await waitExit(lock)
      second = await h.req('clipboard-dismiss', { record: offer.record })
      check(
        'Dismiss with a locked record file reports failure and the record stays whole',
        !!first && first.dismissed === false && whole === 2,
        `${JSON.stringify(first)}; ${whole}`
      )
    }
    check(
      'once released, Dismiss deletes every file',
      !!second &&
        second.dismissed === true &&
        recordFiles().length === 0 &&
        !fs.existsSync(path.join(os.tmpdir(), `${recordPrefix}${offer && offer.record}.state.tmp`)),
      `${JSON.stringify(second)}; ${recordFiles()}`
    )
    await h.stop()
  }

  // 7. Our complete write, unchanged since: the release helper restores it on its own at start (proof a).
  {
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text F', holdMs: 8000 })
    for (let i = 0; i < 200 && text() !== 'dictated text F'; i++) await sleep(50)
    await sleep(300)
    await a.kill()
    const h = start(release)
    await h.ready
    await sleep(1500)
    const listed = await h.req('clipboard-offers')
    check(
      'our own complete write is put back on its own (no offer)',
      names() === userFormats &&
        !!listed &&
        listed.offers.length === 0 &&
        recordFiles().length === 0,
      `${names()}; ${JSON.stringify(listed)}`
    )
    await h.stop()
  }
}

main()
  .catch((error) => {
    console.error(error)
    results.push(false)
  })
  .finally(() => {
    cleanup()
    const failed = results.filter((ok) => !ok).length
    console.log(`# ${results.length - failed}/${results.length} passed`)
    process.exit(failed === 0 && results.length > 0 ? 0 : 1)
  })
