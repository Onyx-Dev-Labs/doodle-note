#!/usr/bin/env node
// Builds Bark's Windows dictation helper (engine/windows/dictation-helper/*.cs) with
// the C# compiler that ships inside .NET Framework 4.8, so no SDK is needed on a
// developer PC or on the windows-latest CI runner.
//
//   node scripts/build-dictation-helper-win.cjs           -> engine/.build/windows/dictation-helper.exe
//   node scripts/build-dictation-helper-win.cjs --tests   -> also engine/.build/windows/dictation-helper-tests.exe
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '..', '..', '..')
const source = path.join(repo, 'engine', 'windows', 'dictation-helper')
const tests = path.join(repo, 'engine', 'windows', 'tests')
const out = path.join(repo, 'engine', '.build', 'windows')

function framework() {
  const windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  const dir = path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319')
  const csc = path.join(dir, 'csc.exe')
  if (!existsSync(csc)) throw new Error(`The .NET Framework 4 C# compiler was not found at ${csc}`)
  return { dir, csc }
}

function sources(dir, skip = []) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.cs') && !skip.includes(name))
    .sort()
    .map((name) => path.join(dir, name))
}

function compile(output, files) {
  const { dir, csc } = framework()
  const wpf = path.join(dir, 'WPF')
  const args = [
    '/nologo',
    // A GUI-subsystem program: no console window appears when the app starts it,
    // and stdin/stdout still work as the pipes the app passes in.
    output.endsWith('-tests.exe') ? '/target:exe' : '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    '/warnaserror+',
    '/nowarn:1607',
    `/r:${path.join(dir, 'System.Web.Extensions.dll')}`,
    `/r:${path.join(wpf, 'UIAutomationClient.dll')}`,
    `/r:${path.join(wpf, 'UIAutomationTypes.dll')}`,
    `/r:${path.join(wpf, 'WindowsBase.dll')}`,
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    `/out:${output}`,
    ...files
  ]
  execFileSync(csc, args, { stdio: 'inherit' })
  console.log(`built ${path.relative(repo, output)}`)
}

if (process.platform !== 'win32') {
  console.error('The Windows dictation helper is built on Windows only.')
  process.exit(1)
}
mkdirSync(out, { recursive: true })
const helperExe = path.join(out, 'dictation-helper.exe')
compile(helperExe, sources(source))

// A manifest beside the helper lets the app tell a damaged helper (hash mismatch) from one
// Windows refused to run (a launch failure) or one that is simply missing (dev without a build).
const version = JSON.parse(readFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), 'utf8')).version
const exeBytes = readFileSync(helperExe)
const sha256 = createHash('sha256').update(exeBytes).digest('hex')
// The signing-invariant digest (see dictation-host.stableHelperDigest): the parts of the PE that
// signing does not change, so this one value verifies both the unsigned build and the signed release.
const authenticodeSha256 = stableDigest(exeBytes)
writeFileSync(
  path.join(out, 'dictation-helper.manifest.json'),
  JSON.stringify({ name: 'dictation-helper.exe', version, sha256, authenticodeSha256 }, null, 2) + '\n'
)
console.log(`manifest authenticode=${(authenticodeSha256 || '').slice(0, 12)}… version=${version}`)

// Mirror of dictation-host.stableHelperDigest.
function stableDigest(buffer) {
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null
  const pe = buffer.readUInt32LE(0x3c)
  if (pe + 24 + 96 > buffer.length || buffer.readUInt32LE(pe) !== 0x00004550) return null
  const optional = pe + 24
  const magic = buffer.readUInt16LE(optional)
  const checksumOffset = optional + 64
  const dataDir = optional + (magic === 0x20b ? 112 : 96)
  const secEntry = dataDir + 4 * 8
  if (secEntry + 8 > buffer.length) return null
  const certVa = buffer.readUInt32LE(secEntry)
  const certSize = buffer.readUInt32LE(secEntry + 4)
  const certStart = certSize > 0 && certVa > 0 ? certVa : buffer.length
  const hash = createHash('sha256')
  hash.update(buffer.subarray(0, checksumOffset))
  hash.update(buffer.subarray(checksumOffset + 4, secEntry))
  hash.update(buffer.subarray(secEntry + 8, Math.min(certStart, buffer.length)))
  return hash.digest('hex')
}
if (process.argv.includes('--tests')) {
  compile(path.join(out, 'dictation-helper-tests.exe'), [
    ...sources(source, ['Program.cs']),
    ...sources(tests)
  ])
}
