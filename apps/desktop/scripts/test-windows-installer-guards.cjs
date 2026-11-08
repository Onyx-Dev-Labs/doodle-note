// Native check of the install folder migration guards (build/windows-install-guards.nsh):
// compiles them into a silent NSIS harness with electron-builder's own makensis and
// runs it against real folders, junctions, a held file and real processes in a
// temporary sandbox. Windows only; nothing outside the sandbox is touched and the
// only processes it stops are the copies of ping.exe it started itself.
//
//   node scripts/test-windows-installer-guards.cjs [--keep <evidence-dir>]
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const desktop = path.resolve(__dirname, '..')

async function makensis() {
  const builder = path.dirname(
    require.resolve('electron-builder/package.json', { paths: [desktop] })
  )
  const lib = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [builder] }))
  // The same NSIS the installer is compiled with (electron-builder's default toolset).
  const { getMakeNsisPath } = require(path.join(lib, 'out', 'toolsets', 'windows.js'))
  return getMakeNsisPath('0.0.0')
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function junction(link, target) {
  execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', link, target], { stdio: 'ignore' })
}

/** A harmless long-running process whose image is `exe` (a copy of ping.exe). */
function runAs(exe) {
  fs.mkdirSync(path.dirname(exe), { recursive: true })
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), exe)
  const child = spawn(exe, ['-n', '600', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
  child.unref()
  return child
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('skipped: Windows only')
    return
  }
  const keep = process.argv.includes('--keep')
    ? process.argv[process.argv.indexOf('--keep') + 1]
    : null
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-guards-'))
  const started = []
  try {
    const nsis = await makensis()
    const exe = path.join(sandbox, 'harness.exe')
    execFileSync(
      nsis.path,
      [
        '-V2',
        '-WX',
        '-DAPP_FILENAME=desktop',
        '-DPRODUCT_FILENAME=DoodleNote',
        '-DDN_APP_EXE=DoodleNote.exe',
        `-DGUARDS=${path.join(desktop, 'build', 'windows-install-guards.nsh')}`,
        `-DOUT_FILE=${exe}`,
        path.join(__dirname, 'test-windows-installer-guards.nsi')
      ],
      { env: { ...process.env, ...nsis.env }, stdio: 'inherit' }
    )

    const root = path.join(sandbox, 'Local', 'Programs')
    const profile = path.join(sandbox, 'Roaming', 'desktop')
    const old = path.join(root, 'desktop')
    const now = path.join(root, 'DoodleNote')
    write(path.join(old, 'DoodleNote.exe'), 'old')
    write(path.join(old, 'resources', 'app.asar'), 'asar')
    fs.mkdirSync(profile, { recursive: true })

    // Aliases the guards must refuse, each in its own root.
    const aliasNew = path.join(sandbox, 'alias-new', 'Programs')
    write(path.join(aliasNew, 'desktop', 'DoodleNote.exe'), 'old')
    junction(path.join(aliasNew, 'DoodleNote'), path.join(aliasNew, 'desktop'))
    const aliasOld = path.join(sandbox, 'alias-old', 'Programs')
    write(path.join(aliasOld, 'DoodleNote', 'DoodleNote.exe'), 'new')
    junction(path.join(aliasOld, 'desktop'), path.join(aliasOld, 'DoodleNote'))
    const noExe = path.join(sandbox, 'no-exe', 'Programs')
    write(path.join(noExe, 'desktop', 'readme.txt'), 'x')
    const elsewhere = path.join(sandbox, 'elsewhere')
    write(path.join(elsewhere, 'desktop', 'DoodleNote.exe'), 'old')
    const profileRoot = path.join(sandbox, 'profile-root', 'Programs')
    write(path.join(profileRoot, 'desktop', 'DoodleNote.exe'), 'old')

    // Removal: a nested junction to a folder outside, and a file held open.
    const removeRoot = path.join(sandbox, 'remove', 'Programs')
    const outside = path.join(sandbox, 'outside')
    write(path.join(outside, 'keep.txt'), 'must survive')
    const doomed = path.join(removeRoot, 'desktop')
    write(path.join(doomed, 'DoodleNote.exe'), 'old')
    write(path.join(doomed, 'resources', 'nested', 'file.txt'), 'x')
    junction(path.join(doomed, 'resources', 'link-to-outside'), outside)
    const heldRoot = path.join(sandbox, 'held', 'Programs')
    const held = path.join(heldRoot, 'desktop')
    write(path.join(held, 'DoodleNote.exe'), 'old')
    write(path.join(held, 'locked.dat'), 'x')
    write(path.join(held, 'other.dat'), 'x')

    // Processes: the old exe, a sibling folder that shares its prefix, and the QA name.
    const running = runAs(path.join(sandbox, 'procs', 'desktop', 'DoodleNote.exe'))
    const sibling = runAs(path.join(sandbox, 'procs', 'desktop-qa', 'DoodleNote.exe'))
    const qa = runAs(path.join(sandbox, 'procs', 'DoodleNote QA', 'DoodleNote QA.exe'))
    started.push(running, sibling, qa)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const cases = [
      ['noop', 'first line', ''],
      ['root', root, profile],
      ['check', old, now, 'ok'],
      ['check', `${old}\\`, now, 'ok'],
      ['check', `${root}\\x\\..\\DESKTOP`, `${now}\\`, 'ok'],
      ['check', path.join(root, 'desktop-old'), now, /is not .*\\desktop$/],
      ['check', old, path.join(sandbox, 'D', 'DoodleNote'), /new folder is not/],
      ['root', aliasNew, profile],
      [
        'check',
        path.join(aliasNew, 'desktop'),
        path.join(aliasNew, 'DoodleNote'),
        /junction|same place/
      ],
      ['root', aliasOld, profile],
      [
        'check',
        path.join(aliasOld, 'desktop'),
        path.join(aliasOld, 'DoodleNote'),
        /junction or link/
      ],
      ['root', noExe, profile],
      [
        'check',
        path.join(noExe, 'desktop'),
        path.join(noExe, 'DoodleNote'),
        /has no DoodleNote\.exe/
      ],
      ['root', root, profile],
      ['check', path.join(elsewhere, 'desktop'), path.join(elsewhere, 'DoodleNote'), /is not/],
      ['root', profileRoot, path.join(profileRoot, 'desktop')],
      ['check', path.join(profileRoot, 'desktop'), path.join(profileRoot, 'DoodleNote'), /profile/],
      ['remove', doomed, '', 'removed'],
      ['remove', held, '', 'kept'],
      ['close', path.join(sandbox, 'procs', 'desktop'), 'never', 'running'],
      ['close', path.join(sandbox, 'procs', 'desktop'), 'close', 'closed'],
      ['close', path.join(sandbox, 'procs', 'desktop'), 'close', 'none'],
      ['locked', path.join(sandbox, 'procs', 'desktop-qa', 'DoodleNote.exe'), '', '1'],
      ['locked', path.join(old, 'DoodleNote.exe'), '', '0'],
      ['ensure', path.join(sandbox, 'procs', 'desktop'), '', 'done']
    ]
    // 8.3 short names: the old folder exists, the new one does not yet. Runner TEMP
    // paths are short already (C:\\Users\\RUNNER~1); elsewhere use the short form.
    const shortRoot = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:DN_LONG).ShortPath'
      ],
      { encoding: 'utf8', env: { ...process.env, DN_LONG: root } }
    ).trim()
    if (shortRoot && shortRoot.toLowerCase() !== root.toLowerCase()) {
      cases.push(['root', shortRoot, profile])
      cases.push(['check', `${shortRoot}\\desktop`, `${shortRoot}\\DoodleNote`, 'ok'])
      cases.push([
        'canonical',
        `${shortRoot}\\DoodleNote`,
        '',
        path.join(fs.realpathSync.native(root), 'DoodleNote')
      ])
    }
    cases.push([
      'canonical',
      path.join(root, 'not', 'yet', 'here'),
      '',
      path.join(fs.realpathSync.native(root), 'not', 'yet', 'here')
    ])
    const casesFile = path.join(sandbox, 'cases.txt')
    const outFile = path.join(sandbox, 'results.txt')
    fs.writeFileSync(
      casesFile,
      Buffer.from(cases.map(([kind, a, b]) => `${kind}|${a}|${b}\r\n`).join(''), 'utf16le')
    )

    // Hold locked.dat without sharing so the harness cannot delete it.
    const holder = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$f = [IO.File]::Open('${path.join(held, 'locked.dat')}', 'Open', 'ReadWrite', 'None'); Start-Sleep -Seconds 120; $f.Close()`
      ],
      { stdio: 'ignore', windowsHide: true }
    )
    started.push(holder)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    execFileSync(exe, [`/cases=${casesFile}`, `/out=${outFile}`], {
      stdio: 'inherit',
      timeout: 180000
    })
    const results = fs
      .readFileSync(outFile, 'utf16le')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(line.indexOf('|') + 1))
    const report = cases.map(([kind, a, b], i) => `${kind} ${a} ${b} => ${results[i]}`)
    console.log(report.join('\n'))
    if (keep) write(path.join(keep, 'installer-guards-results.txt'), report.join('\r\n') + '\r\n')

    assert.equal(results.length, cases.length)
    cases.forEach(([kind, a, , expected], i) => {
      if (expected === undefined || kind === 'root' || kind === 'noop') return
      if (expected instanceof RegExp) assert.match(results[i], expected, `${kind} ${a}`)
      else if (kind === 'canonical')
        assert.equal(results[i].toLowerCase(), expected.toLowerCase(), `${kind} ${a}`)
      else assert.equal(results[i], expected, `${kind} ${a}`)
    })
    // The link's target survived; the link and the rest of the folder did not.
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'must survive')
    assert.ok(!fs.existsSync(doomed))
    // A held file keeps the folder, and its exe, for the next run.
    assert.ok(fs.existsSync(path.join(held, 'DoodleNote.exe')))
    assert.ok(fs.existsSync(path.join(held, 'locked.dat')))
    assert.ok(!fs.existsSync(path.join(held, 'other.dat')))
    // Only the exact exe was closed: not the prefix sibling, not the QA app.
    assert.ok(!alive(running.pid), 'the old app was closed')
    assert.ok(alive(sibling.pid), 'a process in desktop-qa was left alone')
    assert.ok(alive(qa.pid), 'DoodleNote QA was left alone')
    console.log(`installer guards: ${cases.length} cases passed`)
  } finally {
    for (const child of started) {
      try {
        if (alive(child.pid)) process.kill(child.pid)
      } catch {
        // already gone
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
