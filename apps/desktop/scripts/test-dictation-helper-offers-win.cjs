#!/usr/bin/env node
// Clipboard offers end to end, against the SHIPPED helper: the release build must dispatch clipboard-offers,
// clipboard-restore and clipboard-dismiss (round 12 compiled them out), and a kept record must round-trip
// through them. Kept records are made the way a crash makes them: the test-ops build (same sources, with
// test hooks) runs one clipboard transaction (the __clipboard-txn op) and is ended at a journaled stage.
// No window, no input: only the clipboard, through user32 (koffi). Round 30: every case starts from a verified clean
// state, acts on what the helper says it reached (test-build trace lines and gates, holders and file locks that signal
// when they hold), never on a timed guess, and a failed check prints its case's helper logs and every record file.
// Run on Windows (CI):
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
const CountClipboardFormats = user32.func('int __stdcall CountClipboardFormats()')
const IsClipboardFormatAvailable = user32.func(
  'bool __stdcall IsClipboardFormatAvailable(uint32 f)'
)
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()')
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
let lastOpenError = 0
// Round 21: this process's READS open the clipboard with a window of its own too. CI 34 showed that a NULL-window
// open is taken over by another process's OpenClipboard(NULL) (the poller in 33b did exactly that to the read-back).
// It never empties the clipboard with it, so it never becomes the owner (no message can wait on this thread).
let readWindow = null
function open() {
  if (!readWindow)
    readWindow = CreateWindowExW(
      0,
      'STATIC',
      'DoodleNote CI reads',
      0,
      0,
      0,
      0,
      0,
      null,
      null,
      null,
      null
    )
  // Round 23 (Astra S4): never a NULL-window open by this process either: a failed window is a failed open.
  if (!readWindow) {
    lastOpenError = GetLastError()
    return false
  }
  for (let i = 0; i < 150; i++) {
    if (OpenClipboard(readWindow)) return true
    lastOpenError = GetLastError()
    block(20)
  }
  return false
}
let lastSetError = 0
function setBytes(format, bytes) {
  const g = GlobalAlloc(2, Math.max(1, bytes.length))
  const p = GlobalLock(g)
  RtlMoveMemory(p, bytes, bytes.length)
  GlobalUnlock(g)
  const ok = SetClipboardData(format, g) !== null
  if (!ok) lastSetError = GetLastError()
  return ok
}
const CreateWindowExW = user32.func(
  'void* __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void* parent, void* menu, void* inst, void* param)'
)
const DestroyWindow = user32.func('bool __stdcall DestroyWindow(void* h)')
const seeds = { ok: 0, failed: 0 }
/**
 * Round 20: every save line of a test-ops helper, tallied per case group. A save established on attempt 1 is counted;
 * every other line (a retry, a not-established verdict, a no-save) is kept VERBATIM for the report.
 */
function tallySaves(group, logs) {
  const t = (saveTally[group] = saveTally[group] || {
    saves: 0,
    firstTry: 0,
    retried: 0,
    noSave: 0,
    lines: []
  })
  const finish = (attempts, established) => {
    t.saves++
    if (established && attempts.length === 1) return t.firstTry++
    if (established) t.retried++
    else t.noSave++
    for (const a of attempts) t.lines.push(a.replace(/^.*?saving the clipboard /, ''))
  }
  let attempts = []
  for (const l of logs) {
    const m = /saving the clipboard \(attempt (\d+)\)/.exec(l)
    if (!m) continue
    if (m[1] === '1' && attempts.length) finish(attempts, false)
    if (m[1] === '1') attempts = []
    attempts.push(l)
    if (/: ESTABLISHED/.test(l)) {
      finish(attempts, true)
      attempts = []
    }
  }
  if (attempts.length) finish(attempts, false)
}
const saveTally = {}
/**
 * Round 19 (Opus's lead on 25(a)): the clipboard is SEEDED with a real owner window (OpenClipboard(NULL) +
 * EmptyClipboard leaves no owner, and Microsoft documents that SetClipboardData then fails), every SetClipboardData
 * result is checked, and the seed is read back (content, under one open) before any helper is driven. The window is
 * destroyed right after (a live owner on this thread, which pumps no messages, would stall other apps' EmptyClipboard).
 * A failed seed is its own failed check ("seed failed"), never a product failure. Returns true when the seed holds.
 */
function seed(where, items) {
  const owner = CreateWindowExW(
    0,
    'STATIC',
    'DoodleNote CI seed',
    0,
    0,
    0,
    0,
    0,
    null,
    null,
    null,
    null
  )
  let problem = owner ? null : `CreateWindowExW failed (error ${GetLastError()})`
  if (!problem) {
    let opened = false
    for (let i = 0; i < 150 && !(opened = OpenClipboard(owner)); i++) {
      lastOpenError = GetLastError()
      block(20)
    }
    if (!opened) problem = `OpenClipboard failed (error ${lastOpenError})`
    else {
      if (!EmptyClipboard()) problem = `EmptyClipboard failed (error ${GetLastError()})`
      for (const [format, bytes] of items)
        if (!problem && !setBytes(format, bytes))
          problem = `SetClipboardData(${format}, ${bytes.length} bytes) failed (error ${lastSetError})`
      if (!CloseClipboard()) problem = problem || `CloseClipboard failed (error ${GetLastError()})`
    }
    DestroyWindow(owner)
  }
  if (!problem) {
    if (!open()) problem = `read-back open failed (error ${lastOpenError})`
    else {
      for (const [format, bytes] of items) {
        const back = readBytes(format)
        if (
          !problem &&
          !(back && back.length >= bytes.length && back.subarray(0, bytes.length).equals(bytes))
        )
          problem = `read back: format ${format} is ${back ? back.length + ' bytes, different' : 'absent'}`
      }
      // An empty seed is checked too (round 21): no format counted, and an enumeration that ends with ERROR_SUCCESS.
      if (!problem && items.length === 0) {
        const counted = CountClipboardFormats()
        const firstFormat = EnumClipboardFormats(0)
        const error = GetLastError()
        if (counted !== 0 || firstFormat !== 0 || error !== 0)
          problem = `the empty seed is not empty: counted ${counted}, first format ${firstFormat}, error ${error}`
      }
      CloseClipboard()
    }
  }
  if (problem) {
    seeds.failed++
    check(`seed failed (${where})`, false, problem)
    return false
  }
  seeds.ok++
  return true
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
/**
 * Round 22 (S8): what a save of the clipboard as it is now must hold, read by THIS process (every format in the
 * enumeration order, GDI-handle formats aside, each by GlobalSize): "count|id:length,...|bytes", the __save-only shape.
 */
function seededShape() {
  if (!open()) return null
  const parts = []
  let bytes = 0
  for (let f = EnumClipboardFormats(0); f !== 0; f = EnumClipboardFormats(f)) {
    if ([2, 3, 9, 14].includes(f)) continue
    const h = GetClipboardData(f)
    const size = h ? Number(GlobalSize(h)) : -1
    parts.push(`${f}:${size}`)
    bytes += size
  }
  CloseClipboard()
  return `${parts.length}|${parts.join(',')}|${bytes}`
}
function copyMulti(text) {
  return seed('the user copy', [
    [13, Buffer.from(text + '\0', 'utf16le')],
    [RegisterClipboardFormatW(EXTRA), Buffer.from('extra bytes for ' + text)]
  ])
}
/** Another app rewrites ONE format of what is on the clipboard (without emptying), `times` times. */
function replaceFormat(format, bytes, times = 1) {
  for (let i = 0; i < times; i++) {
    if (!open()) throw new Error('the clipboard could not be opened')
    if (!setBytes(format, bytes))
      check(
        `the other app's replacement of format ${format} was set`,
        false,
        `error ${lastSetError}`
      )
    CloseClipboard()
  }
}
/** One format's bytes as another app reads them (null when absent). */
function readFormat(format) {
  if (!open()) return null
  const b = readBytes(format)
  CloseClipboard()
  return b
}
function addFormat() {
  if (!open()) throw new Error('the clipboard could not be opened')
  if (!setBytes(RegisterClipboardFormatW('DoodleNote.CI.Added'), Buffer.from('added later')))
    check("the other app's added format was set", false, `error ${lastSetError}`)
  CloseClipboard()
}
function names() {
  if (!open()) return `(not opened: error ${lastOpenError})`
  const out = []
  let f = EnumClipboardFormats(0)
  for (; f !== 0; f = EnumClipboardFormats(f)) {
    if (f < 0xc000) {
      out.push(String(f))
      continue
    }
    const b = new Uint16Array(256)
    const n = GetClipboardFormatNameW(f, b, 256)
    out.push(Buffer.from(b.buffer).toString('utf16le', 0, n * 2))
  }
  // EnumClipboardFormats returns 0 both at the end and on failure: tell them apart (round 19).
  const error = GetLastError()
  const count = CountClipboardFormats()
  CloseClipboard()
  if (error !== 0 || count !== out.length)
    return `(enumeration failed: error ${error}, ${count} formats counted, ${out.length} listed: ${out.sort().join(' ')})`
  return out.sort().join(' ')
}
/** One open: the formats, the user's text and custom bytes (content, not names), the sequence and the count. */
function observe() {
  const seen = {
    opened: open(),
    openError: lastOpenError,
    sequence: GetClipboardSequenceNumber(),
    count: CountClipboardFormats()
  }
  if (!seen.opened) return seen
  const listed = []
  for (let f = EnumClipboardFormats(0); f !== 0; f = EnumClipboardFormats(f)) listed.push(f)
  seen.enumError = GetLastError()
  seen.formats = listed.length
  const t = readBytes(13)
  seen.text = t ? t.toString('utf16le').replace(/\0.*$/s, '') : null
  const e = readBytes(RegisterClipboardFormatW(EXTRA))
  seen.extra = e ? e.toString() : null
  CloseClipboard()
  return seen
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
  seed('the clipboard manager replay', items)
  return items.length
}

// ---- round 30: every process this harness starts, the case frame, and what a failed check prints ----
// CI run 42842819157 (attempt 1) failed 11 checks that the log could not explain: no helper log, no record listing, and
// waits that guessed how long the helper needed. Now: every child is tracked; every case starts from a verified clean
// state (every earlier process exited, no record file left) and waits for what the helper REACHED (its own lines, the
// record files, a signal from a holder), with a deadline; a failed check prints the case's helper logs and every file.
const spawned = []
const tracked = (child, label) => {
  spawned.push({ child, label })
  return child
}
const alive = (child) => child.exitCode === null && child.signalCode === null
const running = () => spawned.filter((s) => alive(s.child))
const until = async (predicate, ms = 15000, step = 25) => {
  const end = Date.now() + ms
  for (;;) {
    if (predicate()) return true
    if (Date.now() >= end) return false
    await sleep(step)
  }
}
const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-ci-gates-'))
let gateFolders = 0
let helperCount = 0
let frame = { label: '(before the first case)', helpers: [] }
const dirtyAfter = []
let casesBegun = 0
/** Every file of this run's identity in %TEMP% (any suffix: .bin, .state and their .tmp). */
const prefixFiles = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(recordPrefix))
const listing = () =>
  prefixFiles()
    .map((f) => {
      const full = path.join(os.tmpdir(), f)
      let facts = ''
      try {
        const st = fs.statSync(full)
        facts = `${st.size} bytes, written ${(Date.now() - st.mtimeMs) | 0} ms ago`
        if (f.endsWith('.state')) {
          const state = JSON.parse(fs.readFileSync(full, 'utf8'))
          facts += `, stage ${state.stage}, offerOnly ${state.offerOnly}, session ${state.session}`
        }
      } catch (error) {
        facts += ` (${error.code || error.message})`
      }
      return `${f.slice(recordPrefix.length)} [${facts}]`
    })
    .join('; ') || '(none)'
/**
 * What a failed check prints. Round 31: incremental, on EVERY failure: the record files, and for each helper of the case
 * what was not printed before (new log lines and events; a helper started since the last dump in full), so a later
 * product failure is never hidden behind an earlier precondition's dump.
 */
function diagnose(name) {
  console.log(`# --- diagnostics for "${name}" (case ${frame.label}) ---`)
  console.log(`# record files now: ${listing()}`)
  for (const h of frame.helpers) {
    const state = alive(h.child)
      ? 'running'
      : `exited (code ${h.child.exitCode}, signal ${h.child.signalCode})`
    const fresh = h.logs.slice(h.shownLogs)
    const freshEvents = h.events.slice(h.shownEvents)
    console.log(
      `# helper ${h.n} ${h.kind}${h.hooks ? ` [${h.hooks}]` : ''} pid ${h.child.pid}, ${state}: ${h.logs.length} log line(s), ${fresh.length} not printed before; ${h.events.length} event(s), ${freshEvents.length} new`
    )
    const lines =
      fresh.length > 90
        ? [...fresh.slice(0, 30), `(${fresh.length - 90} lines omitted)`, ...fresh.slice(-60)]
        : fresh
    for (const l of lines) console.log(`#   | ${l}`)
    for (const e of freshEvents.slice(-12)) console.log(`#   event ${JSON.stringify(e)}`)
    h.shownLogs = h.logs.length
    h.shownEvents = h.events.length
  }
}
/** Every tracked child terminated and its exit OBSERVED (round 31: also on the exception path). */
async function terminateAll(ms = 15000) {
  for (const s of running()) s.child.kill()
  return until(() => running().length === 0, ms, 50)
}
/** Every file of the identity removed, then verified gone (a file another process still holds may need a moment). */
async function removeAll(ms = 10000) {
  return until(
    () => {
      for (const f of prefixFiles()) {
        try {
          fs.rmSync(path.join(os.tmpdir(), f), { force: true })
        } catch {
          // retried until the deadline
        }
      }
      return prefixFiles().length === 0
    },
    ms,
    100
  )
}
/**
 * A case begins: everything the cases before it started has exited (within 20 s), and no file of this identity is
 * left. Anything else is a failed check of THE CASE BEFORE (its logs and the files printed), then cleared so one
 * leftover can never fail the cases after it (run 42842819157: one stray .state.tmp failed five later checks).
 */
async function begin(label) {
  const before = frame.label
  await until(() => running().length === 0, 20000, 50)
  const still = running()
  const left = prefixFiles()
  if (still.length || left.length) {
    dirtyAfter.push(before)
    check(
      `the case before "${label}" (${before}) ended clean: every process it started exited, no record file left`,
      false,
      `still running: ${still.map((s) => `${s.label} pid ${s.child.pid}`).join(', ') || 'none'}; files: ${listing()}`
    )
    // Round 31: termination OBSERVED, then the files enumerated AFTER it (a process ended just now may have written
    // one), removed, and both postconditions verified; if they cannot be established the run stops here.
    const ended = await terminateAll()
    const removed = ended && (await removeAll())
    if (!ended || !removed || running().length || prefixFiles().length)
      throw new Error(
        `a clean state could not be established before "${label}": still running ${
          running()
            .map((s) => `${s.label} pid ${s.child.pid}`)
            .join(', ') || 'none'
        }; files ${listing()}`
      )
  }
  casesBegun++
  frame = { label, helpers: [] }
}
/** A precondition the case needs: reached within its deadline, or a failed check that says which (with diagnostics). */
async function reach(what, predicate, ms = 15000) {
  const ok = await until(predicate, ms)
  if (!ok) check(`${frame.label}: reached ${what}`, false, `not within ${ms} ms`)
  return ok
}

