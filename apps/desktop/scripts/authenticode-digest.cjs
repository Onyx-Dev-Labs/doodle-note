// The signing-invariant digest of a PE file (Bark's Windows dictation helper), shared by the build,
// the manifest writer and the smoke test. The app has a TypeScript twin in
// src/main/helper-integrity.ts (stableHelperDigest); helper-integrity.test.ts asserts both agree.
//
// It follows the Authenticode exclusion rules, so signing a file leaves the value unchanged:
//   - the optional header CheckSum (4 bytes) is not hashed;
//   - the Certificate Table data directory entry (8 bytes, entry 4) is not hashed;
//   - the attribute certificate table [certVa, certVa + certSize) is not hashed, and any bytes
//     AFTER it are hashed (so trailing data appended to a signed file changes the digest);
//   - signers pad the file with zeros to a multiple of 8 before appending the table, and that
//     padding lies inside the hashed range of the signed file, so for an unsigned file the same
//     zero padding is hashed (to the next multiple of 8). The build also asserts 8-alignment.
// Malformed images (bad offsets, a table outside the file, a misaligned or zero-size table with a
// non-zero address) return null, which callers treat as damaged.
const { createHash } = require('node:crypto')

function peLayout(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d)
    return null
  const pe = buffer.readUInt32LE(0x3c)
  if (pe < 0x40 || pe + 24 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return null
  const sizeOfOptional = buffer.readUInt16LE(pe + 20)
  const optional = pe + 24
  if (optional + 2 > buffer.length) return null
  const magic = buffer.readUInt16LE(optional)
  if (magic !== 0x10b && magic !== 0x20b) return null
  const countOffset = optional + (magic === 0x20b ? 108 : 92)
  const dataDir = optional + (magic === 0x20b ? 112 : 96)
  const checksumOffset = optional + 64
  const secEntry = dataDir + 4 * 8
  if (secEntry + 8 > optional + sizeOfOptional || secEntry + 8 > buffer.length) return null
  if (buffer.readUInt32LE(countOffset) < 5) return null
  const certVa = buffer.readUInt32LE(secEntry)
  const certSize = buffer.readUInt32LE(secEntry + 4)
  let table = null
  if (certVa !== 0 || certSize !== 0) {
    if (certVa === 0 || certSize === 0) return null
    if (certVa % 8 !== 0 || certVa < secEntry + 8 || certVa + certSize > buffer.length) return null
    table = { va: certVa, size: certSize }
  }
  return { checksumOffset, secEntry, table }
}

function stableDigest(buffer) {
  try {
    const layout = peLayout(buffer)
    if (!layout) return null
    const { checksumOffset, secEntry, table } = layout
    const hash = createHash('sha256')
    hash.update(buffer.subarray(0, checksumOffset))
    hash.update(buffer.subarray(checksumOffset + 4, secEntry))
    if (table) {
      hash.update(buffer.subarray(secEntry + 8, table.va))
      hash.update(buffer.subarray(table.va + table.size))
    } else {
      hash.update(buffer.subarray(secEntry + 8))
      const pad = (8 - (buffer.length % 8)) % 8
      if (pad) hash.update(Buffer.alloc(pad))
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

module.exports = { stableDigest, peLayout }
