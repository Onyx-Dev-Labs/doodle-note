#!/usr/bin/env node
// Packaged-content check for the Windows build: lists resources/app.asar and fails
// if app source, build scripts, docs, tests or sourcemaps were bundled into it, or
// if app.asar.unpacked carries native binaries for another OS or CPU (they cannot
// load, and cannot be Authenticode-signed), or if a native binary (.node, .dll,
// .exe) was packed inside app.asar itself for another OS or CPU, or if a required
// Windows runtime binary (speech engine, Koffi, reflink, llama) is missing.
//
//   node scripts/test-windows-package.cjs <win-unpacked dir | app.asar> [--list out.txt]
//     [--same-files-as <other win-unpacked dir>]
//
// --same-files-as also requires exactly the same app.asar entries and exactly the
// same files under app.asar.unpacked as the other package (CI: the QA identity
// package against the production one).
//
// Reads the asar header directly (no @electron/asar dependency): the file starts
// with a Chromium pickle holding the JSON directory tree.
const fs = require('node:fs')
const path = require('node:path')

/** The asar's JSON directory tree, and where file contents start (`dataOffset`). */
function readAsar(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const sizeBuf = Buffer.alloc(8)
    fs.readSync(fd, sizeBuf, 0, 8, 0)
    // Pickle 1: [payload size = 4][header pickle size]
    const headerSize = sizeBuf.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    fs.readSync(fd, headerBuf, 0, headerSize, 8)
    // Pickle 2: [payload size][string length][utf8 json]
    const jsonLength = headerBuf.readUInt32LE(4)
    const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLength).toString('utf8'))
    return { header, dataOffset: 8 + headerSize }
  } finally {
    fs.closeSync(fd)
  }
}

function readAsarHeader(file) {
  return readAsar(file).header
}

/** Every file path in the archive, POSIX-separated, relative to its root. */
function listAsar(file) {
  const out = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, rel)
      else out.push(rel)
    }
  }
  walk(readAsarHeader(file), '')
  return out.sort()
}

// The app itself is only out/** plus package.json; everything else at the top
// level would be workspace source or tooling. Inside node_modules, third-party
// packages may legitimately ship their own maps and test helpers, so only the
// app's own tree is held to the no-tests/no-sourcemaps rule.
const ALLOWED_TOP_LEVEL = new Set(['out', 'node_modules', 'package.json'])
const FORBIDDEN_APP_FILE = [
  [/\.map$/, 'sourcemap'],
  [/(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)__tests__\//, 'test file'],
  [/\.tsx?$/, 'TypeScript source']
]

function problemsFor(files) {
  const problems = []
  for (const file of files) {
    const top = file.split('/')[0]
    if (!ALLOWED_TOP_LEVEL.has(top)) {
      problems.push(`${file}: outside out/ and node_modules (source, scripts, docs or tooling)`)
      continue
    }
    if (top === 'node_modules') continue
    for (const [pattern, label] of FORBIDDEN_APP_FILE) {
      if (pattern.test(file)) problems.push(`${file}: ${label}`)
    }
  }
  return problems
}

const NATIVE_EXTENSIONS = ['.node', '.dll', '.exe']
const IMAGE_FILE_MACHINE_AMD64 = 0x8664

/**
 * 'x64', another PE machine as hex, or 'not-pe' (an ELF / Mach-O build for another
 * OS), for the file at `start` (`size` bytes) in `file`; the whole file by default.
 */
function peMachine(file, start = 0, size = Infinity) {
  const fd = fs.openSync(file, 'r')
  try {
    const read = (length, at) => {
      if (at + length > size) return null
      const buf = Buffer.alloc(length)
      return fs.readSync(fd, buf, 0, length, start + at) === length ? buf : null
    }
    const head = read(64, 0)
    if (!head || head.toString('latin1', 0, 2) !== 'MZ') return 'not-pe'
    const peOffset = head.readUInt32LE(0x3c)
    const pe = read(6, peOffset)
    if (!pe || pe.toString('latin1', 0, 4) !== 'PE\0\0') return 'not-pe'
    const machine = pe.readUInt16LE(4)
    return machine === IMAGE_FILE_MACHINE_AMD64 ? 'x64' : `0x${machine.toString(16)}`
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Native binaries packed inside app.asar itself (not unpacked), each with its
 * machine: [{ path, machine }]. Files marked `unpacked` live in app.asar.unpacked
 * and are checked there.
 */
function nativeBinariesInAsar(file) {
  const { header, dataOffset } = readAsar(file)
  const found = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) walk(child, rel)
      else if (
        !child.unpacked &&
        NATIVE_EXTENSIONS.includes(path.extname(name).toLowerCase()) &&
        child.offset !== undefined
      ) {
        found.push({
          path: rel,
          machine: peMachine(file, dataOffset + Number(child.offset), Number(child.size))
        })
      }
    }
  }
  walk(header, '')
  return found
}

/**
 * Windows runtime binaries every package must carry unpacked: the speech engine,
 * Koffi (Windows APIs), reflink (library copies) and llama (local refinement). A
 * build whose node_modules collector missed pnpm's platform packages lacks them.
 */
const REQUIRED_UNPACKED = [
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
  'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  'node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node',
  'node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node'
]

/** The required Windows binaries missing from app.asar.unpacked. */
function missingRequiredBinaries(unpackedDir) {
  return REQUIRED_UNPACKED.filter(
    (rel) => !fs.existsSync(path.join(unpackedDir, ...rel.split('/')))
  )
}

