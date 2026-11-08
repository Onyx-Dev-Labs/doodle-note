import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HelperIntegrity,
  MAX_LOST_HOLDS,
  peHasCertificateTable,
  resolveHelperExpectation,
  stableHelperDigest,
  type HeldHelperLike,
  type HelperExpectation,
  type HelperHolder,
  type SignatureCheck
} from './helper-integrity'
import { peLayout, stableDigest } from '../../scripts/authenticode-digest.mjs'
import { HelperChecker, classifyTrustResult, type FfiLike } from './windows-helper-check'
import { DictationHelperClient } from './dictation-helper-client'

const require = createRequire(import.meta.url)
const scriptDigest = require('../../scripts/authenticode-digest.mjs') as {
  stableDigest: (buffer: Buffer) => string | null
}
const writer = require('../../scripts/write-dictation-helper-manifest.cjs') as {
  main: (
    path: string,
    options: {
      inspectSigner?: (path: string) => { status: string; cn: string; thumbprint: string }
      configuredCn?: string | null
      quiet?: boolean
    }
  ) => Record<string, unknown>
}

const PE = 0x80
const OPTIONAL = PE + 24
const SEC_ENTRY = OPTIONAL + 112 + 32
const SECTION_TABLE = OPTIONAL + 240

/**
 * A minimal PE32+ image: headers [0, 0x200), sections .text [0x200, 0x400) and .data
 * [0x400, 0x600), then `trailing` extra bytes. sign() adds the zero padding to 8 and a certificate
 * table the way signers do and rewrites the CheckSum and the table directory entry.
 */
function fakePe(trailing = 0, fill = 0x11): Buffer {
  const image = Buffer.alloc(0x600 + trailing, fill)
  image.fill(0, 0, 0x200)
  image.writeUInt16LE(0x5a4d, 0)
  image.writeUInt32LE(PE, 0x3c)
  image.writeUInt32LE(0x00004550, PE)
  image.writeUInt16LE(2, PE + 6)
  image.writeUInt16LE(240, PE + 20)
  image.writeUInt16LE(0x20b, OPTIONAL)
  image.writeUInt32LE(0x200, OPTIONAL + 60) // SizeOfHeaders
  image.writeUInt32LE(0x12345678, OPTIONAL + 64) // CheckSum
  image.writeUInt32LE(16, OPTIONAL + 108)
  section(image, 0, 0x200, 0x200)
  section(image, 1, 0x200, 0x400)
  return image
}
function section(image: Buffer, index: number, size: number, pointer: number): void {
  image.writeUInt32LE(size, SECTION_TABLE + 40 * index + 16)
  image.writeUInt32LE(pointer, SECTION_TABLE + 40 * index + 20)
}
function sign(unsigned: Buffer, tableSize = 0x300): Buffer {
  const pad = (8 - (unsigned.length % 8)) % 8
  const signed = Buffer.concat([unsigned, Buffer.alloc(pad), Buffer.alloc(tableSize, 0xcc)])
  signed.writeUInt32LE(unsigned.length + pad, SEC_ENTRY)
  signed.writeUInt32LE(tableSize, SEC_ENTRY + 4)
  signed.writeUInt32LE(0x9abcdef0, OPTIONAL + 64)
  return signed
}
function pointTable(image: Buffer, va: number, size: number): Buffer {
  const copy = Buffer.from(image)
  copy.writeUInt32LE(va, SEC_ENTRY)
  copy.writeUInt32LE(size, SEC_ENTRY + 4)
  return copy
}

test('the digest is unchanged by signing, aligned or not, and changed by trailing data', () => {
  for (const trailing of [0, 3, 5, 0x40]) {
    const unsigned = fakePe(trailing)
    const signed = sign(unsigned)
    assert.equal(peHasCertificateTable(signed), true)
    assert.equal(stableHelperDigest(signed), stableHelperDigest(unsigned), `trailing ${trailing}`)
    assert.notEqual(
      stableHelperDigest(Buffer.concat([signed, Buffer.from('x')])),
      stableHelperDigest(signed)
    )
  }
  const patched = Buffer.from(fakePe())
  patched[0x450] ^= 0xff
  assert.notEqual(stableHelperDigest(patched), stableHelperDigest(fakePe()))
})

test('the reviewer bypass is closed: a certificate table aimed at a copy of modified code', () => {
  // Duplicate .text after the sections, modify the original, point the security directory at the
  // copy: the excluded range would hide the copy while the modified original runs.
  const original = fakePe()
  const textCopy = original.subarray(0x200, 0x400)
  const attacked = Buffer.concat([original, textCopy])
  attacked[0x210] ^= 0xff // the code that is actually mapped
  const aimedAtCopy = pointTable(attacked, 0x600, 0x200)
  // ...and the variant that aims the table straight at the modified section itself.
  const aimedAtSection = pointTable(attacked, 0x200, 0x200)
  assert.notEqual(stableHelperDigest(aimedAtCopy), stableHelperDigest(original))
  assert.equal(stableHelperDigest(aimedAtSection), null)
})

