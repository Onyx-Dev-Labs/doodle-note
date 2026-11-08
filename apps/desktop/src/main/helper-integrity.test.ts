import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HelperIntegrity,
  peHasCertificateTable,
  resolveHelperExpectation,
  stableHelperDigest,
  type HelperExpectation,
  type SignatureCheck
} from './helper-integrity'
import {
  classifySignatureStatus,
  parseVerifyOutput,
  systemPowerShell,
  VERIFY_SCRIPT
} from './win-authenticode'

const require = createRequire(import.meta.url)
const cjs = require('../../scripts/authenticode-digest.cjs') as {
  stableDigest: (buffer: Buffer) => string | null
}

/**
 * A minimal PE32+ image of `length` bytes (unsigned). sign() appends zero padding to 8 and a
 * certificate table the way signers do, and rewrites the CheckSum and the table directory entry.
 */
function fakePe(length = 0x400, fill = 0x11): Buffer {
  const base = Buffer.alloc(length, fill)
  base.fill(0, 0, 0x200)
  base.writeUInt16LE(0x5a4d, 0)
  const pe = 0x80
  base.writeUInt32LE(pe, 0x3c)
  base.writeUInt32LE(0x00004550, pe)
  base.writeUInt16LE(240, pe + 20) // SizeOfOptionalHeader (PE32+)
  const optional = pe + 24
  base.writeUInt16LE(0x20b, optional)
  base.writeUInt32LE(0x12345678, optional + 64) // CheckSum
  base.writeUInt32LE(16, optional + 108) // NumberOfRvaAndSizes
  return base
}
const SEC_ENTRY = 0x80 + 24 + 112 + 32

function sign(unsigned: Buffer, tableSize = 0x300): Buffer {
  const pad = (8 - (unsigned.length % 8)) % 8
  const signed = Buffer.concat([unsigned, Buffer.alloc(pad), Buffer.alloc(tableSize, 0xcc)])
  signed.writeUInt32LE(unsigned.length + pad, SEC_ENTRY)
  signed.writeUInt32LE(tableSize, SEC_ENTRY + 4)
  signed.writeUInt32LE(0x9abcdef0, 0x80 + 24 + 64)
  return signed
}

test('the digest follows the Authenticode exclusions: unchanged by signing, aligned or not', () => {
  for (const length of [0x400, 0x403, 0x405]) {
    const unsigned = fakePe(length)
    const signed = sign(unsigned)
    assert.equal(peHasCertificateTable(unsigned), false)
    assert.equal(peHasCertificateTable(signed), true)
    assert.equal(stableHelperDigest(signed), stableHelperDigest(unsigned), `length ${length}`)
  }
})

test('trailing bytes after the certificate table, or any code change, change the digest', () => {
  const unsigned = fakePe()
  const signed = sign(unsigned)
  const trailing = Buffer.concat([signed, Buffer.from('appended')])
  assert.notEqual(stableHelperDigest(trailing), stableHelperDigest(signed))
  const patched = Buffer.from(unsigned)
  patched[0x300] ^= 0xff
  assert.notEqual(stableHelperDigest(patched), stableHelperDigest(unsigned))
})

test('malformed certificate tables and images are rejected (null digest)', () => {
  const signed = sign(fakePe())
  const outside = Buffer.from(signed)
  outside.writeUInt32LE(0x10000, SEC_ENTRY + 4) // table runs past the end of the file
  assert.equal(stableHelperDigest(outside), null)
  const misaligned = Buffer.from(signed)
  misaligned.writeUInt32LE(signed.readUInt32LE(SEC_ENTRY) + 1, SEC_ENTRY)
  assert.equal(stableHelperDigest(misaligned), null)
  const zeroSize = Buffer.from(signed)
  zeroSize.writeUInt32LE(0, SEC_ENTRY + 4)
  assert.equal(stableHelperDigest(zeroSize), null)
  assert.equal(stableHelperDigest(Buffer.from('not a pe image at all, just text......')), null)
})

