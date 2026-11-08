import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HelperIntegrity,
  peHasCertificateTable,
  resolveHelperExpectation,
  stableHelperDigest,
  type HelperExpectation,
  type SignatureCheck,
  type VerifierSessionLike
} from './helper-integrity'
import {
  classifySignatureStatus,
  parseVerifyOutput,
  systemPowerShell,
  verifierEnv,
  VERIFY_SCRIPT
} from './win-authenticode'

const require = createRequire(import.meta.url)
const cjs = require('../../scripts/authenticode-digest.cjs') as {
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
    assert.equal(cjs.stableDigest(image), null, `${name} (build script)`)
  }
  assert.equal(stableHelperDigest(Buffer.from('not a pe image at all, just text......')), null)
})

test('the TypeScript digest and the build scripts agree byte for byte', () => {
  for (const sample of [
    fakePe(5),
    sign(fakePe(5)),
    Buffer.concat([sign(fakePe()), Buffer.from('x')])
  ])
    assert.equal(stableHelperDigest(sample), cjs.stableDigest(sample))
  const real = fileURLToPath(
    new URL('../../../../engine/.build/windows/dictation-helper.exe', import.meta.url)
  )
  if (existsSync(real)) {
    const bytes = readFileSync(real)
    assert.ok(stableHelperDigest(bytes))
    assert.equal(stableHelperDigest(bytes), cjs.stableDigest(bytes))
  }
})

test('every Get-AuthenticodeSignature status is classified', () => {
  assert.equal(classifySignatureStatus('Valid'), 'valid')
  assert.equal(classifySignatureStatus('HashMismatch'), 'invalid', 'tampered')
  assert.equal(
    classifySignatureStatus('NotSigned'),
    'invalid',
    'a certificate table that does not verify'
  )
  for (const chain of ['NotTrusted', 'UnknownError'])
    assert.equal(
      classifySignatureStatus(chain),
      'unavailable',
      `${chain}: chain trust, not tampering`
    )
  for (const other of ['NotSupportedFileFormat', 'Incompatible', 'Error', undefined])
    assert.equal(classifySignatureStatus(other), 'unavailable', String(other))
  assert.deepEqual(
    parseVerifyOutput('{"status":"Valid","cn":"Onyx Dev Labs LLC","thumbprint":"ab12"}'),
    {
      status: 'valid',
      subjectCn: 'Onyx Dev Labs LLC',
      thumbprint: 'AB12'
    }
  )
  assert.deepEqual(parseVerifyOutput('{"status":"HashMismatch"}'), {
    status: 'invalid',
    code: 'HashMismatch'
  })
  assert.equal(parseVerifyOutput('garbage').status, 'unavailable')
})