test('malformed layouts are rejected: overlaps, truncation, a table before the end of sections', () => {
  const signed = sign(fakePe())
  const cases: Record<string, Buffer> = {
    'table overlapping the last section': pointTable(signed, 0x500, 0x200),
    'table inside a section': pointTable(signed, 0x400, 0x100),
    'table inside the headers': pointTable(signed, 0x100, 0x80),
    'table past the end of the file': pointTable(signed, 0x600, 0x10000),
    'misaligned table': pointTable(signed, 0x601, 0x100),
    'zero-size table with an address': pointTable(signed, 0x600, 0)
  }
  const overlap = fakePe()
  section(overlap, 1, 0x200, 0x300) // .data starts inside .text
  cases['overlapping sections'] = overlap
  const truncated = fakePe()
  section(truncated, 1, 0x400, 0x400) // runs past the end of the file
  cases['truncated section'] = truncated
  const intoHeaders = fakePe()
  section(intoHeaders, 0, 0x200, 0x100) // section raw data inside the headers
  cases['section inside the headers'] = intoHeaders
  const smallHeaders = fakePe()
  smallHeaders.writeUInt32LE(0x100, OPTIONAL + 60) // SizeOfHeaders before the end of the section table
  cases['headers too small for the section table'] = smallHeaders
  const noSections = fakePe()
  noSections.writeUInt16LE(0, PE + 6)
  cases['no sections'] = noSections
  for (const [name, image] of Object.entries(cases)) {
    assert.equal(stableHelperDigest(image), null, name)
    assert.equal(scriptDigest.stableDigest(image), null, `${name} (build script)`)
  }
  assert.equal(stableHelperDigest(Buffer.from('not a pe image at all, just text......')), null)
})

test('one digest implementation: the app, the worker and the build scripts import the same module', () => {
  for (const sample of [
    fakePe(5),
    sign(fakePe(5)),
    Buffer.concat([sign(fakePe()), Buffer.from('x')])
  ]) {
    assert.equal(stableHelperDigest(sample), stableDigest(sample))
    assert.equal(
      stableHelperDigest(sample),
      scriptDigest.stableDigest(sample),
      'require() from CJS'
    )
  }
  assert.equal(scriptDigest.stableDigest, stableDigest, 'the very same function object')
  const sources = ['helper-integrity.ts', 'windows-helper-check.ts']
  for (const name of sources) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
    assert.match(text, /from '\.\.\/\.\.\/scripts\/authenticode-digest\.mjs'/, name)
    assert.doesNotMatch(
      text,
      /createHash\('sha256'\)[\s\S]{0,200}checksumOffset/,
      `${name}: no second copy`
    )
  }
  for (const script of ['write-dictation-helper-manifest.cjs', 'test-dictation-helper-win.cjs']) {
    const text = readFileSync(new URL(`../../scripts/${script}`, import.meta.url), 'utf8')
    assert.match(text, /require\('\.\/authenticode-digest\.mjs'\)/, script)
  }
  assert.equal(
    existsSync(new URL('../../scripts/authenticode-digest.cjs', import.meta.url)),
    false,
    'the old CommonJS twin is gone'
  )
  const real = fileURLToPath(
    new URL('../../../../engine/.build/windows/dictation-helper.exe', import.meta.url)
  )
  if (existsSync(real))
    assert.ok(stableHelperDigest(readFileSync(real)), 'the real helper is contiguous')
})

test('a layout with a gap between sections (or after the headers) is rejected, by the app and the build', () => {
  const gapped = Buffer.concat([fakePe(), Buffer.alloc(0x200, 0x22)])
  section(gapped, 1, 0x200, 0x600) // .data moved past an unhashed 0x200-byte gap at 0x400
  assert.equal(peLayout(gapped), null, 'gap between sections')
  assert.equal(stableHelperDigest(gapped), null)
  const afterHeaders = Buffer.concat([fakePe(), Buffer.alloc(0x200, 0x22)])
  section(afterHeaders, 0, 0x200, 0x400)
  section(afterHeaders, 1, 0x200, 0x600) // .text starts 0x200 after SizeOfHeaders
  assert.equal(peLayout(afterHeaders), null, 'gap after the headers')
  assert.ok(peLayout(fakePe()), 'the contiguous fixture is accepted')
  // The build refuses it too (the manifest writer asserts the layout).
  assert.throws(
    () => writer.main(helperFile(gapped), { configuredCn: null, quiet: true }),
    /contiguous sections/
  )
})

test('every WinVerifyTrust result is classified (definitive tampering vs chain trust)', () => {
  assert.equal(classifyTrustResult(0).status, 'valid')
  assert.deepEqual(classifyTrustResult(0x80096010 | 0), { status: 'invalid', code: 'HashMismatch' })
  assert.deepEqual(classifyTrustResult(0x800b0100 | 0), { status: 'invalid', code: 'NotSigned' })
  assert.deepEqual(classifyTrustResult(0x80096004 | 0), {
    status: 'invalid',
    code: 'BadCertSignature'
  })
  for (const chain of [0x800b0109, 0x800b010a, 0x800b0101, 0x800b0111, 0x80092026])
    assert.equal(classifyTrustResult(chain | 0).status, 'unavailable', chain.toString(16))
  assert.match(
    (classifyTrustResult(0x80004005 | 0) as { reason: string }).reason,
    /UnknownError 0x80004005/
  )
})