/**
 * Another process adds a format WITHOUT emptying and then keeps the clipboard open (a monitor holding it) until it is
 * told to close. Round 30: it SAYS when it holds (no timed guess) and closes on request.
 */
function holdAfterAdding() {
  return holder(true)
}
/** Another process opens the clipboard (no change) and holds it until told; it then adds a format and closes. */
function holdThenAdd() {
  return holder(false)
}
function holder(addFirst) {
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
// Round 22 (Opus): this process opens with a window of its own too (a NULL-window open can be taken over).
const CreateWindowExW = user32.func('void* __stdcall CreateWindowExW(uint32 ex, str16 cls, str16 name, uint32 style, int x, int y, int w, int h, void* parent, void* menu, void* inst, void* param)')
const own = CreateWindowExW(0, 'STATIC', 'DoodleNote CI holder', 0, 0, 0, 0, 0, null, null, null, null)
if (!own) { console.log('the holder window could not be created'); process.exit(3) } // round 23: never a NULL open
const add = () => {
  const bytes = Buffer.from('held')
  const g = GlobalAlloc(2, bytes.length); const p = GlobalLock(g); RtlMoveMemory(p, bytes, bytes.length); GlobalUnlock(g)
  return SetClipboardData(RegisterClipboardFormatW('DoodleNote.CI.Held'), g) !== null
}
let opened = false
for (let i = 0; i < 150 && !(opened = OpenClipboard(own)); i++) block(20)
if (!opened) { console.log('not opened'); process.exit(4) }
const added = ${addFirst ? 'add()' : 'true'}
console.log(added ? 'held' : 'held, but the format was not added')
process.stdin.once('data', () => {
  const late = ${addFirst ? 'true' : 'add()'}
  CloseClipboard()
  console.log(late ? 'closed' : 'closed, but the format was not added')
  process.exit(0)
})
`
  const child = tracked(
    spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'ignore'] }),
    'a clipboard holder'
  )
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c) => (out += c))
  return {
    child,
    /** True once it holds the clipboard (with its format added first, for holdAfterAdding). */
    held: until(() => /^held$/m.test(out) || !alive(child), 20000).then(() => /^held$/m.test(out)),
    /** Close it (adding its format first, for holdThenAdd), and wait for its exit. */
    release: async () => {
      if (alive(child)) child.stdin.write('go\n')
      await waitExit(child)
      return /^closed$/m.test(out)
    },
    output: () => out.trim()
  }
}
/**
 * Another process holds a file open (as an AV scan or an indexer can): by default with no sharing; `share: 'read'`
 * lets others read it (not delete it). Round 30: through CreateFileW in a child that SAYS when it holds the handle
 * (run 42842819157: the PowerShell lock was not up after a fixed 900 ms), released on request.
 */
function lockFile(file, { share = 'none' } = {}) {
  const code = `
const koffi = require(${JSON.stringify(require.resolve('koffi'))})
const kernel32 = koffi.load('kernel32.dll')
const CreateFileW = kernel32.func('intptr __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void* sa, uint32 disposition, uint32 flags, void* template)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr h)')
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()')
const h = CreateFileW(process.env.DN_LOCK, ${share === 'read' ? '0x80000000' : '0xC0000000'}, ${share === 'read' ? 1 : 0}, null, 3, 0x80, null)
if (Number(h) === -1 || Number(h) === 0) { console.log('lock failed: error ' + GetLastError()); process.exit(3) }
console.log('locked')
process.stdin.once('data', () => { CloseHandle(h); console.log('released'); process.exit(0) })
`
  const child = tracked(
    spawn(process.execPath, ['-e', code], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, DN_LOCK: file }
    }),
    `a file lock on ${path.basename(file).slice(recordPrefix.length)}`
  )
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c) => (out += c))
  return {
    child,
    locked: until(() => /^locked$/m.test(out) || !alive(child), 20000).then(() =>
      /^locked$/m.test(out)
    ),
    release: async () => {
      if (alive(child)) child.stdin.write('go\n')
      await waitExit(child)
    },
    output: () => out.trim()
  }
}
const waitExit = (child) => new Promise((r) => (!alive(child) ? r() : child.once('exit', r)))

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
const recordIds = () => [
  ...new Set(recordFiles().map((f) => f.slice(recordPrefix.length, recordPrefix.length + 32)))
]
/** The journaled stage of ONE record (round 30: never "some record's", see keptRecord). */
const stageOf = (id) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `${recordPrefix}${id}.state`), 'utf8'))
      .stage
  } catch {
    return null
  }
}
/**
 * A helper process. Round 30: a test-ops helper gets a write budget of 60 s unless the case asks for the real one
 * (`realBudget`): only the late-path cases are about the budget, and they force it (gates), so no other case's outcome
 * depends on how fast the runner is (attempt 1 of run 42842819157: a write past 1 s turned two cases into the late
 * path). `gates` enables named gates (TestMode.Gate): h.open(name) lets the helper pass the next one.
 */
function start(exe, env = {}, { gates = [], realBudget = false } = {}) {
  const extra = {}
  if (exe === testops && !realBudget && env.DICTATION_HELPER_TEST_WRITE_BUDGET_MS === undefined)
    extra.DICTATION_HELPER_TEST_WRITE_BUDGET_MS = '60000'
  let gateDir = null
  if (gates.length) {
    gateDir = path.join(gateRoot, String(++gateFolders))
    fs.mkdirSync(gateDir)
    extra.DICTATION_HELPER_TEST_GATE_DIR = gateDir
    extra.DICTATION_HELPER_TEST_GATES = gates.join(',')
  }
  const child = spawn(exe, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DICTATION_HELPER_IDENTITY: identity, ...env, ...extra }
  })
  const kind = exe === testops ? 'test-ops' : 'release'
  tracked(child, `${kind} helper ${helperCount + 1}`)
  const events = []
  const logs = []
  const waiting = new Map()
  let buffer = ''
  let errBuffer = ''
  let seq = 1
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => {
    errBuffer += c
    const lines = errBuffer.split('\n')
    errBuffer = lines.pop()
    logs.push(...lines.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()))
  })
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
  const ready = until(
    () => events.some((e) => e.event === 'ready') || !alive(child),
    15000,
    20
  ).then(() => events.some((e) => e.event === 'ready'))
  const uses = {}
  const open = (name) => {
    if (!gateDir) throw new Error(`no gates on this helper (${name})`)
    uses[name] = (uses[name] || 0) + 1
    fs.writeFileSync(path.join(gateDir, `${name}-${uses[name]}`), '')
  }
  /** Every gate passable from here on (a helper that is stopped never waits at one). */
  const openAll = () => {
    if (!gateDir) return
    for (const name of gates)
      for (let n = (uses[name] || 0) + 1; n <= (uses[name] || 0) + 50; n++)
        fs.writeFileSync(path.join(gateDir, `${name}-${n}`), '')
  }
  const h = {
    n: ++helperCount,
    kind,
    shownLogs: 0,
    shownEvents: 0,
    hooks: [
      ...Object.entries(env)
        .filter(([k]) => k !== 'DICTATION_HELPER_TEST')
        .map(([k, v]) => `${k.replace(/^DICTATION_HELPER_TEST_/, '')}=${v}`),
      ...(gates.length ? [`gates ${gates.join(',')}`] : []),
      ...(extra.DICTATION_HELPER_TEST_WRITE_BUDGET_MS ? ['write budget 60 s'] : [])
    ].join(', '),
    child,
    events,
    logs,
    req,
    ready,
    open,
    /**
     * The first log line from index `since` on that matches, within the deadline (null if none: the helper never got
     * there, or exited first). Test-ops lines "test-trace: ..." mark where it is (TestMode.Trace, Stall, Gate).
     */
    waitLog: async (re, { since = 0, ms = 20000 } = {}) => {
      const find = () => logs.slice(since).find((l) => re.test(l))
      await until(() => !!find() || !alive(child), ms)
      return find() || null
    },
    waitEvent: async (predicate, ms = 20000) => {
      await until(() => events.some(predicate) || !alive(child), ms)
      return events.find(predicate) || null
    },
    // Killed and its exit OBSERVED (round 19): a restarted helper never runs beside it.
    // Never opens a gate first: a crash case kills it exactly where it waits.
    kill: async () => {
      child.kill()
      const exited = await until(() => !alive(child), 10000)
      if (!exited) console.log(`# helper ${h.n} did not exit within 10 s of its kill`)
      return exited
    },
    stop: async () => {
      openAll()
      child.stdin.end()
      const exited = await until(() => !alive(child), 20000)
      if (!exited) console.log(`# helper ${h.n} did not exit within 20 s of its input closing`)
      return exited
    }
  }
  frame.helpers.push(h)
  return h
}
/** Round 30: the helper reached a point (its line, within the deadline), or a failed check says it did not. */
async function atLine(h, what, re, opts = {}) {
  const line = await h.waitLog(re, opts)
  if (!line)
    check(
      `${frame.label}: reached ${what}`,
      false,
      `no line matching ${re} within ${opts.ms || 20000} ms`
    )
  return line
}
const HOLDING = /test-trace: txn holding \S+ confirmed=True rejected=False/
const PAYLOAD = /the saved clipboard was written down \(/
/**
 * A kept, not provably ours record: the test-ops transaction is killed inside its put-back (after the first format
 * set back). Round 30: it waits for THIS helper's own stall line and its payload being on disk, and returns the id of
 * the record it made (null, with a failed check, if it did not get there). Until round 29 it waited for ANY record's
 * "restore-emptied" stage: in case 5 the first record already had it, so the second helper was killed after 600 ms
 * wherever it was (attempt 1 of run 42842819157: inside its first state write, a lone .state.tmp left).
 */
async function keptRecord(dictated) {
  const before = new Set(recordIds())
  const h = start(testops, {
    DICTATION_HELPER_TEST: '1',
    DICTATION_HELPER_TEST_PUTBACK_STALL_AFTER: '1',
    DICTATION_HELPER_TEST_PUTBACK_STALL_MS: '60000'
  })
  await h.ready
  const reply = h.req('__clipboard-txn', { text: dictated, holdMs: 200 })
  const stalled = await h.waitLog(/test-trace: stall PUTBACK_STALL_MS/)
  const payload = await h.waitLog(
    /the saved clipboard was written down|could not be written down|was not published/
  )
  const exited = await h.kill()
  const made = recordIds().filter((id) => !before.has(id))
  const id = made.length === 1 ? made[0] : null
  const ok =
    !!stalled &&
    !!payload &&
    /written down \(/.test(payload) &&
    exited &&
    !!id &&
    stageOf(id) === 'restore-emptied' &&
    fs.existsSync(path.join(os.tmpdir(), `${recordPrefix}${id}.bin`))
  if (!ok)
    check(
      `${frame.label}: a kept record was made (killed inside its put-back, its payload on disk)`,
      false,
      `stall line ${!!stalled}; payload ${payload}; exited ${exited}; new records ${made}; stage ${id && stageOf(id)}; reply so far ${JSON.stringify(
        await Promise.race([reply, sleep(0).then(() => '(none)')])
      )}`
    )
  return ok ? id : null
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
  // Round 30: a failed check prints what the helpers of its case said and every file of this identity.
  if (!ok) diagnose(name)
}
/** Only at the very end (round 30: never between cases, where begin() verifies instead of clearing silently). */
const cleanup = () => {
  for (const f of prefixFiles()) fs.rmSync(path.join(os.tmpdir(), f), { force: true })
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
    await begin('1')
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
    await begin('2')
    check(
      'a kept record is made (test-ops transaction ended inside its put-back)',
      !!(await keptRecord('dictated text one'))
    )
    const partial = names()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers && listed.offers[0]
    check(
      'release: the kept record is offered (formats and size only; round 22: whether it is incomplete, and the names of what is missing; round 24: how many formats hold user content)',
      !!offer &&
        listed.offers.length === 1 &&
        Object.keys(offer).sort().join() ===
          'bytes,content,created,delivery,formats,incomplete,likelyOurs,missing,record,sequence' &&
        offer.content === 4 &&
        offer.incomplete === false &&
        offer.missing.length === 0,
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
    await begin('3')
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
    await begin('4')
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
    await begin('5')
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
    await begin('6')
    copyMulti(user)
    // Round 30: killed once its write is confirmed and held (the HOLD gate is the "paste" window) and its payload is
    // on disk; until round 29 it waited up to 10 s for our text to show and never checked it did (attempt 1 of run
    // 42842819157: it never showed, and the case went on over the user's own clipboard).
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text E' })
    await atLine(a, 'our write confirmed and held', HOLDING)
    await atLine(a, 'the payload on disk', PAYLOAD)
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
    await begin('8')
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_RESTORE_STALL_BEFORE_EMPTY_MS: '60000'
    })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text G', holdMs: 200 })
    const reached = !!(await atLine(
      a,
      'the restore stalled before its empty',
      /test-trace: stall RESTORE_STALL_BEFORE_EMPTY_MS/
    ))
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
    await begin('9')
    copyMulti(user)
    // Round 30: the holder adds and holds BEFORE the restore runs (HOLD gate), and closes only after its result.
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text H' })
    await atLine(a, 'our write confirmed and held', HOLDING)
    const holder = holdAfterAdding()
    if (!(await holder.held))
      check(`${frame.label}: reached the holder holding the clipboard`, false, holder.output())
    a.open('HOLD')
    const result = await reply
    await holder.release()
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
    await begin('10')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I' })
    // After our write's confirmation (round 30: its own line, not 700 ms): the change comes later.
    await atLine(a, 'our write confirmed and held', HOLDING)
    addFormat()
    a.open('HOLD')
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
    await begin('10b')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I2', holdMs: 2500 })
    // The race is the point of this case (no gate); that our text reached the clipboard is checked (round 30).
    await reach('our text on the clipboard', () => text() === 'dictated text I2')
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
    await begin('10c')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text I3' })
    await atLine(a, 'our write confirmed and held', HOLDING)
    copyMulti('a copy by another app')
    const theirs = names()
    a.open('HOLD')
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

  // 11. The same addition BEFORE our write's confirmation (round 30: the confirmation waits at its gate until the
  // addition is made, so the order is fixed, not timed): the confirmation must not adopt it. Kept as an offer, the
  // addition stays. (The same addition on the late path: case 41.)
  {
    await begin('11')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['CONFIRM'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text J', holdMs: 300 })
    await atLine(a, 'the confirmation at its gate', /test-trace: gate CONFIRM#1 waiting/)
    addFormat() // before the confirmation
    a.open('CONFIRM')
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
    await begin('12')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD', 'RETRY'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text K' })
    await atLine(a, 'our write confirmed and held', HOLDING)
    // Round 30: the holder holds BEFORE the restore runs and through its result, then adds and closes. Round 31: the
    // helper's own retry waits at its gate, opened only once the holder has added its format and its exit is observed,
    // so the retry runs after the addition by construction (no comparison of two output streams).
    const holder = holdThenAdd()
    if (!(await holder.held))
      check(`${frame.label}: reached the holder holding the clipboard`, false, holder.output())
    a.open('HOLD')
    const result = await reply
    if (!(await holder.release()))
      check(
        `${frame.label}: reached the holder adding its format and closing`,
        false,
        holder.output()
      )
    a.open('RETRY')
    await atLine(a, 'its own retry, after the addition', /clipboard record \w+ \(retry\)/)
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

  // 13. Dismiss while ONE record file is held by another process (each of the four in turn): failure is reported and
  // the record stays whole (nothing deleted); once released, Dismiss deletes every file.
  for (const suffix of ['.state', '.state.tmp', '.bin', '.bin.tmp']) {
    await begin(`13 ${suffix}`)
    copyMulti(user)
    await keptRecord('dictated text L' + suffix)
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    let first = null
    let second = null
    let whole = -1
    if (offer) {
      const base = path.join(os.tmpdir(), `${recordPrefix}${offer.record}`)
      if (suffix.endsWith('.tmp')) fs.writeFileSync(base + suffix, '{}')
      // Round 30: Dismiss only once the other process SAYS it holds the file (attempt 1 of run 42842819157: the lock
      // was not up after a fixed 900 ms, and Dismiss deleted the record), released on request.
      const lock = lockFile(base + suffix)
      if (!(await lock.locked))
        check(`${frame.label}: reached the lock held by another process`, false, lock.output())
      first = await h.req('clipboard-dismiss', { record: offer.record })
      whole = recordFiles().length
      await lock.release()
      second = await h.req('clipboard-dismiss', { record: offer.record })
    }
    check(
      `Dismiss with ${suffix} locked reports failure and deletes nothing`,
      !!first && first.dismissed === false && whole === 2,
      `${JSON.stringify(first)}; ${whole}`
    )
    check(
      `once ${suffix} is released, Dismiss deletes every file`,
      !!second &&
        second.dismissed === true &&
        recordFiles().length === 0 &&
        prefixFiles().length === 0,
      `${JSON.stringify(second)}; ${listing()}`
    )
    await h.stop()
  }

  // 13b. The deletion is one step: every file is marked for deletion on a handle opened without sharing, and only
  // the close removes them. When the SECOND mark fails (test hook), the first is cleared again: nothing deleted,
  // both files byte-identical, Dismiss reports it; the release helper then deletes both.
  {
    await begin('13b')
    copyMulti(user)
    await keptRecord('dictated text L2')
    const snapshot = () =>
      recordFiles()
        .map((f) => f + ':' + fs.readFileSync(path.join(os.tmpdir(), f)).toString('hex'))
        .join('|')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_FAIL_DELETE_MARK: '2'
    })
    await a.ready
    const listed = await a.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const before = snapshot() // after the listing (an offer records its first offer in the state file)
    const first = offer ? await a.req('clipboard-dismiss', { record: offer.record }) : null
    await a.stop()
    const after = snapshot()
    check(
      'a deletion whose second mark fails deletes nothing (the first mark is undone)',
      !!first && first.dismissed === false && recordFiles().length === 2 && after === before,
      `${JSON.stringify(first)}; ${recordFiles()}`
    )
    const h = start(release)
    await h.ready
    const again = await h.req('clipboard-offers')
    const o2 = again && again.offers[0]
    const second = o2 ? await h.req('clipboard-dismiss', { record: o2.record }) : null
    check(
      'and the release helper then deletes both files',
      !!second && second.dismissed === true && recordFiles().length === 0,
      `${JSON.stringify(second)}; ${recordFiles()}`
    )
    await h.stop()
  }

  // 14. A payload left complete under its temporary name (a crash between the writer's write and its move): adopted
  // and offered, never deleted as missing.
  {
    await begin('14')
    copyMulti(user)
    await keptRecord('dictated text M')
    const bin = recordFiles().find((f) => f.endsWith('.bin'))
    if (bin) fs.renameSync(path.join(os.tmpdir(), bin), path.join(os.tmpdir(), bin + '.tmp'))
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'a complete .bin.tmp is adopted and offered',
      !!bin && !!listed && listed.offers.length === 1 && recordFiles().length === 2,
      `${JSON.stringify(listed)}; ${recordFiles()}`
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

  // 15. P1-A: another app replaces ONE text form of our write (CF_TEXT, CF_OEMTEXT or CF_LOCALE) without emptying,
  // keeping our Unicode text, markers and sentinel (the owner stays our window); before our write's confirmation
  // (held open by a test hook, so the order is fixed) and between the confirmation and the paste gate. Every case:
  // not our write any more, kept and offered, their bytes stay, nothing pasted or restored over them.
  for (const [format, name, bytes] of [
    [1, 'CF_TEXT', Buffer.from('replaced ANSI\0', 'latin1')],
    [7, 'CF_OEMTEXT', Buffer.from('replaced OEM\0', 'latin1')],
    [16, 'CF_LOCALE', Buffer.from([0x07, 0x04, 0x00, 0x00])]
  ]) {
    for (const when of ['before the confirmation', 'after the confirmation']) {
      await begin(`15 ${name} ${when}`)
      copyMulti(user)
      const before = when.startsWith('before')
      // Round 30: before = at the confirmation's gate; after = once the confirmation passed (its line), the hold
      // gate open only after the change. (Round 29's attempt-1 run of this case took the late path: case 41.)
      const gate = before ? 'CONFIRM' : 'HOLD'
      const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: [gate] })
      await a.ready
      const dictated = `dictated text N ${name} ${when}`
      const reply = a.req('__clipboard-txn', { text: dictated, holdMs: 300 })
      if (before)
        await atLine(a, 'the confirmation at its gate', /test-trace: gate CONFIRM#1 waiting/)
      else await atLine(a, 'our write confirmed and held', HOLDING)
      replaceFormat(format, bytes)
      a.open(gate)
      const result = await reply
      await a.stop()
      const kept = recordFiles().length
      const theirs = readFormat(format)
      check(
        `${name} replaced ${when}: kept, not restored over`,
        !!result &&
          /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
          kept === 2 &&
          !!theirs &&
          theirs.equals(bytes),
        `${JSON.stringify(result)}; ${kept}; ${theirs && theirs.toString('hex')}`
      )
      const h = start(release)
      await h.ready
      const listed = await h.req('clipboard-offers')
      check(
        `${name} replaced ${when}: offered`,
        !!listed && listed.offers.length === 1,
        JSON.stringify(listed)
      )
      const offer = listed && listed.offers[0]
      if (offer) await h.req('clipboard-dismiss', { record: offer.record })
      await h.stop()
    }
  }

  // 16. Astra P1-A: the confirmation rejects our write because the sequence moved too far (another app rewrote our
  // ANSI form with the SAME bytes, eight times, while the confirmation was held open: beyond Windows' close moves and
  // the three forms it synthesizes, which the bound allows since round 17 as in round 15). Content alone would look
  // like ours; the rejection is final: the later look before the keys must not upgrade it. Kept, and OFFERED after a
  // restart (asserted since round 17).
  {
    await begin('16')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['CONFIRM'] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text O', holdMs: 300 })
    await atLine(a, 'the confirmation at its gate', /test-trace: gate CONFIRM#1 waiting/)
    replaceFormat(1, Buffer.from('dictated text O\0', 'latin1'), 8)
    a.open('CONFIRM')
    const result = await reply
    await a.stop()
    check(
      'a confirmation rejected for the sequence stays rejected (owned-but-changed, kept)',
      !!result &&
        /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
        recordFiles().length === 2,
      `${JSON.stringify(result)}; ${recordFiles()}`
    )
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'and after a restart it is offered, not restored (release helper)',
      !!listed && listed.offers.length === 1 && text() === 'dictated text O',
      `${JSON.stringify(listed)}; ${text()}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 17. A state file that does not parse (zeroed, as after a crash mid-write on some file systems) next to a whole
  // payload: the record is rebuilt (no stage authority) and OFFERED, never deleted; Restore gives the user's back.
  {
    await begin('17')
    copyMulti(user)
    await keptRecord('dictated text P')
    const st = recordFiles().find((f) => f.endsWith('.state'))
    if (st) {
      const full = path.join(os.tmpdir(), st)
      fs.writeFileSync(full, Buffer.alloc(fs.statSync(full).size))
    }
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'a zeroed state file with a whole payload is offered, not deleted',
      !!st && !!listed && listed.offers.length === 1 && recordFiles().length === 2,
      `${JSON.stringify(listed)}; ${recordFiles()}`
    )
    const offer = listed && listed.offers[0]
    const restored = offer ? await restoreConfirming(h, offer) : null
    check(
      'and its Restore gives back the user clipboard',
      !!restored &&
        restored.result === 'restored' &&
        names() === userFormats &&
        recordFiles().length === 0,
      `${JSON.stringify(restored)}; ${names()}; ${recordFiles()}`
    )
    await h.stop()
  }

  // 18. Another session's record (same user, shared %TEMP%): not offered here, and Dismiss with its id refuses it
  // (nothing deleted); back in this session it is offered and Dismiss deletes it.
  {
    await begin('18')
    copyMulti(user)
    await keptRecord('dictated text Q')
    const st = recordFiles().find((f) => f.endsWith('.state'))
    const full = st ? path.join(os.tmpdir(), st) : ''
    const original = st ? fs.readFileSync(full, 'utf8') : ''
    const record = st ? st.slice(recordPrefix.length, -'.state'.length) : ''
    const session = st ? JSON.parse(original).session : -1
    if (st)
      fs.writeFileSync(full, JSON.stringify({ ...JSON.parse(original), session: session + 7 }))
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const refused = st ? await h.req('clipboard-dismiss', { record }) : null
    check(
      "another session's record is not offered and Dismiss refuses it",
      !!st &&
        !!listed &&
        listed.offers.length === 0 &&
        !!refused &&
        refused.dismissed === false &&
        recordFiles().length === 2,
      `${JSON.stringify(listed)}; ${JSON.stringify(refused)}; ${recordFiles()}`
    )
    await h.stop()
    if (st) fs.writeFileSync(full, original)
    const h2 = start(release)
    await h2.ready
    const again = await h2.req('clipboard-offers')
    const o2 = again && again.offers[0]
    const gone = o2 ? await h2.req('clipboard-dismiss', { record: o2.record }) : null
    check(
      'back in its own session it is offered and dismissed',
      !!o2 &&
        o2.record === record &&
        !!gone &&
        gone.dismissed === true &&
        recordFiles().length === 0,
      `${JSON.stringify(again)}; ${JSON.stringify(gone)}; ${recordFiles()}`
    )
    await h2.stop()
  }

  // 19. Round 17 P1-1: a read in the confirmation fails once (test hook): rejected. The retry in the same helper
  // (its timer, 3 s) and a restarted release helper then find our complete write within the bound: neither may
  // restore on its own (the rejection is persisted as offer-only); the record is offered.
  {
    await begin('19')
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_CONFIRM_READ_NULL: '1'
    })
    await a.ready
    const result = await a.req('__clipboard-txn', { text: 'dictated text R', holdMs: 300 })
    // Round 30: its own first retry, by its line (not 5 s).
    await atLine(a, 'its own first retry', /clipboard record \w+ \(retry\)/)
    const st = recordFiles().find((f) => f.endsWith('.state'))
    const offerOnly = st
      ? JSON.parse(fs.readFileSync(path.join(os.tmpdir(), st), 'utf8')).offerOnly
      : null
    check(
      'a confirmation read that fails once: rejected, persisted offer-only, and the retry did not restore',
      !!result &&
        /^owned-but-changed\/unrestored\|/.test(String(result.result)) &&
        offerOnly === true &&
        text() === 'dictated text R' &&
        recordFiles().length === 2,
      `${JSON.stringify(result)}; offerOnly ${offerOnly}; ${text()}; ${recordFiles()}; ${a.logs
        .filter((l) => /record|confirmation/.test(l))
        .slice(-6)
        .join(' / ')}`
    )
    await a.stop()
    // Round 30: no timed wait after ready: the start-up check of every record runs before the helper says ready
    // (Program.cs), and the listing runs its own.
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'and a restarted release helper offers it, never restores it on its own',
      !!listed && listed.offers.length === 1 && text() === 'dictated text R',
      `${JSON.stringify(listed)}; ${text()}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 20. Round 17 P2-4: a payload adopted from .bin.tmp next to a same-logon "emptied" (clipboard empty at the journaled
  // sequence) or "written" (our complete write unchanged) state: offered, never restored on its own. ROUND 18 (owner
  // decision, no authority from disk): the former controls without the rename, restored on their own until round 17,
  // are now offered too, the clipboard untouched (sequence unchanged).
  for (const stage of ['emptied', 'written']) {
    for (const rename of [false, true]) {
      await begin(`20 ${stage} ${rename}`)
      copyMulti(user)
      const env =
        stage === 'emptied'
          ? { DICTATION_HELPER_TEST: '1', DICTATION_HELPER_TEST_STALL_AFTER_EMPTY_MS: '60000' }
          : { DICTATION_HELPER_TEST: '1' }
      const a = start(testops, env, { gates: stage === 'emptied' ? [] : ['HOLD'] })
      await a.ready
      const dictated = `dictated text S ${stage} ${rename}`
      void a.req('__clipboard-txn', { text: dictated })
      // Round 30: killed where it says it is (and with its payload on disk), not after timed waits.
      if (stage === 'emptied')
        await atLine(
          a,
          'the write stalled with the clipboard emptied',
          /test-trace: stall STALL_AFTER_EMPTY_MS/
        )
      else await atLine(a, 'our write confirmed and held', HOLDING)
      await atLine(a, 'the payload on disk', PAYLOAD)
      await a.kill()
      const bin = recordFiles().find((f) => f.endsWith('.bin'))
      if (rename && bin)
        fs.renameSync(path.join(os.tmpdir(), bin), path.join(os.tmpdir(), bin + '.tmp'))
      const before = names()
      const sequence = GetClipboardSequenceNumber()
      const h = start(release)
      await h.ready
      const listed = await h.req('clipboard-offers')
      check(
        rename
          ? `adopted next to "${stage}": offered, not restored on its own`
          : `"${stage}" without the rename (round 17: restored on its own): offered, the clipboard untouched`,
        !!bin &&
          !!listed &&
          listed.offers.length === 1 &&
          names() === before &&
          names() !== userFormats &&
          GetClipboardSequenceNumber() === sequence,
        `${JSON.stringify(listed)}; ${before} -> ${names()}; sequence ${sequence} -> ${GetClipboardSequenceNumber()}`
      )
      const offer = listed && listed.offers[0]
      if (offer) await h.req('clipboard-dismiss', { record: offer.record })
      await h.stop()
    }
  }

  // 21. Round 17 P2-3: the text forms the helper expects are Windows' own synthesis, compared byte for byte with what
  // Windows makes of the same Unicode text under the same CF_LOCALE (non-ASCII, best-fit, unmappable, a surrogate
  // pair; a Western, a Cyrillic, a Polish and a Japanese locale), not with the helper's own encoder.
  {
    await begin('21')
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const samples = ['Жж café €', 'āćęłóśźż', '中文 あ', '😀 x', 'Grüße – “q”']
    for (const locale of [0x0409, 0x0419, 0x0415, 0x0411]) {
      const bad = []
      for (const sample of samples) {
        const lcid = Buffer.alloc(4)
        lcid.writeUInt32LE(locale)
        seed('the text-form sample', [
          [13, Buffer.from(sample + '\0', 'utf16le')],
          [16, lcid]
        ])
        const cstr = (b) =>
          b ? b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString('hex') : null
        const windowsAnsi = cstr(readFormat(1))
        const windowsOem = cstr(readFormat(7))
        const ours = await a.req('__text-forms', { text: sample, locale })
        if (!ours || ours.ansi !== windowsAnsi || ours.oem !== windowsOem)
          bad.push(
            `${JSON.stringify(sample)}: windows ${windowsAnsi}/${windowsOem}, helper ${ours && ours.ansi}/${ours && ours.oem} (cp ${ours && ours.ansiCodePage}/${ours && ours.oemCodePage})`
          )
      }
      check(
        `text forms equal Windows' own synthesis under locale 0x${locale.toString(16)}`,
        bad.length === 0,
        bad.join('; ')
      )
    }
    // Unicode only (as our write): the CF_LOCALE Windows chooses is the input language the helper states.
    seed('a Unicode-only copy', [[13, Buffer.from('x\0', 'utf16le')]])
    const chosen = readFormat(16)
    const forms = await a.req('__text-forms', { text: 'x', locale: 0 })
    check(
      'Windows states the input language the helper expects (CF_LOCALE of a Unicode-only write)',
      !!chosen && !!forms && chosen.readUInt32LE(0) === forms.inputLocale,
      `${chosen && chosen.readUInt32LE(0)} vs ${forms && forms.inputLocale}`
    )
    await a.stop()
  }

  // 22. Non-ASCII dictation end to end on the write path: our write is recognized (no false rejection), the read-back
  // route inside our own open is reported, and a passive reader in another process after the confirmation leaves the
  // sequence unchanged (the confirmation materialized the forms), so the paste gate still sees our write.
  {
    await begin('22')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    const dictated = 'Grüße Ж 中 😀 café'
    const reply = a.req('__clipboard-txn', { text: dictated })
    await atLine(a, 'our write confirmed and held', HOLDING)
    const before = GetClipboardSequenceNumber()
    const ansi = readFormat(1)
    const oem = readFormat(7)
    const after = GetClipboardSequenceNumber()
    a.open('HOLD')
    const result = await reply
    const route = await a.req('__text-forms', { text: dictated, locale: 0 })
    console.log(`# input locale 0x${route && route.inputLocale.toString(16)}`)
    check(
      'a passive reader of CF_TEXT/CF_OEMTEXT after the confirmation leaves the sequence unchanged',
      !!ansi && !!oem && before === after,
      `${before} -> ${after}`
    )
    check(
      'non-ASCII dictation: our write is recognized and restored (no false rejection)',
      !!result && /^restored\|/.test(String(result.result)) && names() === userFormats,
      `${JSON.stringify(result)}; ${names()}; ${a.logs
        .filter((l) => /confirmation|offer/.test(l))
        .slice(-4)
        .join(' / ')}`
    )
    await a.stop()
  }

  // 23. Invalid states next to a valid payload (round 17 P1-2: `{}` used to delete both files as "nothing had been
  // emptied"): rebuilt offer-only with an unknown identity and offered by the release helper, never deleted. A
  // payload with NO state at all stays an orphan (case 24).
  for (const [label, body] of [
    ['{}', () => '{}'],
    [
      'a missing stage',
      (st) => JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'stage')))
    ],
    [
      'an identity of the wrong type',
      (st) => JSON.stringify({ ...st, session: String(st.session) })
    ],
    ['an unknown stage', (st) => JSON.stringify({ ...st, stage: 'restored-ish' })],
    ['extra junk', (st) => JSON.stringify({ ...st, junk: [1, 2] })]
  ]) {
    await begin(`23 ${label}`)
    copyMulti(user)
    await keptRecord('dictated text T ' + label)
    const st = recordFiles().find((f) => f.endsWith('.state'))
    const full = st ? path.join(os.tmpdir(), st) : ''
    if (st) fs.writeFileSync(full, body(JSON.parse(fs.readFileSync(full, 'utf8'))))
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    let rebuilt = null
    try {
      rebuilt = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch {}
    check(
      `an invalid state (${label}) next to a valid payload: rebuilt offer-only (unknown identity) and offered, not deleted`,
      !!listed &&
        listed.offers.length === 1 &&
        recordFiles().length === 2 &&
        !!rebuilt &&
        rebuilt.offerOnly === true &&
        rebuilt.session === -1 &&
        rebuilt.stage === 'unknown',
      `${JSON.stringify(listed)}; ${recordFiles()}; ${JSON.stringify(rebuilt)}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 13c. A mark fails AND clearing the marks already set fails (test hooks): the deletion is completed instead and
  // reported truthfully (Dismiss true, nothing left), never "kept whole".
  {
    await begin('13c')
    copyMulti(user)
    await keptRecord('dictated text L3')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_FAIL_DELETE_MARK: '2',
      DICTATION_HELPER_TEST_FAIL_DELETE_UNMARK: '1'
    })
    await a.ready
    const listed = await a.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const gone = offer ? await a.req('clipboard-dismiss', { record: offer.record }) : null
    await a.stop()
    check(
      'a mark that cannot be cleared completes the deletion, reported as deleted',
      !!gone && gone.dismissed === true && recordFiles().length === 0,
      `${JSON.stringify(gone)}; ${recordFiles()}`
    )
  }

  // 24. The helper is killed between two deletion marks (after the state's, before the payload's): the state is gone
  // at the termination and the payload is left WITHOUT a state: not offered (never "offered again after Dismiss"),
  // and swept as an orphan once older than 10 minutes.
  {
    await begin('24')
    copyMulti(user)
    await keptRecord('dictated text U')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_DELETE_STALL_AFTER_MARK: '1'
    })
    await a.ready
    const listed = await a.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    if (offer) void a.req('clipboard-dismiss', { record: offer.record })
    await atLine(
      a,
      'the deletion stalled between its marks',
      /test-trace: stall DELETE_STALL_AFTER_MARK/
    )
    await a.kill()
    const left = recordFiles()
    const h = start(release)
    await h.ready
    const again = await h.req('clipboard-offers')
    check(
      'killed between the marks: the state is gone, the payload is left and never offered',
      !!offer &&
        left.length === 1 &&
        left[0].endsWith('.bin') &&
        !!again &&
        again.offers.length === 0 &&
        recordFiles().length === 1,
      `${left}; ${JSON.stringify(again)}; ${recordFiles()}`
    )
    for (const f of recordFiles()) {
      const old = new Date(Date.now() - 60 * 60 * 1000)
      fs.utimesSync(path.join(os.tmpdir(), f), old, old)
    }
    await h.req('clipboard-offers')
    check(
      'and the orphaned payload is swept once older than 10 minutes',
      recordFiles().length === 0,
      `${recordFiles()}`
    )
    await h.stop()
  }

  // 7 / 25. ROUND 18 (owner decision): a helper killed mid-transaction never has its clipboard written by a restarted
  // helper; the saved clipboard is OFFERED. 7 (round 17: "our own complete write is put back on its own") is (a) below.
  // (a) killed after our write, before the paste; (b) after the paste, before the restore; (c) inside the restore,
  // after its EmptyClipboard. A restarted RELEASE helper offers each and leaves the clipboard sequence unchanged.
  // Round 30: each is killed where its own line says it is (and with its payload on disk), never after a timed wait.
  for (const [label, env, wait] of [
    ['(a) after the write, before the paste (round 17 case 7: restored on its own)', {}, HOLDING],
    [
      '(b) after the paste, before the restore',
      { DICTATION_HELPER_TEST_STALL_BEFORE_RESTORE_MS: '60000' },
      /test-trace: stall STALL_BEFORE_RESTORE_MS/
    ],
    [
      '(c) inside the restore, after its EmptyClipboard',
      { DICTATION_HELPER_TEST_RESTORE_STALL_MS: '60000' },
      /test-trace: stall RESTORE_STALL_MS/
    ],
    // (a) 25 more times (round 19): one CI run (42662110137) saw the user's Restore reply "restored" and then a format
    // enumeration with no entries. Diagnosed, not guarded: content checked under one open, the helper's put-back
    // trace and the record directory printed on any failure.
    ...Array.from({ length: 25 }, (_, n) => [
      `(a) after the write, before the paste, repeat ${n + 1}`,
      {},
      HOLDING
    ])
  ]) {
    await begin(`25 ${label.replace(/^(\(.\)).*?(, repeat \d+)?$/, '$1$2')}`)
    const seeded = copyMulti(user)
    const a = start(
      testops,
      { DICTATION_HELPER_TEST: '1', ...env },
      {
        gates: label.startsWith('(a)') ? ['HOLD'] : []
      }
    )
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text F', holdMs: 300 })
    await atLine(a, label.startsWith('(a)') ? 'our write confirmed and held' : 'its stall', wait)
    await atLine(a, 'the payload on disk', PAYLOAD)
    const exited = await a.kill()
    const before = names()
    const sequence = GetClipboardSequenceNumber()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      `killed ${label}: a restarted release helper offers it and never writes the clipboard`,
      exited &&
        !!listed &&
        listed.offers.length === 1 &&
        names() === before &&
        names() !== userFormats &&
        GetClipboardSequenceNumber() === sequence,
      `${JSON.stringify(listed)}; ${before} -> ${names()}; sequence ${sequence} -> ${GetClipboardSequenceNumber()}`
    )
    const offer = listed && listed.offers[0]
    const restored = offer ? await restoreConfirming(h, offer) : null
    const after = observe()
    const ok =
      seeded &&
      !!restored &&
      restored.result === 'restored' &&
      after.opened &&
      after.text === user &&
      after.extra === 'extra bytes for ' + user &&
      recordFiles().length === 0
    check(
      `and the user's Restore of it gives back the user clipboard (${label.replace(/^(\(.\)).*?(, repeat \d+)?$/, '$1$2')})`,
      ok,
      `${JSON.stringify(restored)}; observed ${JSON.stringify({ ...after, text: after.text === user ? '(the user text)' : after.text, extra: after.extra === 'extra bytes for ' + user ? '(the user bytes)' : after.extra })}; records [${prefixFiles()}]; release log: ${h.logs
        .filter((l) => /put-back trace|restore|record/.test(l))
        .slice(-12)
        .join(' / ')}`
    )
    // Every iteration: the seed, the offer's format count and size, and the helper's put-back trace (format ids and
    // lengths of what the saved record held).
    const trace = h.logs.find((l) => /put-back trace: user-restore/.test(l))
    const saving = a.logs.find((l) => /saving the clipboard \(attempt|test: saved formats/.test(l))
    if (label.startsWith('(a)')) tallySaves('25(a)', a.logs)
    if (!ok)
      console.log(
        `# 25 test-ops log: ${a.logs
          .filter((l) => /saving the clipboard|saved formats|record|clipboard/.test(l))
          .slice(0, 12)
          .join(' / ')}`
      )
    console.log(
      `# 25 ${label.replace(/^(\(.\)).*?(, repeat \d+)?$/, '$1$2')}: seed ${seeded ? 'held' : 'FAILED'}; save: ${saving ? saving.replace(/^.*?(saving the clipboard |test: )/, '') : '(no line)'}; offer ${offer ? offer.formats + ' formats, ' + offer.bytes + ' bytes' : 'none'}; ${trace ? trace.replace(/^.*put-back trace: /, 'trace: ') : '(no put-back trace line)'}`
    )
    await h.stop()
  }

  // 32. Round 20, the capture rule: a save that is not POSITIVELY established never lets the helper touch the clipboard.
  // Each reader fault (test-build reader hooks): the enumeration reports an error, lists nothing beside a real count,
  // every get answers "none", a stray line arrives before the reply (a late reply), the reader dies mid-reply. The
  // delivery answers "no-save", the seeded clipboard is byte-identical and its sequence unchanged, no record exists.
  // Round 21 adds: an enumeration error mid-list, a registered format without a name, a token without a colon, a lost
  // hold (the open taken away) during the listing and during a get, a GlobalSize of zero, an EOF fragment of the
  // listing; and a zero sequence at the write's own open (the save is fine; the write refuses).
  for (const fault of [
    'enum-error',
    'list-empty',
    'get-none',
    'stray-line',
    'die-mid-reply',
    'enum-error-mid',
    'no-name',
    'no-colon',
    'lose-hold-list',
    'lose-hold-get',
    'size-zero',
    'fragment-list',
    // Round 22: the reader without its window (B1), a reply with nothing between the id and the end (F9), an owner
    // that does not answer before a render (F4); the helper without its window (B1); a zero sequence before the
    // transaction (S2/S8: no record is ever created) and at the write's own open.
    'no-window',
    'empty-reply',
    'unresponsive',
    'helper-no-window',
    'zero-sequence',
    'zero-sequence-write',
    // Round 24 (Astra S2): the write's own journal (emptying) fails: nothing emptied, and the reason is no-record.
    'journal-emptying',
    // Round 25 (Astra S3): the write's own open fails (another app holds the clipboard) or EmptyClipboard fails.
    'write-open-fails',
    'empty-fails'
  ]) {
    await begin(`32 ${fault}`)
    const seeded = copyMulti(user)
    const before = observe()
    const env =
      fault === 'zero-sequence'
        ? { DICTATION_HELPER_TEST_ZERO_SEQUENCE: 'begin' }
        : fault === 'zero-sequence-write'
          ? { DICTATION_HELPER_TEST_EXPECT_ZERO_SEQUENCE: '1' }
          : fault === 'journal-emptying'
            ? { DICTATION_HELPER_TEST_FAIL_JOURNAL: 'emptying' }
            : fault === 'write-open-fails'
              ? { DICTATION_HELPER_TEST_WRITE_OPEN_FAILS: '1' }
              : fault === 'empty-fails'
                ? { DICTATION_HELPER_TEST_FAIL_EMPTY: '1' }
                : fault === 'helper-no-window'
                  ? { DICTATION_HELPER_TEST_NO_WINDOW: '1' }
                  : { DICTATION_HELPER_TEST_READER: fault }
    const a = start(testops, { DICTATION_HELPER_TEST: '1', ...env })
    await a.ready
    // Round 22 (S8): records are watched DURING the transaction, so "no record" means none was ever created.
    let everRecord = false
    const watch = setInterval(() => {
      if (recordFiles().length > 0) everRecord = true
    }, 5)
    const result = await a.req('__clipboard-txn', { text: 'dictated text H', holdMs: 300 })
    clearInterval(watch)
    const after = observe()
    const lines = a.logs.filter((l) => /saving the clipboard \(attempt/.test(l))
    await a.stop()
    const notStarted = {
      'zero-sequence-write': 'zero-sequence',
      'journal-emptying': 'no-record',
      'write-open-fails': 'clipboard-busy',
      'empty-fails': 'empty-failed'
    }[fault]
    const written = notStarted !== undefined
    const expected = written
      ? new RegExp(`^write-failed/untouched\\|.*\\|not-started=${notStarted}$`).test(
          String(result && result.result)
        )
      : fault === 'zero-sequence-write'
        ? /^write-failed\/untouched\|.*\|not-started=zero-sequence$/.test(
            String(result && result.result)
          )
        : fault === 'journal-emptying'
          ? /^write-failed\/untouched\|.*\|not-started=no-record$/.test(
              String(result && result.result)
            )
          : fault === 'zero-sequence'
            ? result && result.result === 'zero-sequence'
            : result && result.result === 'no-save'
    check(
      `reader fault "${fault}": not established, the delivery never touches the clipboard (byte-identical, sequence unchanged, no record${written ? ' left; the reason said' : ' ever'})`,
      seeded &&
        !!expected &&
        after.text === user &&
        after.extra === 'extra bytes for ' + user &&
        after.sequence === before.sequence &&
        after.count === before.count &&
        recordFiles().length === 0 &&
        (written || !everRecord),
      `${JSON.stringify(result)}; sequence ${before.sequence} -> ${after.sequence}; ${recordFiles()}; a record seen during it: ${everRecord}; ${lines.join(' / ')}`
    )
    console.log(
      `# 32 ${fault}: ${lines[0] || '(no save line)'}${/zero-sequence|no-window/.test(fault) ? ' | ' + (a.logs.find((l) => /not usable evidence|no clipboard window/.test(l)) || '(no refusal line)') : ''}`
    )
  }

  // 35. Round 22, the owner decision for formats a save cannot read (three classes). The clipboard is seeded by a
  // test-ops helper's own window, which pumps messages: a render request it gets is answered with nothing (as Explorer's
  // or Outlook's FileContents can be), never waited on. Presence-only formats are offered with no data at all.
  const b64 = (t) => Buffer.from(t).toString('base64')
  const u16 = (t) => Buffer.from(t + '\0', 'utf16le').toString('base64')
  const MARKERS = [
    'ExcludeClipboardContentFromMonitorProcessing',
    'CanIncludeInClipboardHistory',
    'CanUploadToCloudClipboard'
  ]
  const available = (name) => IsClipboardFormatAvailable(RegisterClipboardFormatW(name))
  const saveLines = (h) => h.logs.filter((l) => /saving the clipboard \(attempt/.test(l))
  async function seededBy(env, items) {
    const h = start(testops, { DICTATION_HELPER_TEST: '1', ...env })
    await h.ready
    const s = await h.req('__seed', { items })
    return { h, ok: !!(s && s.seeded), seed: s }
  }
  {
    await begin('35 class 1')
    const PRESENCE = [
      'Clipboard Viewer Ignore',
      'MSDEVColumnSelect',
      'MSDEVLineSelect',
      'VisualStudioEditorOperationsLineCutCopyClipboardTag'
    ]
    const words = 'presence-only ' + identity
    const {
      h,
      ok,
      seed: s
    } = await seededBy({}, [`#13|${u16(words)}`, ...PRESENCE.map((n) => `${n}|-`)])
    const before = PRESENCE.map(available)
    const live = await h.req('__clipboard-txn', { text: 'dictated text P', holdMs: 300 })
    const after = PRESENCE.map(available)
    const now = text()
    const saving = saveLines(h)
    await h.stop()
    check(
      'class 1 (Clipboard Viewer Ignore and the three Scintilla / Visual Studio flags, offered with no data): saved as presence only and established at once; the put-back is "restored", every flag present again, the text back',
      ok &&
        before.every(Boolean) &&
        !!live &&
        /^restored\|/.test(String(live.result)) &&
        after.every(Boolean) &&
        now === words &&
        saving.length === 1 &&
        /: ESTABLISHED/.test(saving[0]) &&
        recordFiles().length === 0,
      `${JSON.stringify(s)}; before ${before}; ${JSON.stringify(live)}; after ${after}; text ${now}; ${saving.join(' / ')}`
    )
    console.log(`# 35 class 1: ${saving[0] || '(no save line)'}`)
  }
  {
    await begin('35 class 2')
    const words = 'marker unread ' + identity
    const { h, ok, seed: s } = await seededBy({}, [`#13|${u16(words)}`, `${MARKERS[0]}|-`])
    let everRecord = false
    const watch = setInterval(() => {
      if (recordFiles().length > 0) everRecord = true
    }, 5)
    const live = await h.req('__clipboard-txn', { text: 'dictated text M', holdMs: 300 })
    clearInterval(watch)
    const markers = MARKERS.map(available)
    const exclude = readFormat(RegisterClipboardFormatW(MARKERS[0]))
    const now = text()
    const saving = saveLines(h)
    await h.stop()
    check(
      'class 2 (a privacy marker its owner does not render): established; the conservative exclusion markers go back with the text; never written down',
      ok &&
        !!live &&
        /^(restored|skipped)\|/.test(String(live.result)) &&
        markers.every(Boolean) &&
        !!exclude &&
        exclude[0] === 0 &&
        now === words &&
        !everRecord,
      `${JSON.stringify(s)}; ${JSON.stringify(live)}; markers ${markers}; exclude ${exclude && exclude.toString('hex')}; text ${now}; a record seen: ${everRecord}; ${saving.join(' / ')}`
    )
    console.log(`# 35 class 2: ${saving.join(' / ') || '(no save line)'}`)
  }
  {
    await begin('35 B3')
    // B3: a privacy marker over its cap (64 bytes) is skipped, and forces the conservative markers on the put-back.
    const words = 'oversize marker ' + identity
    const seededOk = seed('an oversize privacy marker', [
      [13, Buffer.from(words + '\0', 'utf16le')],
      [RegisterClipboardFormatW(MARKERS[0]), Buffer.alloc(200, 1)]
    ])
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const live = await a.req('__clipboard-txn', { text: 'dictated text O', holdMs: 300 })
    const markers = MARKERS.map(available)
    const exclude = readFormat(RegisterClipboardFormatW(MARKERS[0]))
    const now = text()
    const saving = saveLines(a)
    await a.stop()
    check(
      'B3: a privacy marker over its cap: the put-back carries the conservative exclusion markers (all three, the exclusion set), and the text',
      seededOk &&
        !!live &&
        /^(skipped|restored)\|/.test(String(live.result)) &&
        markers.every(Boolean) &&
        !!exclude &&
        exclude.length >= 1 &&
        exclude[0] === 0 &&
        now === words,
      `${JSON.stringify(live)}; markers ${markers}; exclude ${exclude && exclude.toString('hex').slice(0, 16)}; text ${now}; ${saving.join(' / ')}`
    )
  }
  for (const name of ['FileContents', 'DoodleNote.CI.Unrendered']) {
    await begin(`35 class 3 ${name}`)
    const words = 'owner-unrendered ' + identity
    const {
      h,
      ok,
      seed: s
    } = await seededBy({}, [
      `#13|${u16(words)}`,
      `${EXTRA}|${b64('extra bytes for ' + words)}`,
      `${name}|-`
    ])
    const live = await h.req('__clipboard-txn', { text: 'dictated text F', holdMs: 300 })
    const after = observe()
    const saving = saveLines(h)
    await h.stop()
    const missing = /\|missing=(.*)$/.exec(String(live && live.result))
    check(
      `class 3 (${name}, not rendered by its owner, under a proven hold): the first attempt is not established, the second a named reported skip; the paste proceeds, the put-back restores the rest and names ${name}`,
      ok &&
        !!live &&
        /^skipped\|/.test(String(live.result)) &&
        !!missing &&
        missing[1] === `${name} (not provided by the app that copied it)` &&
        after.text === words &&
        after.extra === 'extra bytes for ' + words &&
        saving.length === 2 &&
        /NOT ESTABLISHED/.test(saving[0]) &&
        /: ESTABLISHED/.test(saving[1]) &&
        recordFiles().length === 0,
      `${JSON.stringify(s)}; ${JSON.stringify(live)}; text ${after.text}; extra ${after.extra}; ${saving.join(' / ')}`
    )
    console.log(
      `# 35 class 3 ${name}: ${saving.join(' / ') || '(no save line)'} -> ${live && live.result}`
    )
  }
  {
    await begin('35 class 3 limit')
    const { h, ok, seed: s } = await seededBy({}, ['FileContents|-'])
    const live = await h.req('__clipboard-txn', { text: 'dictated text L', holdMs: 300 })
    const still = available('FileContents')
    const saving = saveLines(h)
    await h.stop()
    check(
      'class 3, its limit (only an owner-unrendered format, nothing with data): not established, no paste, the clipboard left as it was',
      ok && !!live && live.result === 'no-save' && still && recordFiles().length === 0,
      `${JSON.stringify(s)}; ${JSON.stringify(live)}; still offered ${still}; ${saving.join(' / ')}`
    )
    console.log(`# 35 class 3 limit: ${saving.join(' / ') || '(no save line)'}`)
  }

  // 36. Round 22 (S2/F8): a zero sequence at each proof site. Never a match: a zero inside the write or at the
  // confirmation rejects it (kept, as an offer, which the user's Restore then puts back); a zero at a quick look falls
  // back to the content proof; zeros at both proofs of the restore keep the record.
  for (const [sites, expect, kept] of [
    ['inside', /^owned-but-changed\/unrestored\|/, true],
    ['confirm', /^owned-but-changed\/unrestored\|/, true],
    ['looks-ours', /^restored\|/, false],
    ['still-ours', /^restored\|/, false],
    ['still-ours,still-there', /^unrestored\|/, true]
  ]) {
    await begin(`36 ${sites}`)
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_ZERO_SEQUENCE: sites
    })
    await a.ready
    const live = await a.req('__clipboard-txn', { text: 'dictated text S', holdMs: 300 })
    await a.stop()
    const files = recordFiles().length
    let done = null
    if (kept) {
      const r = start(release)
      await r.ready
      const listed = await r.req('clipboard-offers')
      const offer = listed && listed.offers[0]
      done = offer ? await restoreConfirming(r, offer) : null
      await r.stop()
    }
    const back = observe()
    check(
      `a zero sequence at ${sites}: ${kept ? "never taken as proof (kept, offered; the user's Restore puts it back)" : 'the content proof decides (restored)'}`,
      !!live &&
        expect.test(String(live.result)) &&
        (kept ? files > 0 && !!done && done.result === 'restored' : files === 0) &&
        back.text === user &&
        back.extra === 'extra bytes for ' + user &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; ${files} files; ${JSON.stringify(done)}; text ${back.text}`
    )
  }
  {
    await begin('36 view')
    copyMulti(user)
    const kept = !!(await keptRecord('dictated text Z'))
    const z = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_ZERO_SEQUENCE: 'view'
    })
    await z.ready
    const listed = await z.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const before = observe()
    const answer = offer
      ? await z.req('clipboard-restore', { record: offer.record, sequence: offer.sequence })
      : null
    const after = observe()
    await z.stop()
    const files = recordFiles().length
    const r = start(release)
    await r.ready
    const again = await r.req('clipboard-offers')
    const o2 = again && again.offers[0]
    const done = o2 ? await restoreConfirming(r, o2) : null
    await r.stop()
    check(
      "the user's Restore with a zero sequence: nothing emptied (busy), the clipboard unchanged, the record kept; a helper without the hook then restores it",
      kept &&
        !!offer &&
        !!answer &&
        answer.result === 'busy' &&
        after.sequence === before.sequence &&
        files > 0 &&
        !!done &&
        done.result === 'restored' &&
        text() === user,
      `${JSON.stringify(offer)}; ${JSON.stringify(answer)}; sequence ${before.sequence} -> ${after.sequence}; ${files} files; ${JSON.stringify(done)}`
    )
  }

  // 37. Round 22 (Opus S2): the write throws right after EmptyClipboard. Its ownership survives the throw: never
  // "untouched"; the transaction loses its authority and its record is kept and offered; the user's Restore puts it back.
  {
    await begin('37')
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_THROW_AFTER_EMPTY: '1'
    })
    await a.ready
    const live = await a.req('__clipboard-txn', { text: 'dictated text T', holdMs: 300 })
    const threw = a.logs.find((l) => /the clipboard write threw/.test(l))
    await a.stop()
    const r = start(release)
    await r.ready
    const listed = await r.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const done = offer ? await restoreConfirming(r, offer) : null
    await r.stop()
    const back = observe()
    check(
      "a write that throws after EmptyClipboard: reported unrestored (never untouched), the record kept and offered; the user's Restore puts the clipboard back",
      !!live &&
        /^write-failed\/unrestored\|/.test(String(live.result)) &&
        !!threw &&
        !!offer &&
        !!done &&
        done.result === 'restored' &&
        back.text === user &&
        back.extra === 'extra bytes for ' + user &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; ${threw}; ${JSON.stringify(offer)}; ${JSON.stringify(done)}; text ${back.text}`
    )
  }

  // 35b. Round 23 (Opus S-D): a copy carrying "Clipboard Viewer Ignore" is never written to disk (in memory only),
  // and still goes back whole (the flag as presence only).
  {
    await begin('35b')
    const words = 'viewer ignore ' + identity
    const {
      h,
      ok,
      seed: s
    } = await seededBy({}, [`#13|${u16(words)}`, 'Clipboard Viewer Ignore|-'])
    let everRecord = false
    const watch = setInterval(() => {
      if (recordFiles().length > 0) everRecord = true
    }, 5)
    const live = await h.req('__clipboard-txn', { text: 'dictated text VI', holdMs: 300 })
    clearInterval(watch)
    const flag = available('Clipboard Viewer Ignore')
    const now = text()
    await h.stop()
    check(
      'Clipboard Viewer Ignore (round 23): never written to disk; the put-back restores the text and the flag',
      ok &&
        !!live &&
        /^restored\|/.test(String(live.result)) &&
        flag &&
        now === words &&
        !everRecord,
      `${JSON.stringify(s)}; ${JSON.stringify(live)}; flag ${flag}; text ${now}; a record seen: ${everRecord}`
    )
  }

  // 35c. Round 23, the one rule (Opus S-B): a delayed-render text owner that renders nothing for its text while its
  // CF_LOCALE reads: nothing with the user's content would go back, so no paste and the clipboard is left alone.
  {
    await begin('35c')
    const {
      h,
      ok,
      seed: s
    } = await seededBy({}, ['#13|-', `#16|${Buffer.from([9, 4, 0, 0]).toString('base64')}`])
    const before = observe()
    const live = await h.req('__clipboard-txn', { text: 'dictated text DL', holdMs: 300 })
    const after = observe()
    const saving = saveLines(h)
    const why = h.logs.find((l) => /not pasting: the clipboard could not be saved/.test(l))
    await h.stop()
    check(
      'the text unrendered by its owner, CF_LOCALE readable (round 23, the one rule): not established, no paste, the clipboard untouched, the reason unrendered',
      ok &&
        !!live &&
        live.result === 'no-save' &&
        after.sequence === before.sequence &&
        after.count === before.count &&
        /\(unrendered\)/.test(String(why)) &&
        recordFiles().length === 0,
      `${JSON.stringify(s)}; ${JSON.stringify(live)}; sequence ${before.sequence} -> ${after.sequence}; ${saving.join(' / ')}; ${why}`
    )
    console.log(`# 35c: ${saving.join(' / ') || '(no save line)'}`)
  }

  // 36b. Round 23 (Opus SF3): the incomplete-enumeration hook at the two call sites the unit test cannot reach: the
  // confirmation (rejects: kept, offered) and the content proof of the restore (with the quick proof failing too:
  // kept, never restored on an incomplete look). The user's Restore then puts the clipboard back.
  for (const [env, expect] of [
    [{ DICTATION_HELPER_TEST_ENUM_INCOMPLETE: 'confirm' }, /^owned-but-changed\/unrestored\|/],
    [
      {
        DICTATION_HELPER_TEST_ENUM_INCOMPLETE: 'still-there',
        DICTATION_HELPER_TEST_ZERO_SEQUENCE: 'still-ours'
      },
      /^unrestored\|/
    ]
  ]) {
    await begin(`36b ${env.DICTATION_HELPER_TEST_ENUM_INCOMPLETE}`)
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1', ...env })
    await a.ready
    const live = await a.req('__clipboard-txn', { text: 'dictated text IE', holdMs: 300 })
    await a.stop()
    const files = recordFiles().length
    const r = start(release)
    await r.ready
    const listed = await r.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const done = offer ? await restoreConfirming(r, offer) : null
    await r.stop()
    const back = observe()
    check(
      `an incomplete enumeration at ${env.DICTATION_HELPER_TEST_ENUM_INCOMPLETE}: never taken as proof (kept, offered; the user's Restore puts it back)`,
      !!live &&
        expect.test(String(live.result)) &&
        files > 0 &&
        !!done &&
        done.result === 'restored' &&
        back.text === user &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; ${files} files; ${JSON.stringify(done)}; text ${back.text}`
    )
  }

  // 37b. Round 23 (Astra B1): the write's own rollback (its emptied stage not journaled: test hook) throws before its
  // put-back, or after it but before its result is assigned. Emptied is recorded first: never "untouched"; the record
  // is kept (offered and put back by the user's Restore, or found already whole on the clipboard and deleted).
  for (const where of ['before-set', 'after-set']) {
    await begin(`37b ${where}`)
    copyMulti(user)
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_FAIL_JOURNAL: 'emptied',
      DICTATION_HELPER_TEST_THROW_IN_ROLLBACK: where
    })
    await a.ready
    const live = await a.req('__clipboard-txn', { text: 'dictated text RB', holdMs: 300 })
    const threw = a.logs.find((l) =>
      /the clipboard write threw .* after emptying the clipboard/.test(l)
    )
    await a.stop()
    const files = recordFiles().length
    const r = start(release)
    await r.ready
    const listed = await r.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const done = offer ? await restoreConfirming(r, offer) : null
    await r.stop()
    const back = observe()
    check(
      `the write's rollback throws ${where}: reported unrestored (never untouched), the record kept; ${where === 'before-set' ? "offered, and the user's Restore puts it back" : 'the saved content already whole there: deleted without writing'}`,
      !!live &&
        /^write-failed\/unrestored\|/.test(String(live.result)) &&
        !!threw &&
        files > 0 &&
        (where === 'before-set' ? !!done && done.result === 'restored' : !offer) &&
        back.text === user &&
        back.extra === 'extra bytes for ' + user &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; ${threw}; ${files} files; ${JSON.stringify(listed)}; ${JSON.stringify(done)}; text ${back.text}`
    )
  }

  // 39. Round 23 (Astra B2, Opus SF2): an INCOMPLETE record (a class-3 skip of FileContents) whose retained part is back on
  // the clipboard is never deleted as "already there". Two ways to get there: the live put-back succeeded but its
  // stage could not be journaled (kept), and the helper died with every retained format set back. Its offer says it is
  // incomplete; a Restore without acceptIncomplete empties nothing ("incomplete"); with it, "restored-partially"
  // names FileContents and the record is settled and deleted.
  for (const path of ['journal failed', 'killed after the put-back']) {
    await begin(`39 ${path}`)
    const words = 'incomplete record ' + identity
    const { h, ok } = await seededBy(
      path === 'journal failed'
        ? { DICTATION_HELPER_TEST_FAIL_JOURNAL: 'restore-emptied' }
        : { DICTATION_HELPER_TEST_PUTBACK_STALL_END_MS: '60000' },
      [`#13|${u16(words)}`, `${EXTRA}|${b64('extra bytes for ' + words)}`, 'FileContents|-']
    )
    const reply = h.req('__clipboard-txn', { text: 'dictated text IR', holdMs: 300 })
    let live = null
    if (path === 'journal failed') {
      live = await reply
      await h.stop()
    } else {
      // Round 30: killed at its own stall line (every retained format set back), not by any record's stage.
      const reached = await atLine(
        h,
        'the end of its put-back',
        /test-trace: stall PUTBACK_STALL_END_MS/
      )
      await h.kill()
      live = { result: reached ? 'killed in its put-back' : 'did not reach its put-back' }
    }
    const files = recordFiles().length
    const there = observe()
    const r = start(release)
    await r.ready
    const listed = await r.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const before = observe()
    const refused = offer
      ? await r.req('clipboard-restore', { record: offer.record, sequence: offer.sequence })
      : null
    const unchanged = observe()
    const accepted = offer
      ? await r.req('clipboard-restore', {
          record: offer.record,
          sequence:
            refused && typeof refused.sequence === 'number' ? refused.sequence : offer.sequence,
          acceptIncomplete: true
        })
      : null
    await until(() => recordFiles().length === 0, 5000) // the settled record's deletion (polled, with a deadline)
    const left = recordFiles().length
    const listedAfter = await r.req('clipboard-offers')
    await r.stop()
    const back = observe()
    check(
      `an incomplete record whose retained part is back (${path}): offered as incomplete (never deleted as already there); a Restore without acceptIncomplete empties nothing; with it "restored-partially" names FileContents and the record is settled`,
      ok &&
        files > 0 &&
        there.text === words &&
        !!offer &&
        offer.incomplete === true &&
        offer.missing.includes('FileContents (not provided by the app that copied it)') &&
        !!refused &&
        refused.result === 'incomplete' &&
        unchanged.sequence === before.sequence &&
        !!accepted &&
        accepted.result === 'restored-partially' &&
        Array.isArray(accepted.missing) &&
        accepted.missing.includes('FileContents (not provided by the app that copied it)') &&
        left === 0 &&
        !!listedAfter &&
        listedAfter.offers.length === 0 &&
        back.text === words &&
        back.extra === 'extra bytes for ' + words,
      `${JSON.stringify(live)}; ${files} files; text there ${there.text}; ${JSON.stringify(offer)}; ${JSON.stringify(refused)}; ${JSON.stringify(accepted)}; ${left} left; ${JSON.stringify(listedAfter)}`
    )
  }

  // 40. Round 24 (Opus, the one rule at the user's Restore): a record whose only content format is lost on read-back
  // (test hook: the read drops its last item) has nothing with the user's content to put back. Its offer counts 0
  // content; the user's Restore is refused before emptying ("nothing-to-restore"), the clipboard unchanged; the
  // record stays for Dismiss.
  {
    await begin('40')
    const only = 'only custom content ' + identity
    const seeded = seed('only a custom format', [
      [RegisterClipboardFormatW(EXTRA), Buffer.from(only)]
    ])
    const k = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_PUTBACK_STALL_END_MS: '60000'
    })
    await k.ready
    void k.req('__clipboard-txn', { text: 'dictated text NR', holdMs: 200 })
    const reached = !!(await atLine(
      k,
      'the end of its put-back',
      /test-trace: stall PUTBACK_STALL_END_MS/
    ))
    await k.kill()
    const files = recordFiles().length
    const z = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_RECORD_LOSES_NAME: '1'
    })
    await z.ready
    const listed = await z.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const before = observe()
    const answer = offer
      ? await z.req('clipboard-restore', {
          record: offer.record,
          sequence: offer.sequence,
          acceptIncomplete: true
        })
      : null
    const after = observe()
    const left = recordFiles().length
    // The record stays for Dismiss (round 30: and this case ends clean through it, as the user would, in the same
    // helper: another helper without the read-back hook finds the saved content already whole on the clipboard and
    // deletes the record at its start, correctly, so it would never be offered there).
    const gone = offer ? await z.req('clipboard-dismiss', { record: offer.record }) : null
    await z.stop()
    check(
      "a record with no user content left (its only content lost on read-back): offered with content 0; the user's Restore is refused before emptying (nothing-to-restore), the clipboard unchanged, the record kept",
      seeded &&
        reached &&
        files > 0 &&
        !!offer &&
        offer.incomplete === true &&
        offer.content === 0 &&
        !!answer &&
        answer.result === 'nothing-to-restore' &&
        after.sequence === before.sequence &&
        left === files,
      `${JSON.stringify(offer)}; ${JSON.stringify(answer)}; sequence ${before.sequence} -> ${after.sequence}; ${files} -> ${left} files`
    )
    check(
      "and the user's Dismiss of that record deletes every file",
      !!gone && gone.dismissed === true && prefixFiles().length === 0,
      `${JSON.stringify(gone)}; ${listing()}`
    )
  }

  // 38. Round 22 (F7): whether a record's helper still runs cannot be told (test hook): nothing is judged or deleted on
  // that unknown (not offered, the dismiss refused, every file kept); a helper that can tell offers and restores it.
  {
    await begin('38')
    copyMulti(user)
    const kept = !!(await keptRecord('dictated text U'))
    const files = recordFiles().length
    const u = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_LIVENESS_UNKNOWN: '1'
    })
    await u.ready
    const listed = await u.req('clipboard-offers')
    const state = recordFiles().find((f) => f.endsWith('.state'))
    const dismissed = state
      ? await u.req('clipboard-dismiss', {
          record: state.slice(recordPrefix.length, -'.state'.length)
        })
      : null
    const left = recordFiles().length
    await u.stop()
    const r = start(release)
    await r.ready
    const again = await r.req('clipboard-offers')
    const offer = again && again.offers[0]
    const done = offer ? await restoreConfirming(r, offer) : null
    await r.stop()
    check(
      "liveness unknown: not offered, the dismiss refused, every file kept; a helper that can tell then offers it and the user's Restore puts it back",
      kept &&
        files > 0 &&
        !!listed &&
        listed.offers.length === 0 &&
        !!dismissed &&
        dismissed.dismissed === false &&
        left === files &&
        !!done &&
        done.result === 'restored' &&
        text() === user,
      `${files} files; ${JSON.stringify(listed)}; ${JSON.stringify(dismissed)}; ${left} left; ${JSON.stringify(done)}`
    )
  }

  // 33b. Round 21: the same stress WITH a concurrent NULL-window poller in another process (the suspected trigger):
  // it hammers OpenClipboard(NULL)/CloseClipboard. Every save must be either established with exactly the seeded
  // shape, or not established ("no-save") with the clipboard intact. Counted and quoted.
  {
    await begin('33b')
    const poller = spawn(
      process.execPath,
      [
        '-e',
        `const koffi = require(${JSON.stringify(require.resolve('koffi'))}); const u = koffi.load('user32.dll'); const O = u.func('bool __stdcall OpenClipboard(void* h)'); const C = u.func('bool __stdcall CloseClipboard()'); const E = u.func('uint32 __stdcall EnumClipboardFormats(uint32 f)'); const end = Date.now() + 120000; let n = 0; while (Date.now() < end) { if (O(null)) { E(0); C(); n++ } } console.log(n)`
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    tracked(poller, 'the NULL-window poller')
    let polls = ''
    poller.stdout.on('data', (c) => (polls += c))
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const runs = 400
    let good = 0
    let noSave = 0
    let bad = 0
    let expected = null
    const shown = []
    const started = Date.now()
    for (let n = 0; n < runs; n++) {
      if (!copyMulti(user + ' ' + (n % 2))) continue
      // Round 22 (S8): the expected shape is the seed's own, read back by this process (never the first save's).
      if (expected === null) expected = seededShape()
      const r = await a.req('__save-only', {})
      const now = observe()
      const intact =
        now.text === user + ' ' + (n % 2) && now.extra === 'extra bytes for ' + user + ' ' + (n % 2)
      if (r && r.established) {
        const shape = `${r.items}|${r.shape}|${r.bytes}`
        if (shape === expected) good++
        else {
          bad++
          if (shown.length < 20)
            shown.push(`#${n} ESTABLISHED WITH ANOTHER SHAPE ${shape} vs ${expected}: ${r.line}`)
        }
      } else {
        if (intact) noSave++
        else bad++
        if (shown.length < 20)
          shown.push(
            `#${n} ${intact ? 'no-save, clipboard intact' : 'no-save, CLIPBOARD NOT INTACT'}: ${r && r.line}`
          )
      }
    }
    await a.stop()
    poller.kill()
    await waitExit(poller)
    tallySaves('33b stress with a NULL-window poller', a.logs)
    console.log(
      `# 33b stress with a NULL-window poller: ${runs} saves in ${Date.now() - started} ms; ${good} established with the seeded shape, ${noSave} not established with the clipboard intact, ${bad} bad; poller opens: ${polls.trim() || '(still running)'}`
    )
    for (const l of shown) console.log(`# 33b ${l}`)
    check(
      'stress with a NULL-window poller: all 400 saves accounted for, each established with the seeded shape or not established with the clipboard intact',
      bad === 0 && good + noSave === runs && expected !== null,
      shown.join(' / ')
    )
  }

  // 33. Round 20 stress: the save alone, several hundred times (seeded and read back each time); every save must hold
  // exactly what was seeded (item count and lengths). Any mismatch prints its save line and fails.
  {
    await begin('33')
    const a = start(testops, { DICTATION_HELPER_TEST: '1' })
    await a.ready
    const runs = 400
    let mismatches = 0
    let notEstablished = 0
    let expected = null
    const shown = []
    const started = Date.now()
    for (let n = 0; n < runs; n++) {
      if (!copyMulti(user + ' ' + (n % 2))) continue
      if (expected === null) expected = seededShape() // round 22 (S8): the seed's own shape
      const r = await a.req('__save-only', {})
      if (!r || !r.established) {
        notEstablished++
        if (shown.length < 5) shown.push(`#${n} not established: ${r && r.line}`)
        continue
      }
      const shape = `${r.items}|${r.shape}|${r.bytes}`
      if (shape !== expected) {
        mismatches++
        if (shown.length < 5) shown.push(`#${n} ${shape} vs ${expected}: ${r.line}`)
      }
    }
    await a.stop()
    tallySaves('33 stress', a.logs)
    console.log(
      `# 33 save-only stress: ${runs} saves in ${Date.now() - started} ms; expected ${expected}; ${mismatches} mismatch(es), ${notEstablished} not established (no paste would follow)`
    )
    for (const l of shown) console.log(`# 33 ${l}`)
    check(
      'save-only stress: every established save holds exactly what was seeded',
      mismatches === 0 && expected !== null && expected.startsWith('5|'),
      `${mismatches} mismatches; ${shown.join(' / ')}`
    )
  }

  // 25d. Opus round 18 B1 (no coverage before): dictation over an EMPTY clipboard. The live transaction's restore
  // reports "restored" (nothing to set back), no offer, the record gone; and the same after a kill: the restarted
  // release helper offers it (0 formats) and the user's Restore reports "restored", the clipboard empty, record gone.
  for (const killed of [false, true]) {
    await begin(`25d ${killed ? 'killed' : 'live'}`)
    const seeded = seed('an empty clipboard', [])
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: killed ? ['HOLD'] : [] })
    await a.ready
    const reply = a.req('__clipboard-txn', { text: 'dictated text E', holdMs: 300 })
    let live = null
    if (killed) {
      await atLine(a, 'our write confirmed and held', HOLDING)
      await atLine(a, 'the payload on disk', PAYLOAD)
      await a.kill()
    } else {
      live = await reply
      await a.stop()
    }
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    if (!killed) {
      check(
        'dictation over an empty clipboard: the live restore reports "restored", no offer, the record gone, the clipboard empty',
        seeded &&
          !!live &&
          /^restored\|/.test(String(live.result)) &&
          !!listed &&
          listed.offers.length === 0 &&
          recordFiles().length === 0 &&
          CountClipboardFormats() === 0,
        `${JSON.stringify(live)}; ${JSON.stringify(listed)}; ${recordFiles()}; ${CountClipboardFormats()} formats`
      )
    } else {
      const offer = listed && listed.offers[0]
      const restored = offer ? await restoreConfirming(h, offer) : null
      check(
        'killed over an empty clipboard: offered (0 formats); the user\'s Restore reports "restored", the clipboard empty, the record gone',
        seeded &&
          !!offer &&
          offer.formats === 0 &&
          !!restored &&
          restored.result === 'restored' &&
          CountClipboardFormats() === 0 &&
          recordFiles().length === 0,
        `${JSON.stringify(listed)}; ${JSON.stringify(restored)}; ${CountClipboardFormats()} formats; ${recordFiles()}`
      )
    }
    await h.stop()
  }

  // 25e'. Round 21: a seed of ONLY an oversize custom format (no text, so nothing synthesized). Round 23 (the one rule):
  // nothing with the user's content would go back, so the save is not established and nothing is pasted.
  {
    await begin("25e'")
    const seeded = seed('only an oversize custom format', [
      [RegisterClipboardFormatW(EXTRA), Buffer.from('y'.repeat(200))]
    ])
    const a = start(testops, { DICTATION_HELPER_TEST: '1', DICTATION_HELPER_CLIP_MAXBYTES: '64' })
    await a.ready
    const before = observe()
    const live = await a.req('__clipboard-txn', { text: 'dictated text G2', holdMs: 300 })
    const after = observe()
    const saving = a.logs.find((l) => /saving the clipboard \(attempt/.test(l))
    const why = a.logs.find((l) => /not pasting: the clipboard could not be saved/.test(l))
    await a.stop()
    // Round 23, the one rule (a directed change; round 22 asserted a zero-item "skipped" save that emptied it).
    check(
      'only an oversize custom format (round 23, the one rule): not established, no paste, the clipboard untouched, the reason too-large',
      seeded &&
        !!live &&
        live.result === 'no-save' &&
        after.sequence === before.sequence &&
        after.count === before.count &&
        String(readFormat(RegisterClipboardFormatW(EXTRA))).startsWith('y'.repeat(200)) &&
        /\(too-large\)/.test(String(why)) &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; sequence ${before.sequence} -> ${after.sequence}; ${recordFiles()}; ${saving}; ${why}`
    )
  }

  // 25e. Opus round 18 B1: a save in which EVERY format is over the cap (the test-build cap hook stands in for the
  // real 16 MiB per transaction, as a 4K screenshot's DIB exceeds it). Round 23 (the one rule): only CF_LOCALE fits,
  // which is no user content, so the save is not established and the clipboard is left as it was.
  {
    await begin('25e')
    const big = 'x'.repeat(200)
    const seeded = seed('an all-oversize copy', [
      [13, Buffer.from(big + '\0', 'utf16le')],
      [RegisterClipboardFormatW(EXTRA), Buffer.from(big)]
    ])
    const a = start(testops, { DICTATION_HELPER_TEST: '1', DICTATION_HELPER_CLIP_MAXBYTES: '64' })
    await a.ready
    const before = observe()
    const live = await a.req('__clipboard-txn', { text: 'dictated text G', holdMs: 300 })
    const after = observe()
    const why = a.logs.find((l) => /not pasting: the clipboard could not be saved/.test(l))
    await a.stop()
    // Round 23, the one rule (the 4K-screenshot case; round 22 asserted a "skipped" restore of only CF_LOCALE).
    check(
      'every user format over the cap (round 23, the one rule): not established, no paste, the clipboard untouched (only CF_LOCALE fit: no user content), the reason too-large',
      seeded &&
        !!live &&
        live.result === 'no-save' &&
        after.sequence === before.sequence &&
        after.text === big &&
        /\(too-large\)/.test(String(why)) &&
        recordFiles().length === 0,
      `${JSON.stringify(live)}; sequence ${before.sequence} -> ${after.sequence}; ${recordFiles()}; ${why}`
    )
  }

  // 26. Astra round-17 P2-2: a failed restore that already emptied the clipboard (the user's Restore, every set-back
  // failing by a test hook) -> unrestored; the same helper's retry (3 s) and a restarted release helper never write.
  {
    await begin('26')
    copyMulti(user)
    await keptRecord('dictated text V')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_FAIL_PUTBACKS: '99'
    })
    await a.ready
    const listed = await a.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const failed = offer ? await restoreConfirming(a, offer) : null
    const sequence = GetClipboardSequenceNumber()
    // Round 30: the same helper's own retry, by its line (not 5 s), and only then is the clipboard looked at.
    const afterFailure = a.logs.length
    await atLine(a, 'its own retry', /clipboard record \w+ \(retry\)/, { since: afterFailure })
    const quiet = GetClipboardSequenceNumber() === sequence
    await a.stop()
    const h = start(release)
    await h.ready
    const again = await h.req('clipboard-offers')
    check(
      'a failed restore (every set-back failed): unrestored, no retry or restart writes, offered again',
      !!failed &&
        failed.result === 'unrestored' &&
        quiet &&
        !!again &&
        again.offers.length === 1 &&
        GetClipboardSequenceNumber() === sequence,
      `${JSON.stringify(failed)}; quiet ${quiet}; ${JSON.stringify(again)}; ${sequence} -> ${GetClipboardSequenceNumber()}`
    )
    const o2 = again && again.offers[0]
    if (o2) await h.req('clipboard-dismiss', { record: o2.record })
    await h.stop()
  }

  // 27. Astra round-17 P2-3: killed during adoption (after its offer-only fact is persisted, before the .bin.tmp move;
  // round 17 moved first): the restarted release helper adopts and offers it, our write left on the clipboard.
  {
    await begin('27')
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['HOLD'] })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text W' })
    await atLine(a, 'our write confirmed and held', HOLDING)
    await atLine(a, 'the payload on disk', PAYLOAD)
    await a.kill()
    const bin = recordFiles().find((f) => f.endsWith('.bin'))
    if (bin) fs.renameSync(path.join(os.tmpdir(), bin), path.join(os.tmpdir(), bin + '.tmp'))
    // Its start-up check runs the adoption: kill it once the offer-only fact is on disk (the move waits 15 s).
    const b = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_STALL_IN_ADOPT_MS: '60000'
    })
    const marked = () => {
      const f = recordFiles().find((x) => x.endsWith('.state'))
      try {
        return (
          !!f && JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), 'utf8')).offerOnly === true
        )
      } catch {
        return false
      }
    }
    // Round 30: killed at its own stall line (after the persist, before the move); marked() is checked below.
    await atLine(b, 'the adoption stalled before its move', /test-trace: stall STALL_IN_ADOPT_MS/)
    const persisted = marked()
    await b.kill()
    const st = recordFiles().find((f) => f.endsWith('.state'))
    const quarantined = st
      ? JSON.parse(fs.readFileSync(path.join(os.tmpdir(), st), 'utf8')).offerOnly
      : null
    const tmpLeft = !!bin && fs.existsSync(path.join(os.tmpdir(), bin + '.tmp'))
    const sequence = GetClipboardSequenceNumber()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      "killed between the adoption's persist and its move: persisted first, then adopted and offered, never restored",
      persisted &&
        quarantined === true &&
        tmpLeft &&
        !!listed &&
        listed.offers.length === 1 &&
        text() === 'dictated text W' &&
        GetClipboardSequenceNumber() === sequence,
      `offerOnly ${quarantined}; tmp ${tmpLeft}; ${JSON.stringify(listed)}; ${text()}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 28. Astra round-17 P1: a payload whose metadata cannot be read (test hook: the probe answers UNKNOWN) is never
  // "missing": next to an invalid state, and next to a valid one, both files are kept; once it can be looked at, the
  // release helper offers it. And a state whose payload is POSITIVELY absent is deleted (nothing to restore from).
  for (const invalidState of [true, false]) {
    await begin(`28 ${invalidState ? 'invalid' : 'valid'} state`)
    copyMulti(user)
    await keptRecord('dictated text X ' + invalidState)
    const st = recordFiles().find((f) => f.endsWith('.state'))
    if (st && invalidState) fs.writeFileSync(path.join(os.tmpdir(), st), '{}')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_PROBE_UNKNOWN: '.bin'
    })
    await a.ready
    await a.req('clipboard-offers')
    const kept = recordFiles().length
    await a.stop()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      `a payload that cannot be looked at, next to ${invalidState ? 'an invalid' : 'a valid'} state: kept whole, offered once it can be`,
      kept === 2 && !!listed && listed.offers.length === 1,
      `${kept}; ${JSON.stringify(listed)}`
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }
  {
    await begin('28 payload absent')
    copyMulti(user)
    await keptRecord('dictated text X2')
    const bin = recordFiles().find((f) => f.endsWith('.bin'))
    if (bin) fs.rmSync(path.join(os.tmpdir(), bin))
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'a state whose payload is positively absent (no .bin, no .bin.tmp): deleted, nothing offered',
      !!bin && !!listed && listed.offers.length === 0 && recordFiles().length === 0,
      `${JSON.stringify(listed)}; ${recordFiles()}`
    )
    await h.stop()
  }

  // 29. Round 18 item 2: the user's Restore succeeds but the files cannot be deleted (the payload held with sharing that
  // allows reading, not deletion): restored, the offer withdrawn at once and the state journaled "settled"; never
  // offered again; deleted once released.
  {
    await begin('29')
    copyMulti(user)
    await keptRecord('dictated text Y')
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    const bin = recordFiles().find((f) => f.endsWith('.bin'))
    const st = recordFiles().find((f) => f.endsWith('.state'))
    // Round 30: the payload held with read sharing by another process that SAYS it holds it (not 1.2 s).
    const lock = bin ? lockFile(path.join(os.tmpdir(), bin), { share: 'read' }) : null
    if (lock && !(await lock.locked))
      check(`${frame.label}: reached the lock held by another process`, false, lock.output())
    const restored = offer ? await restoreConfirming(h, offer) : null
    const left = recordFiles().length
    const stage =
      st && fs.existsSync(path.join(os.tmpdir(), st))
        ? JSON.parse(fs.readFileSync(path.join(os.tmpdir(), st), 'utf8')).stage
        : null
    const gone = h.events.some(
      (e) => e.phase === 'offer-gone' && offer && e.record === offer.record
    )
    const again = await h.req('clipboard-offers')
    check(
      'a restore whose file deletion is held: restored, settled, the offer withdrawn, not offered again',
      !!restored &&
        restored.result === 'restored' &&
        names() === userFormats &&
        left === 2 &&
        stage === 'settled' &&
        gone &&
        !!again &&
        again.offers.length === 0,
      `${JSON.stringify(restored)}; left ${left}; stage ${stage}; gone ${gone}; ${JSON.stringify(again)}`
    )
    if (lock) await lock.release()
    await h.req('clipboard-offers')
    check(
      'and the settled record is deleted once the payload is released',
      recordFiles().length === 0,
      `${recordFiles()}`
    )
    await h.stop()
  }

  // 30. Round 18 item 3: an older-build (invalid: no offerOnly) state from an EARLIER boot naming another session is
  // rebuilt and offered here (the boot is checked before the session), not left to a session that no longer exists.
  {
    await begin('30')
    copyMulti(user)
    await keptRecord('dictated text Z')
    const st = recordFiles().find((f) => f.endsWith('.state'))
    const full = st ? path.join(os.tmpdir(), st) : ''
    if (st) {
      const state = JSON.parse(fs.readFileSync(full, 'utf8'))
      delete state.offerOnly
      delete state.offerOnlyWhy
      fs.writeFileSync(
        full,
        JSON.stringify({ ...state, session: state.session + 7, bootId: 'an-earlier-boot' })
      )
    }
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'an invalid state from an earlier boot in another session: rebuilt and offered here',
      !!st && !!listed && listed.offers.length === 1,
      JSON.stringify(listed)
    )
    const offer = listed && listed.offers[0]
    if (offer) await h.req('clipboard-dismiss', { record: offer.record })
    await h.stop()
  }

  // 13d. Round 18 item 4: the mixed rollback (state .tmp, payload .tmp and state marked; the payload's mark fails;
  // clearing the payload .tmp's mark fails, the others clear): the deletion is completed from the beginning, never a
  // state left without its payload.
  {
    await begin('13d')
    copyMulti(user)
    await keptRecord('dictated text L4')
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_FAIL_DELETE_MARK: '4',
      DICTATION_HELPER_TEST_FAIL_DELETE_UNMARK: '2'
    })
    await a.ready
    const listed = await a.req('clipboard-offers')
    const offer = listed && listed.offers[0]
    if (offer) {
      const base = path.join(os.tmpdir(), `${recordPrefix}${offer.record}`)
      fs.writeFileSync(base + '.state.tmp', '{}')
      fs.writeFileSync(base + '.bin.tmp', 'x')
    }
    const gone = offer ? await a.req('clipboard-dismiss', { record: offer.record }) : null
    await a.stop()
    const left = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(recordPrefix))
    check(
      'a rollback that cannot finish completes the deletion from the beginning (nothing left, no state without payload)',
      !!gone && gone.dismissed === true && left.length === 0,
      `${JSON.stringify(gone)}; ${left}`
    )
  }

  // 41. Round 30, the late path made deterministic: our write runs past its budget (WriteBounded, the real 1 s: no
  // override here), forced by a gate. Attempt 1 of CI run 42842819157 took this path by chance in case 11 (and round
  // 29's attempt 1 in case 15): the product was right both times; the cases did not account for it. Each outcome:
  // (a) past the budget before emptying (an owner stalling in WM_DESTROYCLIPBOARD): nothing of ours is ever on the
  // clipboard, the user's content goes back, the record is settled; (b) past it after our write closed (a slow journal):
  // the late thread confirms and restores; (c)-(e) a change before that late confirmation (an addition, CF_TEXT replaced,
  // another app's copy): kept as an offer, the change untouched, and the user's Restore gives the clipboard back.
  for (const [label, gates, change, expect] of [
    ['(a) before emptying', ['EMPTY'], null, 'restored'],
    ['(b) after our write closed', ['WRITTEN'], null, 'restored'],
    ['(c) an addition before the late confirmation', ['WRITTEN', 'CONFIRM'], 'add', 'unrestored'],
    [
      '(d) CF_TEXT replaced before the late confirmation',
      ['WRITTEN', 'CONFIRM'],
      'replace',
      'unrestored'
    ],
    [
      '(e) another app copies before the late confirmation',
      ['WRITTEN', 'CONFIRM'],
      'copy',
      'user-changed'
    ]
  ]) {
    await begin(`41 ${label.slice(0, 3)}`)
    copyMulti(user)
    const a = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates, realBudget: true })
    await a.ready
    const dictated = `dictated text LT ${label.slice(1, 2)}`
    // The write waits at its gate: the transaction answers once the budget is over (the late path).
    const result = await a.req('__clipboard-txn', { text: dictated, holdMs: 300 })
    const budgetLine =
      a.logs.find((l) => /the clipboard write ran past its 1000 ms budget/.test(l)) || null
    // Before emptying the stalled write holds the clipboard open (nothing to read); after its close our text is there.
    const during = gates[0] === 'WRITTEN' ? text() : null
    a.open(gates[0])
    let theirs = null
    if (change) {
      await atLine(a, 'the late confirmation at its gate', /test-trace: gate CONFIRM#1 waiting/)
      if (change === 'add') addFormat()
      if (change === 'replace') replaceFormat(1, Buffer.from('replaced ANSI\0', 'latin1'))
      if (change === 'copy') copyMulti('a copy by another app')
      theirs = names()
      a.open('CONFIRM')
    }
    const ended = await a.waitEvent((e) => e.event === 'clipboard' && e.phase === 'late-restore')
    const endLine = await a.waitLog(/the late clipboard write ended \(/)
    await a.stop()
    const after = observe()
    const files = recordFiles().length
    const userBack = after.text === user && after.extra === 'extra bytes for ' + user
    const where =
      gates[0] === 'EMPTY'
        ? !!budgetLine &&
          /journaled emptying at \d+ ms; now/.test(budgetLine) &&
          !/emptied at/.test(budgetLine)
        : !!budgetLine && /closed at \d+ ms; now/.test(budgetLine)
    check(
      `the late path, forced ${label}: answered late (no paste), the log names where the write was, the late result "${expect}"${expect === 'restored' ? ', the user clipboard back, the record settled' : ', kept as an offer, the change untouched'}`,
      !!result &&
        /^late\|/.test(String(result.result)) &&
        where &&
        (gates[0] === 'WRITTEN' ? during === dictated : true) &&
        !!ended &&
        ended.clipboard === expect &&
        ended.id === result.id &&
        !!endLine &&
        endLine.endsWith(': ' + expect) &&
        (expect === 'restored' ? userBack && files === 0 : files === 2) &&
        (change === null || names() === theirs),
      `${JSON.stringify(result)}; ${budgetLine}; during ${during}; ${JSON.stringify(ended)}; ${endLine}; ${files} files; ${names()}`
    )
    if (expect !== 'restored') {
      const h = start(release)
      await h.ready
      const listed = await h.req('clipboard-offers')
      const offer = listed && listed.offers[0]
      const restored = offer ? await restoreConfirming(h, offer) : null
      check(
        `the late path ${label}: offered by the release helper; the user's Restore gives back the user clipboard`,
        !!offer &&
          listed.offers.length === 1 &&
          !!restored &&
          restored.result === 'restored' &&
          names() === userFormats &&
          recordFiles().length === 0,
        `${JSON.stringify(listed)}; ${JSON.stringify(restored)}; ${names()}`
      )
      await h.stop()
    }
  }

  // 42. Round 30, the crash point behind attempt 1's cascade (run 42842819157, case 5): a helper killed inside its
  // FIRST state write, the .tmp written and not yet in place (test hook). Nothing of the clipboard was touched: only a
  // lone .state.tmp is left; no offer; a young .tmp is left alone (it may be another helper's write in progress), and
  // once older than 10 minutes the next look deletes it (a stray: no payload depends on it).
  {
    await begin('42')
    copyMulti(user)
    const before = observe()
    const a = start(testops, {
      DICTATION_HELPER_TEST: '1',
      DICTATION_HELPER_TEST_STATE_TMP_STALL_MS: '60000'
    })
    await a.ready
    void a.req('__clipboard-txn', { text: 'dictated text ST', holdMs: 300 })
    const stalled = await atLine(
      a,
      'its first state write stalled with its .tmp written',
      /test-trace: stall STATE_TMP_STALL_MS/
    )
    await a.kill()
    const left = prefixFiles()
    const after = observe()
    const h = start(release)
    await h.ready
    const listed = await h.req('clipboard-offers')
    check(
      'killed inside its first state write: only a .state.tmp is left, the clipboard untouched (sequence too), nothing offered, the young .tmp left alone',
      !!stalled &&
        left.length === 1 &&
        left[0].endsWith('.state.tmp') &&
        after.text === user &&
        after.extra === 'extra bytes for ' + user &&
        after.sequence === before.sequence &&
        !!listed &&
        listed.offers.length === 0 &&
        prefixFiles().length === 1,
      `${left}; text ${after.text}; sequence ${before.sequence} -> ${after.sequence}; ${JSON.stringify(listed)}; ${listing()}`
    )
    for (const f of prefixFiles()) {
      const old = new Date(Date.now() - 60 * 60 * 1000)
      fs.utimesSync(path.join(os.tmpdir(), f), old, old)
    }
    await h.req('clipboard-offers')
    check(
      'and once older than 10 minutes the stray .state.tmp is deleted by the next look',
      prefixFiles().length === 0 &&
        h.logs.some((l) => /a stray state \.tmp .* was deleted/.test(l)),
      `${listing()}; ${h.logs.filter((l) => /stray/.test(l)).join(' / ')}`
    )
    await h.stop()
  }

  // 34. Round 21, the NULL-window open experiment (decides Opus's lead on the runner's Windows build): process A opens
  // the clipboard with NULL (then with its own message-only window) and holds it; process B calls OpenClipboard(NULL)
  // once, enumerates, and closes at once (or holds); A enumerates again while B acts. One table row per combination.
  {
    await begin('34')
    copyMulti(user)
    // Round 30: A holds at its gate until B has probed (or, holding, sits at its own gate); no timed waits.
    const A = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['CLIPHOLD'] })
    const B = start(testops, { DICTATION_HELPER_TEST: '1' }, { gates: ['CLIPPROBE'] })
    await A.ready
    await B.ready
    console.log(
      '# 34 | A opens with | B then | B opened (error) | B enumeration | A before | A after B | A still the open window | A close (error)'
    )
    const rows = []
    for (const owner of ['null', 'window']) {
      for (const mode of ['closes at once', 'holds']) {
        const markA = A.logs.length
        const markB = B.logs.length
        const holding = A.req('__clip-hold', { owner, waitMs: 1500, holdMs: 1000 })
        await atLine(A, 'A holding the clipboard', /test-trace: clip-hold opened/, { since: markA })
        let probeReply = null
        const probing = B.req('__clip-probe', {
          owner: 'null',
          waitMs: mode === 'holds' ? 1500 : 0,
          holdMs: 0
        }).then((r) => (probeReply = r))
        // B either closed at once (its reply), failed to open (its reply), or holds at its gate.
        await until(
          () =>
            !!probeReply ||
            B.logs.slice(markB).some((l) => /test-trace: gate CLIPPROBE#\d+ waiting/.test(l)),
          20000
        )
        const bHolds = !probeReply
        A.open('CLIPHOLD')
        const held = await holding
        if (bHolds) B.open('CLIPPROBE')
        await probing
        const probe = probeReply
        const stillOpen = held && held.openWindowSecond === held.ownWindow
        const row = `# 34 | ${owner} | ${mode} | ${probe && probe.opened} (${probe && probe.openError}) | ${probe && probe.first} | ${held && held.first} | ${held && held.second} | ${held ? (owner === 'window' ? stillOpen : 'open window ' + held.openWindowSecond) : '?'} | ${held && held.closed} (${held && held.closeError})`
        rows.push({ owner, mode, probe, held })
        console.log(row)
      }
    }
    check(
      'the NULL-window experiment ran (both owners, both probe modes)',
      rows.length === 4 && rows.every((r) => r.held && r.held.opened),
      JSON.stringify(rows)
    )
    // Round 22 (Opus): the rows themselves. NULL: B's open succeeds and A afterwards fails with 1418 (taken over).
    // Its own window: B fails with error 5 and A's listing stays complete.
    const nullRows = rows.filter((r) => r.owner === 'null')
    const windowRows = rows.filter((r) => r.owner === 'window')
    check(
      'CI 34, the NULL row: B opens over A; A then lists nothing with error 1418',
      nullRows.length === 2 &&
        nullRows.every(
          (r) =>
            r.probe &&
            r.probe.opened === true &&
            /^listed 0 error 1418 /.test(String(r.held.second))
        ),
      JSON.stringify(nullRows)
    )
    check(
      "CI 34, the window row: B's open fails with error 5; A's listing stays complete",
      windowRows.length === 2 &&
        windowRows.every(
          (r) =>
            r.probe &&
            r.probe.opened === false &&
            r.probe.openError === 5 &&
            /^listed (\d+) error 0 counted \1$/.test(String(r.held.second)) &&
            r.held.second === r.held.first
        ),
      JSON.stringify(windowRows)
    )
    await A.stop()
    await B.stop()
  }

  // 31. Several input languages (Opus round 17): the write thread on another layout (test hook: 00000419, 00000415),
  // and this test process's thread on a third: the CF_LOCALE Windows stamps is the one the helper pinned, and the
  // confirmation passes (the dictation is restored, not left as an offer).
  {
    const LoadKeyboardLayoutW = user32.func(
      'void* __stdcall LoadKeyboardLayoutW(str16 klid, uint32 flags)'
    )
    const GetKeyboardLayout = user32.func('void* __stdcall GetKeyboardLayout(uint32 thread)')
    const ActivateKeyboardLayout = user32.func(
      'void* __stdcall ActivateKeyboardLayout(void* hkl, uint32 flags)'
    )
    const previousLayout = GetKeyboardLayout(0) // restored at the end (CI-only: a real desktop's language stays as it was)
    const mine = LoadKeyboardLayoutW('00000411', 1)
    console.log(
      `# this process's thread layout: ${mine ? '00000411 loaded' : 'could not be loaded'}`
    )
    try {
      for (const layout of ['00000419', '00000415', '']) {
        await begin(`31 ${layout || 'default'}`)
        copyMulti(user)
        const a = start(
          testops,
          {
            DICTATION_HELPER_TEST: '1',
            ...(layout ? { DICTATION_HELPER_TEST_KEYBOARD_LAYOUT: layout } : {})
          },
          { gates: ['HOLD'] }
        )
        await a.ready
        const dictated = 'dictated text Ж ' + (layout || 'default')
        const reply = a.req('__clipboard-txn', { text: dictated })
        await atLine(a, 'our write confirmed and held', HOLDING)
        const stamped = readFormat(16)
        a.open('HOLD')
        const result = await reply
        const forms = await a.req('__text-forms', { text: 'x', locale: 0 })
        const pinned = forms && forms.lastWriteLocale
        console.log(
          `# write thread layout ${layout || '(default)'}: pinned 0x${(pinned || 0).toString(16)}, stamped 0x${stamped && stamped.readUInt32LE(0).toString(16)}`
        )
        check(
          `write thread layout ${layout || '(default)'}: the layout ACTIVATED, Windows stamps the pinned locale (0x${(pinned || 0).toString(16)}) and the confirmation passes`,
          !!stamped &&
            (!layout || pinned === (parseInt(layout, 16) & 0xffff)) &&
            stamped.readUInt32LE(0) === pinned &&
            !!result &&
            /^restored\|/.test(String(result.result)),
          `stamped 0x${stamped && stamped.readUInt32LE(0).toString(16)}; pinned 0x${(pinned || 0).toString(16)}; ${JSON.stringify(result)}`
        )
        await a.stop()
      }
    } finally {
      if (previousLayout) ActivateKeyboardLayout(previousLayout, 0)
    }
  }

  // Round 30: the last case is verified like every other (its processes exited, nothing of this identity left).
  await begin('(the end of the run)')
  check(
    `every one of ${casesBegun - 1} cases started from a verified clean state`,
    dirtyAfter.length === 0,
    dirtyAfter.join('; ')
  )
}