test('the TypeScript digest and the build scripts agree byte for byte', () => {
  const unsigned = fakePe(0x405)
  for (const sample of [
    unsigned,
    sign(unsigned),
    Buffer.concat([sign(unsigned), Buffer.from('x')])
  ])
    assert.equal(stableHelperDigest(sample), cjs.stableDigest(sample))
})

function helperFile(buffer: Buffer, manifest?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-'))
  const helper = join(dir, 'dictation-helper.exe')
  writeFileSync(helper, buffer)
  if (manifest) writeFileSync(join(dir, 'dictation-helper.manifest.json'), JSON.stringify(manifest))
  return helper
}

function integrity(
  helperPath: string,
  expectation: HelperExpectation | null,
  verify: (path: string) => Promise<SignatureCheck>,
  extra: { cachePath?: string | null; budgetMs?: number } = {}
): HelperIntegrity {
  return new HelperIntegrity({
    helperPath,
    expectation: () => expectation,
    verify,
    cachePath: extra.cachePath ?? null,
    ...(extra.budgetMs !== undefined ? { budgetMs: extra.budgetMs } : {})
  })
}

const never = (): Promise<SignatureCheck> => {
  throw new Error('the signature must not be checked for an unsigned helper')
}
const signer =
  (subjectCn: string | null, thumbprint = 'AA11', calls = { n: 0 }) =>
  (): Promise<SignatureCheck> => {
    calls.n += 1
    return Promise.resolve({ status: 'valid', subjectCn, thumbprint })
  }

test('lazy: nothing is read or verified until ensure(); then ok for a matching unsigned helper', async () => {
  const buffer = fakePe()
  const check = integrity(
    helperFile(buffer),
    {
      digest: stableHelperDigest(buffer)!,
      publisherCn: 'Onyx Dev Labs LLC',
      thumbprints: []
    },
    never
  )
  assert.equal(check.state(), 'unchecked')
  const states: string[] = []
  check.onChange((state) => states.push(state))
  const pending = check.ensure()
  assert.equal(check.state(), 'checking')
  assert.equal(await pending, 'ok')
  assert.deepEqual(states, ['checking', 'ok'])
  assert.equal(check.lastBranch, 'digest')
})

test('fail closed: missing expectation, unreadable or malformed helper, digest mismatch', async () => {
  const buffer = fakePe()
  const expectation = { digest: stableHelperDigest(buffer)!, publisherCn: null, thumbprints: [] }
  assert.equal(await integrity(helperFile(buffer), null, never).ensure(), 'damaged')
  assert.equal(
    await integrity(helperFile(Buffer.from('garbage')), expectation, never).ensure(),
    'damaged'
  )
  const changed = Buffer.from(buffer)
  changed[0x300] ^= 1
  assert.equal(await integrity(helperFile(changed), expectation, never).ensure(), 'damaged')
  assert.equal(
    await integrity(
      join(tmpdir(), 'no-such-dir-bark', 'dictation-helper.exe'),
      expectation,
      never
    ).ensure(),
    'absent'
  )
  // A directory where the helper should be: unreadable as a file, so damaged (never ok).
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-dir-'))
  assert.equal(await integrity(dir, expectation, never).ensure(), 'damaged')
})