/** A fake Win32 surface for the worker's checker: files in a map, handles that deny writes. */
function fakeFfi(files: Map<string, Buffer>): { ffi: FfiLike; open: Set<number>; log: string[] } {
  const open = new Set<number>()
  const log: string[] = []
  let nextHandle = 100
  const handles = new Map<number, { path: string; at: number }>()
  const fn = (
    impl: (...args: unknown[]) => unknown
  ): ((...args: unknown[]) => unknown) & {
    async: (...args: unknown[]) => void
  } =>
    Object.assign(impl, {
      async: (...args: unknown[]) =>
        setImmediate(() => (args.pop() as (e: unknown, r: unknown) => void)(null, impl(...args)))
    })
  const table: Record<string, ReturnType<typeof fn>> = {
    CreateFileW: fn((path) => {
      if (!files.has(String(path))) return { address: 0xffffffffffffffffn }
      const handle = nextHandle++
      handles.set(handle, { path: String(path), at: 0 })
      open.add(handle)
      log.push(`open ${String(path)}`)
      return { address: BigInt(handle) }
    }),
    CloseHandle: fn((handle) => {
      const id = Number((handle as { address: bigint }).address)
      open.delete(id)
      log.push(`close ${id}`)
      return true
    }),
    GetFileSizeEx: fn((handle, out) => {
      const entry = handles.get(Number((handle as { address: bigint }).address))!
      ;(out as number[])[0] = files.get(entry.path)!.length
      return true
    }),
    ReadFile: fn((handle, buffer, count, read) => {
      const entry = handles.get(Number((handle as { address: bigint }).address))!
      const bytes = files.get(entry.path)!
      const n = bytes.copy(buffer as Buffer, 0, entry.at, entry.at + Number(count))
      entry.at += n
      ;(read as number[])[0] = n
      return true
    }),
    WinVerifyTrust: fn(() => 0x800b0109 | 0)
  }
  const ffi: FfiLike = {
    load: () => ({
      func: (definition: string) => {
        const name = /__stdcall (\w+)\(/.exec(definition)?.[1] ?? ''
        return table[name] ?? fn(() => null)
      }
    }),
    struct: (name) => name,
    pointer: (type) => type,
    array: (type) => type,
    sizeof: () => 8,
    decode: () => null,
    address: (value) => (value as { address: bigint }).address
  }
  return { ffi, open, log }
}

test('the worker holds the helper open from the read until release, and never past its limit', async () => {
  const image = fakePe()
  const files = new Map([['C:\\h\\dictation-helper.exe', image]])
  const { ffi, open, log } = fakeFfi(files)
  const checker = new HelperChecker(() => ffi, 60)
  const reply = checker.hold(1, 'C:\\h\\dictation-helper.exe')
  assert.equal(reply.ok, true)
  if (!reply.ok) return
  assert.equal(
    reply.digest,
    stableHelperDigest(image),
    'hashed from the bytes read through the handle'
  )
  assert.equal(reply.signed, false)
  assert.equal(open.size, 1, 'the handle stays open after the read')
  assert.equal(checker.held(1), true)
  const trust = await checker.trust(1)
  assert.equal(trust.status, 'unavailable', 'an untrusted root is chain trust, not tampering')
  checker.release(1)
  assert.equal(open.size, 0)
  assert.equal(checker.held(1), false)
  assert.deepEqual(checker.hold(2, 'C:\\missing.exe'), { ok: false, code: 'ENOENT' })
  checker.hold(3, 'C:\\h\\dictation-helper.exe')
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(open.size, 0, 'a hold nobody released ends by itself')
  assert.ok(log.filter((line) => line.startsWith('open')).length === 2)
})

/**
 * A scripted holder standing in for the speech worker: reads the file when asked to hold (as the
 * worker does through its handle) and can end at chosen moments, like a killed worker.
 */
function fakeHolder(
  answer: SignatureCheck | 'hang',
  options: {
    /** 'reject': the worker cannot start; 'hang': it never answers; 'late': it answers after 120 ms. */
    hold?: 'ok' | 'reject' | 'hang' | 'late'
    /** When the worker dies: during the signature check, or before the spawn returns (confirm). */
    dies?: 'during-trust' | 'before-confirm'
    /** Only the first N holds die (later ones are healthy). */
    dyingHolds?: number
  } = {}
): { holder: HelperHolder; log: string[]; holds: () => number } {
  const log: string[] = []
  let count = 0
  const holder: HelperHolder = async (path) => {
    count += 1
    const index = count
    log.push(`hold ${index}`)
    if (options.hold === 'reject') throw new Error('the speech worker could not be started')
    if (options.hold === 'hang') return new Promise<HeldHelperLike>(() => {})
    if (options.hold === 'late') await new Promise((resolve) => setTimeout(resolve, 120))
    const dying = options.dies !== undefined && index <= (options.dyingHolds ?? Infinity)
    let alive = true
    let facts: HeldHelperLike['facts']
    try {
      const { readFileSync: read } = await import('node:fs')
      const { statSync } = await import('node:fs')
      if (statSync(path).isDirectory()) throw Object.assign(new Error('dir'), { code: 'EISDIR' })
      const bytes = read(path)
      const { createHash } = await import('node:crypto')
      facts = {
        status: 'held',
        fileSha256: createHash('sha256').update(bytes).digest('hex'),
        digest: stableHelperDigest(bytes),
        signed: peHasCertificateTable(bytes)
      }
    } catch (error) {
      facts =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { status: 'absent' }
          : { status: 'unreadable', code: 'EIO' }
    }
    return {
      facts,
      alive: () => alive,
      trust: async () => {
        log.push(`trust ${index}`)
        if (dying && options.dies === 'during-trust') {
          alive = false
          return { status: 'unavailable', reason: 'the speech worker ended' }
        }
        return answer === 'hang' ? new Promise<SignatureCheck>(() => {}) : answer
      },
      confirm: async () => {
        log.push(`confirm ${index}`)
        if (dying && options.dies === 'before-confirm') alive = false
        return alive
      },
      release: () => {
        log.push(`release ${index}`)
        alive = false
      }
    }
  }
  return { holder, log, holds: () => count }
}

function helperFile(buffer: Buffer, manifest?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-'))
  const helper = join(dir, 'dictation-helper.exe')
  writeFileSync(helper, buffer)
  if (manifest) writeFileSync(join(dir, 'dictation-helper.manifest.json'), JSON.stringify(manifest))
  return helper
}

function integrity(
  helperPath: string,
  expectation: HelperExpectation | (() => HelperExpectation | null) | null,
  holder: HelperHolder | null,
  extra: {
    cachePath?: string | null
    budgetMs?: number
    holdBudgetMs?: number
    holdRetryCooldownMs?: number
    leaseMaxMs?: number
    confirmBudgetMs?: number
    confirmCapMs?: number
  } = {}
): HelperIntegrity {
  return new HelperIntegrity({
    helperPath,
    expectation: typeof expectation === 'function' ? expectation : () => expectation,
    holder,
    cachePath: extra.cachePath ?? null,
    ...(extra.budgetMs !== undefined ? { budgetMs: extra.budgetMs } : {}),
    ...(extra.holdBudgetMs !== undefined ? { holdBudgetMs: extra.holdBudgetMs } : {}),
    ...(extra.holdRetryCooldownMs !== undefined
      ? { holdRetryCooldownMs: extra.holdRetryCooldownMs }
      : {}),
    ...(extra.leaseMaxMs !== undefined ? { leaseMaxMs: extra.leaseMaxMs } : {}),
    ...(extra.confirmBudgetMs !== undefined ? { confirmBudgetMs: extra.confirmBudgetMs } : {}),
    ...(extra.confirmCapMs !== undefined ? { confirmCapMs: extra.confirmCapMs } : {})
  })
}

const valid = (subjectCn: string, thumbprint = 'AA11'): SignatureCheck => ({
  status: 'valid',
  subjectCn,
  thumbprint
})
const CN = 'Onyx Dev Labs LLC'

test('lazy, and the file stays held from before it is read until the lease is released', async () => {
  const buffer = fakePe()
  const worker = fakeHolder(valid(CN))
  const check = integrity(
    helperFile(buffer),
    { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] },
    worker.holder
  )
  assert.equal(check.state(), 'unchecked')
  assert.deepEqual(worker.log, [], 'nothing runs before it is needed')
  const lease = await check.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, true)
  assert.deepEqual(worker.log, ['hold 1'], 'unsigned: held, no signature check')
  assert.equal(await lease.confirm(), true, 'still held when the spawn returns')
  lease.release()
  assert.deepEqual(worker.log, ['hold 1', 'confirm 1', 'release 1'])
  assert.equal(check.lastBranch, 'digest')
})

