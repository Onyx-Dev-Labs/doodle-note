// The signing-invariant digest of a PE file (Bark's Windows dictation helper), shared by the build,
// the manifest writer and the smoke test. The app has a TypeScript twin in
// src/main/helper-integrity.ts (stableHelperDigest); helper-integrity.test.ts asserts both agree.
//
// It follows the Authenticode PE hashing rules, in their order:
//   1. the headers [0, SizeOfHeaders) without the optional-header CheckSum (4 bytes) and without the
//      Certificate Table data directory entry (8 bytes);
//   2. every section's raw data, sorted by PointerToRawData;
//   3. the data after the last section, without the attribute certificate table
//      [certVa, certVa + certSize); bytes after the table are hashed, so data appended to a signed
//      file changes the digest. Signers pad an unsigned file with zeros to a multiple of 8 before
//      appending the table; that padding lies inside step 3 of the signed file, so an unsigned file
//      is hashed with the same zero padding. Signing therefore leaves the value unchanged.
// The whole layout is validated first: the section table lies inside SizeOfHeaders, every section's
// raw range lies inside the file after the headers, sections do not overlap, and the certificate
// table starts at or after the end of the last section (8-aligned, inside the file). Anything else
// (a table pointing into a section, overlapping or truncated sections, ...) returns null, which
// callers treat as damaged.
const { createHash } = require('node:crypto')

const MAX_SECTIONS = 96

function peLayout(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d)
    return null
  const length = buffer.length
  const pe = buffer.readUInt32LE(0x3c)
  if (pe < 0x40 || pe + 24 > length || buffer.readUInt32LE(pe) !== 0x00004550) return null
  const sectionCount = buffer.readUInt16LE(pe + 6)
  const sizeOfOptional = buffer.readUInt16LE(pe + 20)
  if (sectionCount === 0 || sectionCount > MAX_SECTIONS) return null
  const optional = pe + 24
  if (optional + sizeOfOptional > length || sizeOfOptional < 2) return null
  const magic = buffer.readUInt16LE(optional)
  if (magic !== 0x10b && magic !== 0x20b) return null
  const countOffset = optional + (magic === 0x20b ? 108 : 92)
  const dataDir = optional + (magic === 0x20b ? 112 : 96)
  const checksumOffset = optional + 64
  const secEntry = dataDir + 4 * 8
  if (secEntry + 8 > optional + sizeOfOptional) return null
  if (buffer.readUInt32LE(countOffset) < 5) return null
  const sizeOfHeaders = buffer.readUInt32LE(optional + 60)
  const sectionTable = optional + sizeOfOptional
  const sectionTableEnd = sectionTable + 40 * sectionCount
  if (sectionTableEnd > length || sizeOfHeaders < sectionTableEnd || sizeOfHeaders > length)
    return null
  const sections = []
  for (let i = 0; i < sectionCount; i++) {
    const base = sectionTable + 40 * i
    const size = buffer.readUInt32LE(base + 16)
    const pointer = buffer.readUInt32LE(base + 20)
    if (size === 0) continue // no raw data (uninitialized): nothing in the file to hash
    if (pointer < sizeOfHeaders || pointer + size > length) return null
    sections.push({ pointer, size })
  }
  sections.sort((a, b) => a.pointer - b.pointer)
  for (let i = 1; i < sections.length; i++) {
    if (sections[i - 1].pointer + sections[i - 1].size > sections[i].pointer) return null
  }
  const sectionsEnd = sections.length
    ? sections[sections.length - 1].pointer + sections[sections.length - 1].size
    : sizeOfHeaders
  const certVa = buffer.readUInt32LE(secEntry)
  const certSize = buffer.readUInt32LE(secEntry + 4)
  let table = null
  if (certVa !== 0 || certSize !== 0) {
    if (certVa === 0 || certSize === 0) return null
    if (
      certVa % 8 !== 0 ||
      certVa < sectionsEnd ||
      certVa < sizeOfHeaders ||
      certVa + certSize > length
    )
      return null
    table = { va: certVa, size: certSize }
  }
  return { checksumOffset, secEntry, sizeOfHeaders, sections, sectionsEnd, table }
}

function stableDigest(buffer) {
  try {
    const layout = peLayout(buffer)
    if (!layout) return null
    const { checksumOffset, secEntry, sizeOfHeaders, sections, sectionsEnd, table } = layout
    const hash = createHash('sha256')
    hash.update(buffer.subarray(0, checksumOffset))
    hash.update(buffer.subarray(checksumOffset + 4, secEntry))
    hash.update(buffer.subarray(secEntry + 8, sizeOfHeaders))
    for (const section of sections)
      hash.update(buffer.subarray(section.pointer, section.pointer + section.size))
    if (table) {
      hash.update(buffer.subarray(sectionsEnd, table.va))
      hash.update(buffer.subarray(table.va + table.size))
    } else {
      hash.update(buffer.subarray(sectionsEnd))
      const pad = (8 - (buffer.length % 8)) % 8
      if (pad) hash.update(Buffer.alloc(pad))
    }
    return hash.digest('hex')
  } catch {
    return null
  }
}

module.exports = { stableDigest, peLayout }
