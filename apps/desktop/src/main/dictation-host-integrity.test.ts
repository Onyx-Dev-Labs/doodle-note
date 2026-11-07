import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyHelperIntegrity, peIsAuthenticodeSigned } from './dictation-host'

test('a signed helper is trusted even when its bytes no longer match the manifest (item 6)', () => {
  // Signing rewrites the file, so a signed release never matches the build-time hash; trusting the
  // signature is what keeps Bark from refusing to start after every signed release.
  assert.equal(classifyHelperIntegrity(true, true, false), 'ok')
  assert.equal(classifyHelperIntegrity(true, true, true), 'ok')
  // An unsigned dev build is checked against the manifest hash.
  assert.equal(classifyHelperIntegrity(true, false, true), 'ok')
  assert.equal(classifyHelperIntegrity(true, false, false), 'damaged')
  // Missing is absent regardless.
  assert.equal(classifyHelperIntegrity(false, false, true), 'absent')
  assert.equal(classifyHelperIntegrity(false, true, true), 'absent')
})

/** A minimal PE32+ image whose security data directory (entry 4) has the given size. */
function fakePe(securitySize: number): Buffer {
  const buf = Buffer.alloc(0x400)
  buf.writeUInt16LE(0x5a4d, 0) // 'MZ'
  const pe = 0x80
  buf.writeUInt32LE(pe, 0x3c)
  buf.writeUInt32LE(0x00004550, pe) // 'PE\0\0'
  const optional = pe + 24
  buf.writeUInt16LE(0x20b, optional) // PE32+
  const dataDir = optional + 112
  const securityEntry = dataDir + 4 * 8
  buf.writeUInt32LE(0x2000, securityEntry) // virtual address (ignored)
  buf.writeUInt32LE(securitySize, securityEntry + 4)
  return buf
}

test('peIsAuthenticodeSigned reads the certificate table size, and rejects non-PE input', () => {
  assert.equal(peIsAuthenticodeSigned(fakePe(0)), false)
  assert.equal(peIsAuthenticodeSigned(fakePe(4096)), true)
  assert.equal(peIsAuthenticodeSigned(Buffer.from('not a pe file')), false)
  assert.equal(peIsAuthenticodeSigned(Buffer.alloc(0)), false)
})