test('fail closed on everything that is not a matching helper', async () => {
  const buffer = fakePe()
  const expectation = { digest: stableHelperDigest(buffer)!, publisherCn: null, thumbprints: [] }
  const w = (): HelperHolder => fakeHolder(valid(CN)).holder
  assert.equal(await integrity(helperFile(buffer), null, w()).ensure(), 'damaged')
  assert.equal(
    await integrity(helperFile(Buffer.from('garbage')), expectation, w()).ensure(),
    'damaged'
  )
  const changed = Buffer.from(buffer)
  changed[0x300] ^= 1
  assert.equal(await integrity(helperFile(changed), expectation, w()).ensure(), 'damaged')
  const missing = join(tmpdir(), 'no-such-dir-bark', 'dictation-helper.exe')
  assert.equal(await integrity(missing, expectation, w()).ensure(), 'absent')
  assert.equal(await integrity(missing, expectation, null).ensure(), 'absent', 'by path too')
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-dir-'))
  assert.equal(await integrity(dir, expectation, w()).ensure(), 'damaged')
  assert.equal(await integrity(dir, expectation, null).ensure(), 'damaged', 'by path too')
})

test('signed: exact CN and recorded thumbprint; definitive tampering is damaged', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: ['AA11'] }
  const run = async (answer: SignatureCheck): Promise<string> =>
    integrity(path, expect, fakeHolder(answer).holder).ensure()
  assert.equal(await run(valid(CN)), 'ok')
  assert.equal(await run(valid(`${CN} Evil`)), 'damaged', 'a substring is not enough')
  assert.equal(await run(valid('Onyx Dev Labs')), 'damaged')
  assert.equal(await run(valid(CN, 'BB22')), 'damaged', 'not a certificate this build used')
  assert.equal(await run({ status: 'invalid', code: 'HashMismatch' }), 'damaged')
  assert.equal(await run({ status: 'invalid', code: 'NotSigned' }), 'damaged')
})