test('signed: exact publisher CN and a recorded thumbprint are required', async () => {
  const signed = sign(fakePe())
  const digest = stableHelperDigest(signed)!
  const path = helperFile(signed)
  const expect = { digest, publisherCn: 'Onyx Dev Labs LLC', thumbprints: ['AA11'] }
  assert.equal(await integrity(path, expect, signer('Onyx Dev Labs LLC')).ensure(), 'ok')
  // A substring is not enough: the CN must match exactly.
  assert.equal(await integrity(path, expect, signer('Onyx Dev Labs LLC Evil')).ensure(), 'damaged')
  assert.equal(await integrity(path, expect, signer('Onyx Dev Labs')).ensure(), 'damaged')
  assert.equal(
    await integrity(path, expect, signer('Onyx Dev Labs LLC', 'BB22')).ensure(),
    'damaged'
  )
  const invalid = (): Promise<SignatureCheck> =>
    Promise.resolve({ status: 'invalid', code: '0x800b0109' })
  assert.equal(await integrity(path, expect, invalid).ensure(), 'damaged')
  // With no thumbprints recorded (a build that did not pin), the exact CN alone decides.
  const unpinned = { ...expect, thumbprints: [] }
  assert.equal(await integrity(path, unpinned, signer('Onyx Dev Labs LLC', 'ZZ')).ensure(), 'ok')
})

test('fail open to the digest when the verifier is unavailable or slow; never when the digest differs', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = {
    digest: stableHelperDigest(signed)!,
    publisherCn: 'Onyx Dev Labs LLC',
    thumbprints: []
  }
  const unavailable = (): Promise<SignatureCheck> =>
    Promise.resolve({ status: 'unavailable', reason: 'verifier not loadable' })
  const unavailableCheck = integrity(path, expect, unavailable)
  assert.equal(await unavailableCheck.ensure(), 'ok')
  assert.equal(unavailableCheck.lastBranch, 'signature-unavailable')
  const throws = (): Promise<SignatureCheck> => Promise.reject(new Error('blocked by policy'))
  assert.equal(await integrity(path, expect, throws).ensure(), 'ok')
  const hangs = (): Promise<SignatureCheck> => new Promise<SignatureCheck>(() => {})
  const started = Date.now()
  assert.equal(await integrity(path, expect, hangs, { budgetMs: 50 }).ensure(), 'ok')
  assert.ok(Date.now() - started < 2_000, 'the budget bounds the wait')
  const wrong = { ...expect, digest: '0'.repeat(64) }
  assert.equal(await integrity(path, wrong, unavailable).ensure(), 'damaged')
})

test('a build that signed its helper must ship it signed', async () => {
  const unsigned = fakePe()
  const expect = {
    digest: stableHelperDigest(unsigned)!,
    publisherCn: 'Onyx Dev Labs LLC',
    thumbprints: ['AA11']
  }
  assert.equal(await integrity(helperFile(unsigned), expect, never).ensure(), 'damaged')
})

test('cached per file: the signature is checked once, and again when the file changes', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const cachePath = join(mkdtempSync(join(tmpdir(), 'bark-cache-')), 'helper-integrity.json')
  const expect = {
    digest: stableHelperDigest(signed)!,
    publisherCn: 'Onyx Dev Labs LLC',
    thumbprints: []
  }
  const calls = { n: 0 }
  const first = integrity(path, expect, signer('Onyx Dev Labs LLC', 'AA11', calls), { cachePath })
  assert.equal(await first.ensure(), 'ok')
  assert.equal(await first.ensure(), 'ok')
  assert.equal(calls.n, 1, 'the same file is not re-verified within a launch')
  // A new launch (new instance) reuses the persisted verdict.
  const relaunch = integrity(path, expect, signer('Onyx Dev Labs LLC', 'AA11', calls), {
    cachePath
  })
  assert.equal(await relaunch.ensure(), 'ok')
  assert.equal(calls.n, 1, 'the persisted verdict covers the next launch')
  assert.ok(JSON.parse(readFileSync(cachePath, 'utf8'))[path])
  // The file changes (same bytes, new mtime): verified again right before the next spawn.
  utimesSync(path, new Date(), new Date(Date.now() + 5_000))
  assert.equal(await relaunch.ensure(), 'ok')
  assert.equal(calls.n, 2, 'a changed file is re-verified')
  // Replaced by different code: damaged even though a verdict was cached for the old file.
  const other = sign(fakePe(0x400, 0x22))
  writeFileSync(path, other)
  assert.equal(await relaunch.ensure(), 'damaged')
})