test('the verifier locks before it verifies, takes the path as data, and drops PSModulePath', () => {
  assert.ok(
    VERIFY_SCRIPT.indexOf("[IO.File]::Open($env:DN_HELPER_PATH, 'Open', 'Read', 'Read')") <
      VERIFY_SCRIPT.indexOf('Get-AuthenticodeSignature'),
    'the file is opened (write/delete denied) before anything else'
  )
  assert.match(VERIFY_SCRIPT, /-LiteralPath \$env:DN_HELPER_PATH/)
  assert.doesNotMatch(VERIFY_SCRIPT, /\$\(\$env:DN_HELPER_PATH/)
  const env = verifierEnv(
    { PSModulePath: 'C:\\pwsh7', psmodulepath: 'x', PATH: 'p' },
    'C:\\a $(evil)\\h.exe'
  )
  assert.equal(env.PSModulePath, undefined)
  assert.equal(env.psmodulepath, undefined)
  assert.equal(env.DN_HELPER_PATH, 'C:\\a $(evil)\\h.exe')
  assert.equal(
    systemPowerShell({ SystemRoot: 'C:\\Windows' }).replace(/\//g, '\\'),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
})

/** A scripted verifier: records what it was asked and when it was released or killed. */
function fakeVerifier(
  answer: SignatureCheck | 'hang',
  options: { lock?: boolean | 'hang' } = {}
): { factory: (path: string) => VerifierSessionLike; log: string[] } {
  const log: string[] = []
  const factory = (): VerifierSessionLike => {
    log.push('start')
    return {
      locked:
        options.lock === 'hang'
          ? new Promise<boolean>(() => {})
          : Promise.resolve(options.lock ?? true),
      check: (verify) => {
        log.push(verify ? 'verify' : 'skip')
        if (!verify)
          return Promise.resolve({ status: 'unavailable', reason: 'skipped' } as SignatureCheck)
        return answer === 'hang' ? new Promise<SignatureCheck>(() => {}) : Promise.resolve(answer)
      },
      release: () => log.push('release'),
      kill: () => log.push('kill')
    }
  }
  return { factory, log }
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
  verifier: (path: string) => VerifierSessionLike,
  extra: { cachePath?: string | null; budgetMs?: number; leaseMaxMs?: number } = {}
): HelperIntegrity {
  return new HelperIntegrity({
    helperPath,
    expectation: typeof expectation === 'function' ? expectation : () => expectation,
    verifier,
    cachePath: extra.cachePath ?? null,
    ...(extra.budgetMs !== undefined ? { budgetMs: extra.budgetMs } : {}),
    ...(extra.leaseMaxMs !== undefined ? { leaseMaxMs: extra.leaseMaxMs } : {})
  })
}

const valid = (subjectCn: string, thumbprint = 'AA11'): SignatureCheck => ({
  status: 'valid',
  subjectCn,
  thumbprint
})
const CN = 'Onyx Dev Labs LLC'

test('lazy, and the file stays locked from before it is read until the lease is released', async () => {
  const buffer = fakePe()
  const verifier = fakeVerifier(valid(CN))
  const check = integrity(
    helperFile(buffer),
    { digest: stableHelperDigest(buffer)!, publisherCn: CN, thumbprints: [] },
    verifier.factory
  )
  assert.equal(check.state(), 'unchecked')
  assert.deepEqual(verifier.log, [], 'nothing runs before it is needed')
  const lease = await check.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, true)
  assert.deepEqual(
    verifier.log,
    ['start', 'skip'],
    'unsigned: locked, no signature check, still held'
  )
  lease.release()
  assert.deepEqual(verifier.log, ['start', 'skip', 'release'])
  assert.equal(check.lastBranch, 'digest')
})

test('fail closed on everything that is not a matching helper', async () => {
  const buffer = fakePe()
  const expectation = { digest: stableHelperDigest(buffer)!, publisherCn: null, thumbprints: [] }
  const v = fakeVerifier(valid(CN))
  assert.equal(await integrity(helperFile(buffer), null, v.factory).ensure(), 'damaged')
  assert.equal(
    await integrity(helperFile(Buffer.from('garbage')), expectation, v.factory).ensure(),
    'damaged'
  )
  const changed = Buffer.from(buffer)
  changed[0x300] ^= 1
  assert.equal(await integrity(helperFile(changed), expectation, v.factory).ensure(), 'damaged')
  assert.equal(
    await integrity(
      join(tmpdir(), 'no-such-dir-bark', 'dictation-helper.exe'),
      expectation,
      v.factory
    ).ensure(),
    'absent'
  )
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-dir-'))
  assert.equal(await integrity(dir, expectation, v.factory).ensure(), 'damaged')
})

test('signed: exact CN and recorded thumbprint; definitive tampering is damaged', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: ['AA11'] }
  const run = async (answer: SignatureCheck): Promise<string> =>
    integrity(path, expect, fakeVerifier(answer).factory).ensure()
  assert.equal(await run(valid(CN)), 'ok')
  assert.equal(await run(valid(`${CN} Evil`)), 'damaged', 'a substring is not enough')
  assert.equal(await run(valid('Onyx Dev Labs')), 'damaged')
  assert.equal(await run(valid(CN, 'BB22')), 'damaged', 'not a certificate this build used')
  assert.equal(await run({ status: 'invalid', code: 'HashMismatch' }), 'damaged')
  assert.equal(await run({ status: 'invalid', code: 'NotSigned' }), 'damaged')
})