test('chain-trust failures fall back to the digest and are not cached; no hold means digest only, locked:false', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const cachePath = join(mkdtempSync(join(tmpdir(), 'bark-cache-')), 'cache.json')
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: [] }
  for (const reason of ['NotTrusted 0x800b0109', 'UnknownError 0x80004005', 'signer unreadable']) {
    const worker = fakeHolder({ status: 'unavailable', reason })
    const check = integrity(path, expect, worker.holder, { cachePath })
    assert.equal(await check.ensure(), 'ok', reason)
    assert.equal(check.lastBranch, 'signature-unavailable', reason)
    assert.equal(existsSync(cachePath), false, `${reason} is not persisted`)
  }
  // The next spawn verifies again (here: a definitive answer, which is persisted).
  const again = fakeHolder(valid(CN))
  assert.equal(await integrity(path, expect, again.holder, { cachePath }).ensure(), 'ok')
  assert.ok(again.log.includes('trust 1'))
  assert.ok(existsSync(cachePath))
  // The worker cannot start: the digest decides, read by path, and the verdict says unlocked.
  const noWorker = integrity(path, expect, fakeHolder(valid(CN), { hold: 'reject' }).holder)
  const lease = await noWorker.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, false)
  assert.equal(await lease.confirm(), false, 'an unlocked lease never claims a hold')
  assert.match(noWorker.lastUnlockedReason ?? '', /holder failed/)
  // A digest mismatch is damaged whatever the signature says.
  assert.equal(
    await integrity(
      path,
      { ...expect, digest: '0'.repeat(64) },
      fakeHolder(valid(CN)).holder
    ).ensure(),
    'damaged'
  )
})

test('a worker that ends during the check invalidates the lease; the check runs again on a fresh hold', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: [] }
  const worker = fakeHolder(valid(CN), { dies: 'during-trust', dyingHolds: 1 })
  const check = integrity(path, expect, worker.holder)
  const lease = await check.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, true, 'locked, by the second (live) hold')
  assert.deepEqual(worker.log.slice(0, 4), ['hold 1', 'trust 1', 'release 1', 'hold 2'])
  assert.ok(worker.log.includes('trust 2'), 'the signature is checked again on the fresh hold')
  assert.equal(await lease.confirm(), true)
  lease.release()
})

test('a hold lost before the spawn returns fails confirm(); after repeated losses the check is digest-only', async () => {
  const buffer = fakePe()
  const path = helperFile(buffer)
  const expect = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  const worker = fakeHolder(valid(CN), { dies: 'before-confirm' })
  const check = integrity(path, expect, worker.holder)
  for (let lost = 0; lost < MAX_LOST_HOLDS; lost++) {
    const lease = await check.acquire()
    assert.equal(lease.locked, true)
    assert.equal(
      await lease.confirm(),
      false,
      `loss ${lost + 1}: the hold was gone after the spawn`
    )
    lease.release()
  }
  const holdsBefore = worker.holds()
  const last = await check.acquire()
  assert.equal(last.verdict, 'ok', 'the digest still decides')
  assert.equal(last.locked, false, 'and says plainly that nothing is held')
  assert.equal(worker.holds(), holdsBefore, 'no further hold was attempted')
  assert.match(check.lastUnlockedReason ?? '', /digest only/)
})

test('digest-only after repeated lost holds is not sticky: the held path is tried again after the cooldown', async () => {
  const buffer = fakePe()
  const path = helperFile(buffer)
  const expect = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  const worker = fakeHolder(valid(CN), { dies: 'before-confirm', dyingHolds: MAX_LOST_HOLDS })
  const check = integrity(path, expect, worker.holder, { holdRetryCooldownMs: 60 })
  const seen: boolean[] = []
  check.onChange(() => seen.push(check.lastLocked))
  for (let lost = 0; lost < MAX_LOST_HOLDS; lost++) {
    const lease = await check.acquire()
    await lease.confirm()
    lease.release()
  }
  const fallback = await check.acquire()
  assert.equal(fallback.locked, false, 'within the cooldown: digest only')
  assert.equal(check.lastLocked, false, 'the status row can show it')
  fallback.release()
  await new Promise((resolve) => setTimeout(resolve, 80))
  const again = await check.acquire()
  assert.equal(again.locked, true, 'after the cooldown the worker holds the file again')
  assert.equal(await again.confirm(), true)
  again.release()
  assert.equal(check.lastLocked, true)
  assert.ok(seen.includes(false) && seen.at(-1) === true, 'listeners heard the locked state change')
})

test('the budgets: a worker that does not answer the hold, or the signature, is not waited for', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: [] }
  const started = Date.now()
  const silent = integrity(path, expect, fakeHolder(valid(CN), { hold: 'hang' }).holder, {
    holdBudgetMs: 60
  })
  const lease = await silent.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, false, 'no hold within the budget: digest only')
  const lateWorker = fakeHolder(valid(CN), { hold: 'late' })
  const late = await integrity(path, expect, lateWorker.holder, { holdBudgetMs: 30 }).acquire()
  assert.equal(late.locked, false)
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.deepEqual(
    lateWorker.log,
    ['hold 1', 'release 1'],
    'a hold that answers too late is let go at once'
  )
  const slowVerdict = fakeHolder('hang')
  const slow = integrity(path, expect, slowVerdict.holder, { budgetMs: 60 })
  assert.equal(await slow.ensure(), 'ok')
  assert.equal(slow.lastBranch, 'signature-unavailable')
  assert.ok(Date.now() - started < 2_000)
  const forgotten = fakeHolder(valid(CN))
  const held = await integrity(path, expect, forgotten.holder, { leaseMaxMs: 30 }).acquire()
  assert.equal(held.locked, true)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.ok(forgotten.log.includes('release 1'), 'an unreleased lease does not keep the hold')
})

