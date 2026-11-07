import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { computeHelperIntegrity, peHasCertificateTable, stableHelperDigest } from './dictation-host'

/** A minimal PE32+ image; `securitySize`>0 adds a certificate table; `pad` appends trailing bytes. */
function fakePe(securitySize = 0, pad = 0): Buffer {
  const base = Buffer.alloc(0x400)
  base.writeUInt16LE(0x5a4d, 0) // 'MZ'
  const pe = 0x80
  base.writeUInt32LE(pe, 0x3c)
  base.writeUInt32LE(0x00004550, pe) // 'PE\0\0'
  const optional = pe + 24
  base.writeUInt16LE(0x20b, optional) // PE32+
  base.writeUInt32LE(0x12345678, optional + 64) // checksum (ignored by the digest)
  const dataDir = optional + 112
  const secEntry = dataDir + 4 * 8
  base.writeUInt32LE(securitySize > 0 ? base.length : 0, secEntry) // cert table VA at EOF
  base.writeUInt32LE(securitySize, secEntry + 4)
  return pad > 0 ? Buffer.concat([base, Buffer.alloc(pad, 0xab)]) : base
}

function write(dir: string, buffer: Buffer, manifest: Record<string, unknown> | null): string {
  const helper = join(dir, 'dictation-helper.exe')
  writeFileSync(helper, buffer)
  if (manifest) writeFileSync(join(dir, 'dictation-helper.manifest.json'), JSON.stringify(manifest))
  return helper
}

const okSig = (): { valid: boolean; publisherOk: boolean } => ({ valid: true, publisherOk: true })
const badSig = (): { valid: boolean; publisherOk: boolean } => ({
  valid: false,
  publisherOk: false
})
const wrongPublisher = (): { valid: boolean; publisherOk: boolean } => ({
  valid: true,
  publisherOk: false
})

test('the stable digest is unchanged by signing (same prefix; only an appended cert differs)', () => {
  const unsigned = fakePe(0)
  const signed = fakePe(0x200, 0x200) // same header prefix, a cert table appended at the end
  // Point the signed image's checksum to a different value too (signing recomputes it).
  signed.writeUInt32LE(0x99999999, 0x80 + 24 + 64)
  assert.equal(stableHelperDigest(unsigned), stableHelperDigest(signed))
  assert.equal(peHasCertificateTable(unsigned), false)
  assert.equal(peHasCertificateTable(signed), true)
  assert.equal(stableHelperDigest(Buffer.from('not a pe')), null)
})

test('a dev build with no manifest is ok; a matching digest is ok; a mismatch is damaged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bark-integrity-'))
  const buf = fakePe(0)
  const digest = stableHelperDigest(buf)!
  assert.equal(computeHelperIntegrity(write(dir, buf, null), okSig), 'ok')
  assert.equal(computeHelperIntegrity(write(dir, buf, { authenticodeSha256: digest }), okSig), 'ok')
  assert.equal(
    computeHelperIntegrity(write(dir, buf, { authenticodeSha256: 'deadbeef' }), okSig),
    'damaged'
  )
})

test('absent when the helper file is missing', () => {
  assert.equal(computeHelperIntegrity(join(tmpdir(), 'no-such-bark-helper.exe'), okSig), 'absent')
})

test('a cert table present with an invalid signature or wrong publisher is damaged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bark-signed-'))
  const signed = fakePe(0x200, 0x200)
  const digest = stableHelperDigest(signed)!
  const manifest = { authenticodeSha256: digest }
  // Digest matches AND a valid signature by our publisher → ok.
  assert.equal(computeHelperIntegrity(write(dir, signed, manifest), okSig), 'ok')
  // Digest matches but the signature is invalid → damaged (cannot just "look signed").
  assert.equal(computeHelperIntegrity(write(dir, signed, manifest), badSig), 'damaged')
  // Digest matches, signature valid, but a different publisher → damaged.
  assert.equal(computeHelperIntegrity(write(dir, signed, manifest), wrongPublisher), 'damaged')
})

test('an older manifest with only a whole-file sha256 still catches a tampered unsigned build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bark-legacy-'))
  const buf = fakePe(0)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  assert.equal(computeHelperIntegrity(write(dir, buf, { sha256 }), okSig), 'ok')
  assert.equal(computeHelperIntegrity(write(dir, buf, { sha256: 'deadbeef' }), okSig), 'damaged')
})
