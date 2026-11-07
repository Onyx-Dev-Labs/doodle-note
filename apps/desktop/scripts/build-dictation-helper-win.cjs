#!/usr/bin/env node
// Builds Bark's Windows dictation helper (engine/windows/dictation-helper/*.cs) with
// the C# compiler that ships inside .NET Framework 4.8, so no SDK is needed on a
// developer PC or on the windows-latest CI runner.
//
//   node scripts/build-dictation-helper-win.cjs           -> engine/.build/windows/dictation-helper.exe
//   node scripts/build-dictation-helper-win.cjs --tests   -> also engine/.build/windows/dictation-helper-tests.exe
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readdirSync } = require('node:fs')
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
compile(path.join(out, 'dictation-helper.exe'), sources(source))
if (process.argv.includes('--tests')) {
  compile(path.join(out, 'dictation-helper-tests.exe'), [
    ...sources(source, ['Program.cs']),
    ...sources(tests)
  ])
}