test('the cache is keyed on the whole file and the whole expectation', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const cachePath = join(mkdtempSync(join(tmpdir(), 'bark-cache-')), 'cache.json')
  let expect: HelperExpectation = {
    digest: stableHelperDigest(signed)!,
    publisherCn: CN,
    thumbprints: []
  }
  const first = fakeHolder(valid(CN))
  assert.equal(await integrity(path, () => expect, first.holder, { cachePath }).ensure(), 'ok')
  const relaunch = fakeHolder(valid(CN))
  const relaunched = integrity(path, () => expect, relaunch.holder, { cachePath })
  assert.equal(await relaunched.ensure(), 'ok')
  assert.deepEqual(
    relaunch.log,
    ['hold 1', 'release 1'],
    'a cached verdict skips the signature check (the file is still held)'
  )
  // Corrupt the certificate table only (the signing-invariant digest is unchanged): re-verified.
  const corrupted = Buffer.from(signed)
  corrupted[corrupted.length - 10] ^= 0xff
  writeFileSync(path, corrupted)
  const afterCorruption = fakeHolder({ status: 'invalid', code: 'HashMismatch' })
  assert.equal(
    await integrity(path, () => expect, afterCorruption.holder, { cachePath }).ensure(),
    'damaged'
  )
  assert.ok(afterCorruption.log.includes('trust 1'))
  // A different expectation (another pinned thumbprint) is never answered from the old verdict.
  writeFileSync(path, signed)
  expect = { ...expect, thumbprints: ['ZZ99'] }
  const newPin = fakeHolder(valid(CN, 'AA11'))
  assert.equal(
    await integrity(path, () => expect, newPin.holder, { cachePath }).ensure(),
    'damaged'
  )
  assert.ok(newPin.log.includes('trust 1'))
})

test('a build that signed its helper must ship it signed', async () => {
  const unsigned = fakePe()
  const expect = { digest: stableHelperDigest(unsigned)!, publisherCn: CN, thumbprints: ['AA11'] }
  assert.equal(
    await integrity(helperFile(unsigned), expect, fakeHolder(valid(CN)).holder).ensure(),
    'damaged'
  )
})

test('production never starts PowerShell to check the helper', () => {
  for (const name of [
    'helper-integrity.ts',
    'dictation-host.ts',
    'windows-helper-check.ts',
    'engine-host-win.ts'
  ]) {
    const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /powershell\.exe|Get-AuthenticodeSignature|win-authenticode/i, name)
  }
  assert.equal(existsSync(new URL('./win-authenticode.ts', import.meta.url)), false)
})

test('packaged builds trust only the baked expectation, never the manifest beside the helper', () => {
  const buffer = fakePe()
  const forged = { authenticodeSha256: 'f'.repeat(64), publisherCn: 'Anyone', thumbprints: [] }
  const path = helperFile(buffer, forged)
  const baked = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  assert.deepEqual(resolveHelperExpectation(path, true, baked), baked)
  assert.equal(resolveHelperExpectation(path, true, null), null)
  assert.equal(resolveHelperExpectation(path, false, baked)?.digest, 'f'.repeat(64))
  const malformed = helperFile(buffer)
  writeFileSync(join(malformed, '..', 'dictation-helper.manifest.json'), '{ not json')
  assert.equal(resolveHelperExpectation(malformed, false, baked), null)
})

test('the manifest records the signer whenever the helper is already signed (build -> sign -> manifest)', () => {
  const unsignedPath = helperFile(fakePe())
  const unsignedManifest = writer.main(unsignedPath, { configuredCn: null, quiet: true })
  assert.equal(unsignedManifest.signed, false)
  assert.deepEqual(unsignedManifest.thumbprints, [])
  const signedImage = sign(fakePe())
  const signedPath = helperFile(signedImage)
  const manifest = writer.main(signedPath, {
    configuredCn: null,
    quiet: true,
    inspectSigner: () => ({ status: 'Valid', cn: CN, thumbprint: 'ab12cd' })
  })
  assert.equal(manifest.signed, true)
  assert.equal(manifest.publisherCn, CN)
  assert.deepEqual(manifest.thumbprints, ['AB12CD'])
  assert.equal(manifest.authenticodeSha256, stableHelperDigest(signedImage))
  assert.equal(
    manifest.authenticodeSha256,
    unsignedManifest.authenticodeSha256,
    'same digest before and after signing'
  )
  assert.throws(
    () =>
      writer.main(signedPath, {
        configuredCn: 'Someone Else',
        quiet: true,
        inspectSigner: () => ({ status: 'Valid', cn: CN, thumbprint: 'ab12cd' })
      }),
    /not the expected "Someone Else"/
  )
})