test('chain-trust failures and an unavailable verifier fall back to the digest and are not cached', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const cachePath = join(mkdtempSync(join(tmpdir(), 'bark-cache-')), 'cache.json')
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: [] }
  for (const status of ['NotTrusted', 'UnknownError', 'NotSupportedFileFormat', 'Incompatible']) {
    const answer = parseVerifyOutput(JSON.stringify({ status }))
    const verifier = fakeVerifier(answer)
    const check = integrity(path, expect, verifier.factory, { cachePath })
    assert.equal(await check.ensure(), 'ok', status)
    assert.equal(check.lastBranch, 'signature-unavailable', status)
    assert.equal(existsSync(cachePath), false, `${status} is not persisted`)
  }
  // The next spawn verifies again (here: a definitive answer, which is persisted).
  const again = fakeVerifier(valid(CN))
  assert.equal(await integrity(path, expect, again.factory, { cachePath }).ensure(), 'ok')
  assert.ok(again.log.includes('verify'))
  assert.ok(existsSync(cachePath))
  // No lock (PowerShell blocked): the digest decides, without a lock.
  const blocked = integrity(path, expect, fakeVerifier(valid(CN), { lock: false }).factory)
  const lease = await blocked.acquire()
  assert.equal(lease.verdict, 'ok')
  assert.equal(lease.locked, false)
  // A digest mismatch is damaged whatever the verifier says.
  assert.equal(
    await integrity(
      path,
      { ...expect, digest: '0'.repeat(64) },
      fakeVerifier(valid(CN)).factory
    ).ensure(),
    'damaged'
  )
})

test('the 3 s budget ends a verifier that does not answer; a forgotten lease is ended too', async () => {
  const signed = sign(fakePe())
  const path = helperFile(signed)
  const expect = { digest: stableHelperDigest(signed)!, publisherCn: CN, thumbprints: [] }
  const slowLock = fakeVerifier(valid(CN), { lock: 'hang' })
  const started = Date.now()
  assert.equal(await integrity(path, expect, slowLock.factory, { budgetMs: 60 }).ensure(), 'ok')
  assert.ok(slowLock.log.includes('kill'), 'a verifier that cannot lock in time is ended')
  const slowVerdict = fakeVerifier('hang')
  assert.equal(await integrity(path, expect, slowVerdict.factory, { budgetMs: 60 }).ensure(), 'ok')
  assert.ok(slowVerdict.log.includes('kill'), 'a verifier that cannot verify in time is ended')
  assert.ok(Date.now() - started < 2_000)
  const forgotten = fakeVerifier(valid(CN))
  const lease = await integrity(path, expect, forgotten.factory, { leaseMaxMs: 30 }).acquire()
  assert.equal(lease.locked, true)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.ok(forgotten.log.includes('kill'), 'an unreleased lease does not keep the verifier alive')
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
  const first = fakeVerifier(valid(CN))
  assert.equal(await integrity(path, () => expect, first.factory, { cachePath }).ensure(), 'ok')
  const relaunch = fakeVerifier(valid(CN))
  const relaunched = integrity(path, () => expect, relaunch.factory, { cachePath })
  assert.equal(await relaunched.ensure(), 'ok')
  assert.deepEqual(
    relaunch.log,
    ['start', 'skip', 'release'],
    'a cached verdict skips the signature check (the file is still locked)'
  )
  // Corrupt the certificate table only (the signing-invariant digest is unchanged): re-verified.
  const corrupted = Buffer.from(signed)
  corrupted[corrupted.length - 10] ^= 0xff
  writeFileSync(path, corrupted)
  const afterCorruption = fakeVerifier({ status: 'invalid', code: 'HashMismatch' })
  assert.equal(
    await integrity(path, () => expect, afterCorruption.factory, { cachePath }).ensure(),
    'damaged'
  )
  assert.ok(afterCorruption.log.includes('verify'))
  // A different expectation (another pinned thumbprint) is never answered from the old verdict.
  writeFileSync(path, signed)
  expect = { ...expect, thumbprints: ['ZZ99'] }
  const newPin = fakeVerifier(valid(CN, 'AA11'))
  assert.equal(
    await integrity(path, () => expect, newPin.factory, { cachePath }).ensure(),
    'damaged'
  )
  assert.ok(newPin.log.includes('verify'))
})

test('a build that signed its helper must ship it signed', async () => {
  const unsigned = fakePe()
  const expect = { digest: stableHelperDigest(unsigned)!, publisherCn: CN, thumbprints: ['AA11'] }
  assert.equal(
    await integrity(helperFile(unsigned), expect, fakeVerifier(valid(CN)).factory).ensure(),
    'damaged'
  )
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