main()
  .catch((error) => {
    console.error(error)
    // Round 31: an exception is a failed check with its diagnostics, like any other failure.
    check(
      `the run ended without an exception (in case ${frame.label})`,
      false,
      String((error && error.stack) || error)
    )
  })
  .finally(async () => {
    // Round 31: as on the normal path, every tracked child is terminated and its exit awaited before the files go.
    if (!(await terminateAll()))
      console.log(
        `# still running at the end: ${running()
          .map((s) => `${s.label} pid ${s.child.pid}`)
          .join(', ')}`
      )
    cleanup()
    fs.rmSync(gateRoot, { recursive: true, force: true })
    console.log(`# seeds: ${seeds.ok} held, ${seeds.failed} failed`)
    for (const [group, t] of Object.entries(saveTally)) {
      console.log(
        `# saves ${group}: ${t.saves} saves, ${t.firstTry} established on the first try, ${t.retried} established after a retry, ${t.noSave} ended no-save`
      )
      for (const l of t.lines.slice(0, 60)) console.log(`# saves ${group} | ${l}`)
      if (t.lines.length > 60) console.log(`# saves ${group} | (${t.lines.length - 60} more lines)`)
    }
    const failed = results.filter((ok) => !ok).length
    console.log(`# ${results.length - failed}/${results.length} passed`)
    process.exit(failed === 0 && results.length > 0 ? 0 : 1)
  })