test('package:win writes the manifest after the helper build (and any signing) and before bundling', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const script: string = pkg.scripts['package:win']
  const at = (needle: string): number => script.indexOf(needle)
  const build = at('build-dictation-helper-win.cjs')
  const manifest = at('write-dictation-helper-manifest.cjs')
  const bundle = at('electron-vite build')
  const builder = at('electron-builder')
  assert.ok(build >= 0 && manifest > build && bundle > manifest && builder > bundle, script)
  const signing = at('sign-windows')
  if (signing >= 0) assert.ok(signing > build && signing < manifest, script)
  const vite = readFileSync(new URL('../../electron.vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /__DOODLENOTE_HELPER_INTEGRITY__: helperIntegrity\(\)/)
})

/** A holder whose confirmations are scripted per hold: `answers[hold-1][n]` for the n-th confirm. */
function scriptedHolder(
  answers: Array<Array<boolean | 'never'>>,
  options: { aliveFor?: number } = {}
): { holder: HelperHolder; log: string[] } {
  const log: string[] = []
  let count = 0
  const holder: HelperHolder = async (path) => {
    count += 1
    const index = count
    log.push(`hold ${index}`)
    const bytes = readFileSync(path)
    let alive = true
    if (options.aliveFor !== undefined) setTimeout(() => (alive = false), options.aliveFor)
    let asked = 0
    return {
      facts: {
        status: 'held',
        fileSha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'),
        digest: stableHelperDigest(bytes),
        signed: false
      },
      alive: () => alive,
      trust: async () => ({ status: 'unavailable', reason: 'unsigned' }),
      confirm: () => {
        const answer = (answers[index - 1] ?? [])[asked] ?? true
        asked += 1
        log.push(`confirm ${index}.${asked} -> ${String(answer)}`)
        if (answer === 'never') return new Promise<boolean>(() => {})
        if (answer === false) alive = false
        return Promise.resolve(answer)
      },
      release: () => {
        log.push(`release ${index}`)
        alive = false
      }
    }
  }
  return { holder, log }
}

/** A stand-in helper (Node) that logs each start and answers status. */
function countingHelper(): { command: string; args: string[]; starts: () => number } {
  const dir = mkdtempSync(join(tmpdir(), 'bark-compose-'))
  const script = join(dir, 'helper.js')
  const log = join(dir, 'starts.txt')
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
    send({ event: 'reply', id: req.id, ok: true, accessibility: true, inputMonitoring: true, platform: 'win32' })
  }
})
process.stdin.on('end', () => process.exit(0))
`
  )
  return {
    command: process.execPath,
    args: [script, log],
    starts: () =>
      existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
  }
}

test('composition: pre-spawn successes never erase post-spawn losses; the launch falls to digest-only and serves', async () => {
  const buffer = fakePe()
  const path = helperFile(buffer)
  const expect = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  // Every hold: confirmed before the spawn, lost after it (Astra's alternating sequence).
  const worker = scriptedHolder([
    [true, false],
    [true, false],
    [true, false]
  ])
  const check = integrity(path, expect, worker.holder)
  const fake = countingHelper()
  const client = new DictationHelperClient({
    command: fake.command,
    args: fake.args,
    platform: 'win32',
    verify: async () => {
      const lease = await check.acquire()
      return {
        ok: lease.verdict === 'ok',
        locked: lease.locked,
        confirm: lease.confirm,
        release: lease.release,
        launched: lease.launched
      }
    }
  })
  try {
    const status = await client.status()
    assert.ok(status, 'the request is served (by the digest-only launch), not left unavailable')
    assert.deepEqual(worker.log, [
      'hold 1',
      'confirm 1.1 -> true',
      'confirm 1.2 -> false',
      'release 1',
      'hold 2',
      'confirm 2.1 -> true',
      'confirm 2.2 -> false',
      'release 2'
    ])
    // The discarded helpers were ended at once (they may not even have started running).
    assert.ok(fake.starts() >= 1 && fake.starts() <= 3)
    assert.equal(client.restartsUsed, 2, 'each discarded helper used the restart allowance')
    assert.equal(check.lastLocked, false, 'the status row shows the digest-only start')
    // Still within the cooldown: the next check stays digest-only (nothing reset the losses).
    const next = await check.acquire()
    assert.equal(next.locked, false)
    next.release()
  } finally {
    await client.dispose()
  }
})

test('composition: only a launch that went all the way through clears the lost holds', async () => {
  const buffer = fakePe()
  const path = helperFile(buffer)
  const expect = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  // Hold 1 is lost after the spawn; hold 2 succeeds; then two more losses are needed for digest-only.
  const worker = scriptedHolder([
    [true, false],
    [true, true],
    [true, false],
    [true, false]
  ])
  const check = integrity(path, expect, worker.holder)
  const fake = countingHelper()
  const client = new DictationHelperClient({
    command: fake.command,
    args: fake.args,
    platform: 'win32',
    verify: async () => {
      const lease = await check.acquire()
      return {
        ok: lease.verdict === 'ok',
        locked: lease.locked,
        confirm: lease.confirm,
        release: lease.release,
        launched: lease.launched
      }
    }
  })
  try {
    assert.ok(await client.status())
    assert.equal(check.lastLocked, true, 'the second, held launch went through')
    // One loss after a full success is not yet digest-only.
    const lease = await check.acquire()
    assert.equal(lease.locked, true)
    assert.equal(await lease.confirm(), true)
    assert.equal(await lease.confirm(), false)
    lease.release()
    const again = await check.acquire()
    assert.equal(again.locked, true, 'one loss since the last full launch: still held')
    again.release()
  } finally {
    await client.dispose()
  }
})

test('a busy worker is waited for, never treated as a lost hold; only its exit is', async () => {
  const buffer = fakePe()
  const path = helperFile(buffer)
  const expect = { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] }
  // Answers late (a model load): confirmed when the answer comes.
  let slowResolve: ((held: boolean) => void) | null = null
  const slowHolder: HelperHolder = async (p) => {
    const bytes = readFileSync(p)
    return {
      facts: { status: 'held', fileSha256: 'x', digest: stableHelperDigest(bytes), signed: false },
      alive: () => true,
      trust: async () => ({ status: 'unavailable', reason: 'unsigned' }),
      confirm: () =>
        new Promise<boolean>((resolve) => {
          slowResolve = resolve
          setTimeout(() => resolve(true), 400)
        }),
      release: () => {}
    }
  }
  const slow = integrity(path, expect, slowHolder, { confirmBudgetMs: 50, confirmCapMs: 3_000 })
  const lease = await slow.acquire()
  const started = Date.now()
  assert.equal(await lease.confirm(), true, 'the late answer decides')
  assert.ok(Date.now() - started >= 350, 'it waited past the step for the busy worker')
  assert.ok(slowResolve)
  lease.release()
  // Never answers but stays alive past the cap: the spawn goes ahead (nothing ended), but the hold
  // is NOT reported as held without an answer.
  const silent = integrity(path, expect, scriptedHolder([['never']]).holder, {
    confirmBudgetMs: 50,
    confirmCapMs: 300
  })
  const held = await silent.acquire()
  assert.equal(await held.confirm(), true, 'nothing is ended for a slow answer')
  assert.equal(silent.lastLocked, false, 'unconfirmed: locked:false, and Settings says so')
  held.release()
  // Never answers and then ends: a lost hold.
  const dying = integrity(path, expect, scriptedHolder([['never']], { aliveFor: 150 }).holder, {
    confirmBudgetMs: 50,
    confirmCapMs: 3_000
  })
  const lost = await dying.acquire()
  assert.equal(await lost.confirm(), false, 'the worker ended while it was waited for')
  lost.release()
})

test("Astra's sequence: a hold the worker expired while the app waited is never reported held", async () => {
  // The real worker checker (fake Win32) and the app's integrity check, joined the way the host joins
  // them: the worker answers "still held?" late (its loop is busy) and expires the hold meanwhile.
  const image = fakePe()
  const helperPath = 'C:\\h\\dictation-helper.exe'
  const { ffi, open } = fakeFfi(new Map([[helperPath, image]]))
  const expired = new Set<number>()
  const checker = new HelperChecker(
    () => ffi,
    80,
    (id) => expired.add(id)
  )
  let nextId = 1
  const holder: HelperHolder = async (path) => {
    const id = nextId++
    const reply = checker.hold(id, path)
    if (!reply.ok) throw new Error('no hold')
    return {
      facts: {
        status: 'held',
        fileSha256: reply.fileSha256,
        digest: reply.digest,
        signed: reply.signed
      },
      // The host's bookkeeping: an expiry event ends liveness at once.
      alive: () => checker.held(id) && !expired.has(id),
      trust: async () => ({ status: 'unavailable', reason: 'unsigned' }),
      // The busy worker answers after 300 ms, with what it then knows.
      confirm: () =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(checker.held(id)), 300)),
      release: () => checker.release(id)
    }
  }
  const expect = { digest: stableHelperDigest(image)!, publisherCn: CN, thumbprints: [] }
  const check = new HelperIntegrity({
    helperPath,
    expectation: () => expect,
    holder,
    cachePath: null,
    confirmBudgetMs: 50,
    confirmCapMs: 2_000
  })
  // helperPath is not a real file, so ensure the digest branch reads through the holder only.
  const lease = await check.acquire()
  assert.equal(lease.verdict, 'ok')
  const confirmed = await lease.confirm()
  const actualWorkerHeld = checker.held(1)
  assert.equal(actualWorkerHeld, false, 'the worker expired the hold')
  assert.equal(open.size, 0, 'no native handle is open any more')
  assert.equal(confirmed, false, 'so the confirmation fails (it is a lost hold)')
  assert.equal(check.lastLocked, false, 'and nothing says locked:true')
  lease.release()
})

test('the hold timing is one consistent source: the confirmation cap and the spawn path end before the worker expires a hold', async () => {
  const timing = await import('./helper-hold-timing')
  assert.equal(timing.holdTimingProblem(), null)
  assert.ok(timing.worstHoldToConfirmMs() < timing.HOLD_EXPIRY_MS)
  assert.match(String(timing.holdTimingProblem(10_000)), /could expire/)
  // The dev-only QA hold pause is part of the guarded worst case, and it is capped.
  assert.equal(
    timing.worstHoldToConfirmMs(),
    timing.SIGNATURE_BUDGET_MS +
      timing.MAX_QA_HOLD_PAUSE_MS +
      2 * timing.CONFIRM_CAP_MS +
      timing.SPAWN_ALLOWANCE_MS
  )
  assert.equal(timing.qaHoldPauseMs('8000'), timing.MAX_QA_HOLD_PAUSE_MS)
  assert.equal(timing.qaHoldPauseMs('Infinity'), 0)
  assert.equal(timing.qaHoldPauseMs('abc'), 0)
  assert.equal(timing.qaHoldPauseMs('1200'), 1200)
  const host = readFileSync(fileURLToPath(new URL('./dictation-host.ts', import.meta.url)), 'utf8')
  assert.match(host, /qaHoldPauseMs\(process\.env\.DOODLENOTE_BARK_TEST_HOLD_PAUSE_MS\)/)
  const integrityModule = await import('./helper-integrity')
  assert.equal(
    integrityModule.LEASE_MAX_MS,
    timing.HOLD_EXPIRY_MS,
    'the app lease and the worker expiry are one constant'
  )
  assert.equal(integrityModule.CONFIRM_CAP_MS, timing.CONFIRM_CAP_MS)
  const source = readFileSync(
    fileURLToPath(new URL('./windows-helper-check.ts', import.meta.url)),
    'utf8'
  )
  assert.match(
    source,
    /maxHoldMs = HOLD_EXPIRY_MS/,
    'the worker takes its expiry from the same module'
  )
})
