#!/usr/bin/env node
// Packaged-content check for the Windows build: lists resources/app.asar and fails
// if app source, build scripts, docs, tests or sourcemaps were bundled into it, or
// if app.asar.unpacked carries native binaries for another OS or CPU (they cannot
// load, and cannot be Authenticode-signed).
//
//   node scripts/test-windows-package.cjs <win-unpacked dir | app.asar> [--list out.txt]
//
// Reads the asar header directly (no @electron/asar dependency): the file starts
// with a Chromium pickle holding the JSON directory tree.
const fs = require('node:fs')
const path = require('node:path')

function readAsarHeader(file) {
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
    return JSON.parse(headerBuf.subarray(8, 8 + jsonLength).toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
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

/** 'x64', another PE machine as hex, or 'not-pe' (an ELF / Mach-O build for another OS). */
function peMachine(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(64)
    if (fs.readSync(fd, head, 0, 64, 0) < 64 || head.toString('latin1', 0, 2) !== 'MZ')
      return 'not-pe'
    const peOffset = head.readUInt32LE(0x3c)
    const pe = Buffer.alloc(6)
    if (fs.readSync(fd, pe, 0, 6, peOffset) < 6 || pe.toString('latin1', 0, 4) !== 'PE\0\0')
      return 'not-pe'
    const machine = pe.readUInt16LE(4)
    return machine === IMAGE_FILE_MACHINE_AMD64 ? 'x64' : `0x${machine.toString(16)}`
  } finally {
    fs.closeSync(fd)
  }
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

module.exports = { readAsarHeader, listAsar, problemsFor, peMachine, foreignNativeBinaries }

if (require.main === module) {
  const args = process.argv.slice(2)
  const listIndex = args.indexOf('--list')
  const listFile = listIndex >= 0 ? args.splice(listIndex, 2)[1] : null
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
  if (problems.length) {
    console.error(`FAIL: ${problems.length} file(s) must not ship in app.asar`)
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`)
    if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`)
    process.exit(1)
  }
  console.log(
    'Windows app.asar contains only the built app and its runtime dependencies; native binaries are all x64 Windows'
  )
}