/** Native binaries under app.asar.unpacked that cannot load in the x64 Windows app. */
function foreignNativeBinaries(unpackedDir) {
  const problems = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (NATIVE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        const machine = peMachine(full)
        if (machine !== 'x64')
          problems.push(
            `${path.relative(unpackedDir, full).replace(/\\/g, '/')}: ${machine === 'not-pe' ? 'not a Windows binary' : `PE machine ${machine}, not x64`}`
          )
      }
    }
  }
  if (fs.existsSync(unpackedDir)) walk(unpackedDir)
  return problems
}

module.exports = {
  readAsarHeader,
  listAsar,
  problemsFor,
  peMachine,
  foreignNativeBinaries,
  nativeBinariesInAsar,
  missingRequiredBinaries,
  REQUIRED_UNPACKED,
  listTree,
  fileListDifferences
}

/** Every file under `dir`, relative and `/`-separated, sorted ([] when it does not exist). */
function listTree(dir) {
  const files = []
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(rel)
      else files.push(rel)
    }
  }
  if (fs.existsSync(dir)) walk('')
  return files.sort()
}

/** What only `a` and only `b` hold, for two file lists. */
function fileListDifferences(a, b) {
  const inA = new Set(a)
  const inB = new Set(b)
  return { onlyA: a.filter((file) => !inB.has(file)), onlyB: b.filter((file) => !inA.has(file)) }
}

/** Problems when the package at `asar` does not ship exactly the files of `otherDir`. */
function sameFilesProblems(asar, files, otherDir) {
  const problems = []
  const otherAsar = path.join(otherDir, 'resources', 'app.asar')
  const pairs = [
    ['app.asar', files, listAsar(otherAsar)],
    ['app.asar.unpacked', listTree(`${asar}.unpacked`), listTree(`${otherAsar}.unpacked`)]
  ]
  for (const [name, ours, theirs] of pairs) {
    const { onlyA, onlyB } = fileListDifferences(ours, theirs)
    console.log(
      `  ${name}: ${ours.length} files here, ${theirs.length} in ${otherDir}; ${onlyA.length} only here, ${onlyB.length} only there`
    )
    if (ours.length === 0) problems.push(`${name}: no files`)
    problems.push(...onlyA.map((file) => `${name}/${file}: only in this package`))
    problems.push(...onlyB.map((file) => `${name}/${file}: only in ${otherDir}`))
  }
  return problems
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const listIndex = args.indexOf('--list')
  const listFile = listIndex >= 0 ? args.splice(listIndex, 2)[1] : null
  const sameIndex = args.indexOf('--same-files-as')
  const sameAs = sameIndex >= 0 ? args.splice(sameIndex, 2)[1] : null
  const target = args[0]
  if (!target) {
    console.error('usage: test-windows-package.cjs <win-unpacked dir | app.asar> [--list out.txt]')
    process.exit(2)
  }
  const asar = target.endsWith('.asar') ? target : path.join(target, 'resources', 'app.asar')
  const files = listAsar(asar)
  if (listFile) fs.writeFileSync(listFile, files.join('\n') + '\n')
  const tops = {}
  for (const file of files) tops[file.split('/')[0]] = (tops[file.split('/')[0]] ?? 0) + 1
  console.log(`${asar}: ${files.length} files`)
  for (const [top, count] of Object.entries(tops).sort()) console.log(`  ${top}: ${count}`)
  const problems = problemsFor(files)
  if (!files.includes('out/main/index.js')) problems.push('out/main/index.js is missing')
  if (!files.includes('package.json')) problems.push('package.json is missing')
  const unpacked = `${asar}.unpacked`
  const foreign = foreignNativeBinaries(unpacked)
  problems.push(...foreign.map((problem) => `app.asar.unpacked/${problem}`))
  console.log(
    `  app.asar.unpacked: ${foreign.length} native binaries that cannot load on Windows x64`
  )
  const missing = missingRequiredBinaries(unpacked)
  problems.push(
    ...missing.map((rel) => `app.asar.unpacked/${rel}: required Windows binary missing`)
  )
  console.log(
    `  app.asar.unpacked: ${REQUIRED_UNPACKED.length - missing.length}/${REQUIRED_UNPACKED.length} required Windows runtime binaries`
  )
  const packed = nativeBinariesInAsar(asar)
  for (const binary of packed) console.log(`  inside app.asar: ${binary.path} (${binary.machine})`)
  const packedForeign = packed.filter((binary) => binary.machine !== 'x64')
  problems.push(
    ...packedForeign.map(
      (binary) =>
        `app.asar/${binary.path}: ${binary.machine === 'not-pe' ? 'not a Windows binary' : `PE machine ${binary.machine}, not x64`}`
    )
  )
  console.log(
    `  inside app.asar: ${packed.length} native binaries, ${packedForeign.length} that cannot load on Windows x64`
  )
  if (sameAs) problems.push(...sameFilesProblems(asar, files, sameAs))
  if (problems.length) {
    console.error(`FAIL: ${problems.length} problem(s) in the Windows package`)
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`)
    if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
    process.exit(1)
  }
  console.log(
    'Windows app.asar contains only the built app and its runtime dependencies; native binaries are all x64 Windows'
  )
  if (sameAs) console.log(`Same app.asar entries and app.asar.unpacked files as ${sameAs}`)
}