test('unavailable verdicts are not persisted, so the next launch tries again', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const cachePath = join(mkdtempSync(join(tmpdir(), 'bark-cache-')), 'helper-integrity.json')
  const expect = {
    digest: stableHelperDigest(signed)!,
    publisherCn: 'Onyx Dev Labs LLC',
    thumbprints: []
  }
  const unavailable = (): Promise<SignatureCheck> =>
    Promise.resolve({ status: 'unavailable', reason: 'x' })
  assert.equal(await integrity(path, expect, unavailable, { cachePath }).ensure(), 'ok')
  const calls = { n: 0 }
  assert.equal(
    await integrity(path, expect, signer('Onyx Dev Labs LLC', 'AA11', calls), {
      cachePath
    }).ensure(),
    'ok'
  )
  assert.equal(calls.n, 1)
})

test('packaged builds trust only the baked expectation, never the manifest beside the helper', () => {
  const buffer = fakePe()
  const forged = { authenticodeSha256: 'f'.repeat(64), publisherCn: 'Anyone', thumbprints: [] }
  const path = helperFile(buffer, forged)
  const baked = {
    digest: stableHelperDigest(buffer)!,
    publisherCn: 'Onyx Dev Labs LLC',
    thumbprints: []
  }
  assert.deepEqual(resolveHelperExpectation(path, true, baked), baked)
  assert.equal(resolveHelperExpectation(path, true, null), null, 'no baked value: nothing to trust')
  // Unpackaged dev runs read the fresh manifest (rebuilt with the helper).
  assert.equal(resolveHelperExpectation(path, false, baked)?.digest, 'f'.repeat(64))
  const malformed = helperFile(buffer)
  writeFileSync(join(malformed, '..', 'dictation-helper.manifest.json'), '{ not json')
  assert.equal(resolveHelperExpectation(malformed, false, baked), null)
})

test('signature statuses: Valid is good, chain and digest failures are bad, the rest unavailable', () => {
  assert.equal(classifySignatureStatus('Valid'), 'valid')
  for (const bad of ['NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError'])
    assert.equal(classifySignatureStatus(bad), 'invalid', bad)
  for (const unknown of ['NotSupportedFileFormat', 'Incompatible', undefined])
    assert.equal(classifySignatureStatus(unknown), 'unavailable', String(unknown))
  assert.deepEqual(
    parseVerifyOutput('{"status":"Valid","cn":"Onyx Dev Labs LLC","thumbprint":"ab12"}\r\n'),
    { status: 'valid', subjectCn: 'Onyx Dev Labs LLC', thumbprint: 'AB12' }
  )
  assert.deepEqual(parseVerifyOutput('{"status":"HashMismatch"}'), {
    status: 'invalid',
    code: 'HashMismatch'
  })
  assert.equal(parseVerifyOutput('garbage').status, 'unavailable')
})

test('the verifier passes the helper path as data and runs powershell.exe by its full path', () => {
  // The path is read from an environment variable inside the script, never interpolated into it.
  assert.match(VERIFY_SCRIPT, /-LiteralPath \$env:DN_HELPER_PATH/)
  assert.doesNotMatch(VERIFY_SCRIPT, /DN_HELPER_PATH[^;]*\$\(/)
  assert.equal(
    systemPowerShell({ SystemRoot: 'C:\\Windows' }).replace(/\//g, '\\'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
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
  // A signing step (PR #279's sign-windows.cjs), when present, sits between build and manifest.
  const signing = at('sign-windows')
  if (signing >= 0) assert.ok(signing > build && signing < manifest, script)
  const vite = readFileSync(new URL('../../electron.vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /__DOODLENOTE_HELPER_INTEGRITY__: helperIntegrity\(\)/)
})
