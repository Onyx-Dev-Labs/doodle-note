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
const IDENTITY = 'guards-test|desktop|DoodleNote'

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

/** Runs a Windows PowerShell script with `data` as JSON in $env:DN_DATA; returns its output. */
function powershell(script, data) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, DN_DATA: JSON.stringify(data) }
  })
}

/** Creates .lnk files (WScript.Shell, as Explorer would) from {file, target, ...} specs. */
function makeShortcuts(specs) {
  powershell(
    '$sh = New-Object -ComObject WScript.Shell; foreach ($l in ($env:DN_DATA | ConvertFrom-Json)) { $s = $sh.CreateShortcut($l.file); $s.TargetPath = $l.target; if ($l.args) { $s.Arguments = $l.args }; if ($l.description) { $s.Description = $l.description }; if ($l.icon) { $s.IconLocation = $l.icon }; if ($l.workdir) { $s.WorkingDirectory = $l.workdir }; $s.Save() }',
    specs
  )
}

/** Reads back target, arguments, description, icon and working folder of .lnk files. */
function readShortcuts(files) {
  return JSON.parse(
    powershell(
      '$sh = New-Object -ComObject WScript.Shell; ConvertTo-Json -Compress @(foreach ($f in ($env:DN_DATA | ConvertFrom-Json)) { $s = $sh.CreateShortcut($f); [pscustomobject]@{ target = $s.TargetPath; args = $s.Arguments; description = $s.Description; icon = $s.IconLocation; workdir = $s.WorkingDirectory } })',
      files
    )
  )
}

/** A harmless long-running process whose image is `exe` (a copy of ping.exe). */
function runAs(exe) {
  fs.mkdirSync(path.dirname(exe), { recursive: true })
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), exe)
  const child = spawn(exe, ['-n', '600', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
  child.unref()
  return child
}

/** The 8.3 short form of an existing path (the long form when 8.3 names are off). */
function shortPath(long) {
  return (
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$f = $env:DN_LONG; $fso = New-Object -ComObject Scripting.FileSystemObject; if (Test-Path -LiteralPath $f -PathType Container) { $fso.GetFolder($f).ShortPath } else { $fso.GetFile($f).ShortPath }'
      ],
      { encoding: 'utf8', env: { ...process.env, DN_LONG: long } }
    ).trim() || long
  )
}

/** Writes `cases` for the harness `exe`, runs it, and returns one result per case. */
function runCases(exe, sandbox, name, cases, { status = 0, timeout = 180000 } = {}) {
  const casesFile = path.join(sandbox, `${name}-cases.txt`)
  const outFile = path.join(sandbox, `${name}-results.txt`)
  fs.writeFileSync(
    casesFile,
    Buffer.from(cases.map((c) => `${fields(c).join('|')}\r\n`).join(''), 'utf16le')
  )
  const started = Date.now()
  let exit = 0
  try {
    execFileSync(exe, [`/cases=${casesFile}`, `/out=${outFile}`], { stdio: 'inherit', timeout })
  } catch (error) {
    if (typeof error.status !== 'number') throw error
    exit = error.status
  }
  assert.equal(exit, status, `${name}: harness exit code`)
  const results = fs.existsSync(outFile)
    ? fs
        .readFileSync(outFile, 'utf16le')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(line.indexOf('|') + 1))
    : []
  return { results, elapsed: Date.now() - started }
}

/** Checks results against [kind, a, b, (c,) expected] cases. */
function checkCases(name, cases, results) {
  cases.forEach((c, i) => {
    const [kind, a] = c
    const expected = expectation(c)
    if (expected === undefined || ['root', 'noop', 'jkey', 'skey', 'ukey'].includes(kind)) return
    const label = `${name}: ${kind} ${a}`
    if (expected instanceof RegExp) assert.match(results[i], expected, label)
    else if (typeof expected === 'function')
      assert.ok(expected(results[i]), `${label}: ${results[i]}`)
    else if (kind === 'canonical')
      assert.equal(results[i].toLowerCase(), expected.toLowerCase(), label)
    else assert.equal(results[i], expected, label)
  })
}

/** Holds `file` open without sharing until the returned process is killed. */
function hold(file) {
  return spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$f = [IO.File]::Open($env:DN_HOLD, 'Open', 'ReadWrite', 'None'); Start-Sleep -Seconds 300; $f.Close()"
    ],
    { stdio: 'ignore', windowsHide: true, env: { ...process.env, DN_HOLD: file } }
  )
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A case is [kind, a, b, expected] or, for kinds with a third field, [kind, a, b, c, expected].
 */
const THREE_FIELDS = new Set(['arm', 'migclose', 'finish', 'pins'])
let d3ShortTested = false
const fields = (c) => (THREE_FIELDS.has(c[0]) ? c.slice(0, 4) : c.slice(0, 3))
const expectation = (c) => (THREE_FIELDS.has(c[0]) ? c[4] : c[3])

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
  /** Files held open (no sharing) while the harness runs. */
  const holds = []
  /** Throwaway HKCU keys the harness writes; deleted afterwards. */
  const registryKeys = []
  const pinFiles = {}
  const pinBefore = []
  const pinBytes = new Map()
  try {
    const nsis = await makensis()
    const compile = (out, extra = []) =>
      execFileSync(
        nsis.path,
        [
          '-V2',
          '-WX',
          '-DAPP_FILENAME=desktop',
          '-DPRODUCT_FILENAME=DoodleNote',
          '-DDN_APP_EXE=DoodleNote.exe',
          '-DDN_UNINSTALLER_EXE=Uninstall DoodleNote.exe',
          `-DDN_MIGRATION_IDENTITY=${IDENTITY}`,
          `-DGUARDS=${path.join(desktop, 'build', 'windows-install-guards.nsh')}`,
          `-DOUT_FILE=${out}`,
          ...extra,
          path.join(__dirname, 'test-windows-installer-guards.nsi')
        ],
        { env: { ...process.env, ...nsis.env }, stdio: 'inherit' }
      )
    const exe = path.join(sandbox, 'harness.exe')
    compile(exe)
    // D5: the same guards with a closer that never answers and short watchdogs.
    const stallMarker = `dn-stall-${path.basename(sandbox)}`
    const stallExe = path.join(sandbox, 'harness-stall.exe')
    compile(stallExe, [
      `-DDN_CLOSE_PS=Start-Sleep -Seconds 600; '${stallMarker}'`,
      '-DDN_CLOSE_FIND_TIMEOUT_MS=3000',
      '-DDN_CLOSE_TIMEOUT_MS=3000'
    ])

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
    holds.push(path.join(held, 'locked.dat'))

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
    const lower = (value) => value.toLowerCase()
    const real = (...parts) => path.join(fs.realpathSync.native(parts[0]), ...parts.slice(1))
    const journalKey = `Software\\DoodleNoteGuardsTest-${path.basename(sandbox)}`
    registryKeys.push(journalKey)
    cases.push(['jkey', `${journalKey}\\InstallMigration`, ''])
    cases.push(['skey', journalKey, ''])
    cases.push(['record', '', '', 'none'])

    // L1: only <Programs>\desktop itself is redirected; any other folder named
    // desktop (an earlier /D=X\desktop) is upgraded in place, never moved or deleted.
    const mig = path.join(sandbox, 'mig', 'Local', 'Programs')
    const migProfile = path.join(sandbox, 'mig', 'Roaming', 'desktop')
    write(path.join(mig, 'desktop', 'DoodleNote.exe'), 'old')
    write(path.join(mig, 'desktop', 'resources', 'app.asar'), 'asar')
    write(path.join(mig, 'DoodleNote', 'DoodleNote.exe'), 'new')
    fs.mkdirSync(migProfile, { recursive: true })
    const otherParent = path.join(sandbox, 'mig', 'Other')
    write(path.join(otherParent, 'desktop', 'DoodleNote.exe'), 'old')
    write(path.join(otherParent, 'desktop', 'resources', 'app.asar'), 'asar')
    const otherEmpty = path.join(sandbox, 'mig', 'OtherEmpty', 'desktop')
    fs.mkdirSync(otherEmpty, { recursive: true })
    const fresh = path.join(sandbox, 'fresh', 'Programs')
    fs.mkdirSync(fresh, { recursive: true })
    const moved = `${lower(real(mig, 'DoodleNote'))}|${lower(real(mig, 'desktop'))}|`
    cases.push(['root', mig, migProfile])
    cases.push(['plan', path.join(mig, 'desktop'), '', (r) => lower(r) === moved])
    cases.push(['plan', `${path.join(mig, 'desktop')}\\`, '', (r) => lower(r) === moved])
    cases.push(['plan', path.join(mig, 'desktop').toUpperCase(), '', (r) => lower(r) === moved])
    cases.push([
      'plan',
      path.join(otherParent, 'desktop'),
      '',
      (r) => r.startsWith(`${path.join(otherParent, 'desktop')}||`) && / is not in /.test(r)
    ])
    cases.push([
      'plan',
      otherEmpty,
      '',
      (r) => r.startsWith(`${otherEmpty}||`) && / is not in /.test(r)
    ])
    cases.push(['plan', path.join(mig, 'Custom'), '', `${path.join(mig, 'Custom')}||`])
    // Defence in depth: even if asked, the finish step refuses that folder.
    cases.push([
      'finish',
      path.join(otherParent, 'desktop'),
      path.join(otherParent, 'DoodleNote'),
      '0',
      /^kept: the old folder is not /
    ])
    cases.push(['record', '', '', 'none'])
    cases.push(['root', fresh, path.join(sandbox, 'fresh', 'Roaming', 'desktop')])
    cases.push([
      'plan',
      path.join(fresh, 'desktop'),
      '',
      (r) => lower(r) === `${lower(real(fresh, 'DoodleNote'))}||`
    ])

    // L3: a pending migration with the old app running AND the new exe present.
    const l3 = path.join(sandbox, 'l3', 'Local', 'Programs')
    const l3Profile = path.join(sandbox, 'l3', 'Roaming', 'desktop')
    fs.mkdirSync(l3Profile, { recursive: true })
    write(path.join(l3, 'desktop', 'resources', 'app.asar'), 'asar')
    write(path.join(l3, 'desktop', 'locked.dat'), 'x')
    write(path.join(l3, 'DoodleNote', 'DoodleNote.exe'), 'new')
    const l3Old = runAs(path.join(l3, 'desktop', 'DoodleNote.exe'))
    started.push(l3Old)
    const l3Source = path.join(l3, 'desktop')
    const l3Dest = path.join(l3, 'DoodleNote')
    const trusted = (r) => lower(r) === lower(real(l3, 'desktop'))
    cases.push(['root', l3, l3Profile])
    cases.push(['jstate', '', '', 'none'])
    cases.push(['arm', l3Source, l3Dest, 'someone-else|desktop|DoodleNote', 'armed'])
    cases.push(['journal', l3Dest, '', /^none: the migration journal is for another app/])
    cases.push(['arm', l3Source, l3Dest, '', 'armed'])
    cases.push([
      'journal',
      path.join(mig, 'DoodleNote'),
      '',
      /^none: the migration journal is for /
    ])
    cases.push(['journal', l3Dest, '', trusted])
    // The old app could not be closed (KEEP=1): keep the old folder, journal armed.
    // (A silent run without --updated now quits instead: the D6 run below.)
    cases.push(['finish', l3Source, l3Dest, '1', /^kept: .* is still running/])
    cases.push(['jstate', '', '', 'armed'])
    cases.push(['record', '', '', 'none'])
    cases.push(['journal', l3Dest, '', trusted])
    // --updated: the closer closes exactly the old app although the new exe exists.
    cases.push(['migclose', l3Source, l3Dest, 'close', '0'])
    // A file there is still held: removal refuses, the exe stays, the journal stays armed.
    cases.push(['finish', l3Source, l3Dest, '0', 'kept: a file is still in use'])
    cases.push(['jstate', '', '', 'armed'])
    cases.push(['record', '', '', 'none'])
    cases.push(['journal', l3Dest, '', trusted])
    holds.push(path.join(l3, 'desktop', 'locked.dat'))

    // H2: a real move (old folder removed) writes the MigratedFrom/To/At record the
    // app requires before it repoints anything; the journal is cleared.
    const migSource = path.join(mig, 'desktop')
    const migDest = path.join(mig, 'DoodleNote')
    const migRecord = `${lower(real(mig, 'desktop'))}|${lower(real(mig, 'DoodleNote'))}|`
    cases.push(['root', mig, migProfile])
    cases.push(['arm', migSource, migDest, '', 'armed'])
    cases.push(['finish', migSource, migDest, '0', 'removed'])
    cases.push(['jstate', '', '', 'none'])
    cases.push([
      'record',
      '',
      '',
      (r) => lower(r).startsWith(migRecord) && /\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r)
    ])

    // L6: shortcut presence is recorded once per migration, before anything changes.
    const present = path.join(sandbox, 'links', 'present.lnk')
    const missing = path.join(sandbox, 'links', 'missing.lnk')
    write(present, 'x')
    cases.push(['linkstate', 'DesktopLink', present, '1'])
    cases.push(['linkstate', 'DesktopLink', missing, '1'])
    cases.push(['linkstate', 'StartMenuLink', missing, '0'])
    cases.push(['linkstate', 'StartMenuLink', present, '0'])

    // L6: taskbar pins of any name that start exactly the old exe are repointed;
    // nothing else is touched or created.
    const pinApp = path.join(sandbox, 'pin-app', 'Programs')
    const pinOld = path.join(pinApp, 'desktop', 'DoodleNote.exe')
    const pinNew = path.join(pinApp, 'DoodleNote', 'DoodleNote.exe')
    const pinSibling = path.join(pinApp, 'desktop-qa', 'DoodleNote.exe')
    const pinOther = path.join(pinApp, 'desktop', 'Other.exe')
    for (const file of [pinOld, pinNew, pinSibling, pinOther]) write(file, 'x')
    const pins = path.join(sandbox, 'pins')
    const notepad = path.join(process.env.SystemRoot, 'System32', 'notepad.exe')
    pinFiles.A = path.join(pins, 'My DoodleNote.lnk')
    pinFiles.B = path.join(pins, 'Notepad.lnk')
    pinFiles.C = path.join(pins, 'Upper.lnk')
    pinFiles.D = path.join(pins, 'Sibling.lnk')
    pinFiles.E = path.join(pins, 'Other.lnk')
    fs.mkdirSync(pins, { recursive: true })
    write(path.join(pins, 'notes.txt'), 'not a shortcut')
    makeShortcuts([
      {
        file: pinFiles.A,
        target: pinOld,
        args: '--hidden',
        description: 'keep me',
        icon: `${pinOld},0`,
        workdir: path.dirname(pinOld)
      },
      { file: pinFiles.B, target: notepad },
      { file: pinFiles.C, target: pinOld.toUpperCase() },
      { file: pinFiles.D, target: pinSibling },
      { file: pinFiles.E, target: pinOther }
    ])
    pinBefore.push(...readShortcuts(Object.values(pinFiles)))
    for (const file of [pinFiles.B, pinFiles.D, pinFiles.E])
      pinBytes.set(file, fs.readFileSync(file))
    cases.push(['pins', pins, pinOld, pinNew, '2'])
    cases.push(['pins', pins, pinOld, pinNew, '0'])
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
      // L1: an install recorded under the short form of Programs is still the old default.
      cases.push([
        'plan',
        `${shortRoot}\\desktop`,
        '',
        (r) =>
          r.toLowerCase() === `${real(root, 'DoodleNote')}|${real(root, 'desktop')}|`.toLowerCase()
      ])
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

    // D1: overlap with the profile is checked on resolved paths too.
    // (a) The profile is a junction into the old install.
    const d1a = path.join(sandbox, 'd1a', 'Local', 'Programs')
    const d1aOld = path.join(d1a, 'desktop')
    write(path.join(d1aOld, 'DoodleNote.exe'), 'old')
    write(path.join(d1aOld, 'resources', 'app.asar'), 'asar')
    const d1aProfile = path.join(sandbox, 'd1a', 'Roaming', 'desktop')
    fs.mkdirSync(path.dirname(d1aProfile), { recursive: true })
    junction(d1aProfile, path.join(d1aOld, 'resources'))
    cases.push(['root', d1a, d1aProfile])
    cases.push([
      'check',
      d1aOld,
      path.join(d1a, 'DoodleNote'),
      /old folder really overlaps the app profile/
    ])
    cases.push([
      'plan',
      d1aOld,
      '',
      (r) => r.startsWith(`${d1aOld}||`) && /overlaps the app profile/.test(r)
    ])
    cases.push([
      'finish',
      d1aOld,
      path.join(d1a, 'DoodleNote'),
      '0',
      /^kept: the old folder really overlaps/
    ])
    // (b) The Programs folder is a junction into the profile: the old install lies inside it.
    const d1bProfile = path.join(sandbox, 'd1b', 'Roaming', 'desktop')
    write(path.join(d1bProfile, 'inner', 'desktop', 'DoodleNote.exe'), 'old')
    write(path.join(d1bProfile, 'inner', 'desktop', 'resources', 'app.asar'), 'asar')
    const d1b = path.join(sandbox, 'd1b', 'Local', 'Programs')
    fs.mkdirSync(path.dirname(d1b), { recursive: true })
    junction(d1b, path.join(d1bProfile, 'inner'))
    cases.push(['root', d1b, d1bProfile])
    cases.push([
      'check',
      path.join(d1b, 'desktop'),
      path.join(d1b, 'DoodleNote'),
      /old folder really overlaps the app profile/
    ])
    // (b') The old folder itself is a junction into the profile.
    const d1b2 = path.join(sandbox, 'd1b2', 'Local', 'Programs')
    const d1b2Profile = path.join(sandbox, 'd1b2', 'Roaming', 'desktop')
    write(path.join(d1b2Profile, 'DoodleNote.exe'), 'profile file')
    fs.mkdirSync(d1b2, { recursive: true })
    junction(path.join(d1b2, 'desktop'), d1b2Profile)
    cases.push(['root', d1b2, d1b2Profile])
    cases.push([
      'check',
      path.join(d1b2, 'desktop'),
      path.join(d1b2, 'DoodleNote'),
      /junction or link|overlaps/
    ])
    // (c) The old install is an ancestor of the profile: Roaming is a junction into
    // it; the profile does not exist yet, then does.
    const d1c = path.join(sandbox, 'd1c', 'Local', 'Programs')
    const d1cOld = path.join(d1c, 'desktop')
    write(path.join(d1cOld, 'DoodleNote.exe'), 'old')
    write(path.join(d1cOld, 'resources', 'app.asar'), 'asar')
    const d1cRoaming = path.join(sandbox, 'd1c', 'Roaming')
    junction(d1cRoaming, d1cOld)
    const d1cProfile = path.join(d1cRoaming, 'desktop')
    cases.push(['root', d1c, d1cProfile])
    cases.push([
      'check',
      d1cOld,
      path.join(d1c, 'DoodleNote'),
      /old folder really overlaps the app profile/
    ])
    cases.push([
      'finish',
      d1cOld,
      path.join(d1c, 'DoodleNote'),
      '0',
      /^kept: the old folder really overlaps/
    ])
    // dnResolved: a missing path below a junction resolves through it.
    cases.push([
      'resolved',
      path.join(d1cRoaming, 'not', 'yet'),
      '',
      (r) => lower(r) === lower(`\\\\?\\${path.join(fs.realpathSync.native(d1cOld), 'not', 'yet')}`)
    ])

    // D2: the deleter verifies identity by handle. A path that no longer is the
    // pinned folder is refused before anything in it is touched.
    const pinA = path.join(sandbox, 'd2', 'A')
    const pinB = path.join(sandbox, 'd2', 'B')
    write(path.join(pinA, 'a.txt'), 'a')
    write(path.join(pinA, 'sub', 'a2.txt'), 'a')
    write(path.join(pinB, 'b.txt'), 'must survive')
    write(path.join(pinB, 'sub', 'b2.txt'), 'must survive')
    const pinJ = path.join(sandbox, 'd2', 'J')
    junction(pinJ, pinB)
    cases.push(['removeat', pinB, pinA, 'unsafe'])
    cases.push(['removeat', pinJ, pinA, 'unsafe'])
    cases.push(['removeat', pinA, pinA, 'ok'])

    // D3: the registered uninstall command is parsed and compared normalised.
    const d3Journal = `${journalKey}\\D3\\InstallMigration`
    const u1 = `${journalKey}\\Uninstall1`
    const u2 = `${journalKey}\\Uninstall2`
    const longOld = real(root, 'desktop')
    const shortOldRoot = shortPath(root)
    const shortOld = `${shortOldRoot}\\desktop`
    d3ShortTested = lower(shortOld) !== lower(longOld)
    const cmd = (dir, rest = ' /currentuser') => `"${dir}\\Uninstall DoodleNote.exe"${rest}`
    cases.push(['root', root, profile])
    cases.push(['jkey', d3Journal, ''])
    cases.push(['ukey', u1, u2])
    cases.push(['uninstof', cmd(shortOld), '', (r) => lower(r) === lower(longOld)])
    cases.push(['uninstof', cmd(longOld), '', (r) => lower(r) === lower(longOld)])
    cases.push(['uninstof', cmd(longOld, ' /currentuser --updated'), '', 'none'])
    cases.push(['uninstof', cmd(longOld, ' /allusers'), '', 'none'])
    cases.push(['uninstof', `"${longOld}\\Other.exe" /currentuser`, '', 'none'])
    cases.push(['uninstof', `${longOld}\\Uninstall DoodleNote.exe /currentuser`, '', 'none'])
    // The old install registered through short names: parked, verbatim.
    cases.push(['ucmd', cmd(shortOld), '1', 'set'])
    cases.push(['ucmd', '', '2', 'set'])
    cases.push(['ucheck', old, now, 'ok'])
    cases.push(['park', old, now, 'parked'])
    cases.push(['uread', '', '', '|'])
    cases.push(['jread', 'LegacyUninstallString', '', cmd(shortOld)])
    cases.push(['jread', 'SourceDir', '', old])
    // A command that is not exactly the old (or new) folder's own uninstaller: refused, nothing written.
    const foreign = cmd(path.join(sandbox, 'Elsewhere'))
    cases.push(['jkey', `${journalKey}\\D3b\\InstallMigration`, ''])
    cases.push(['ucmd', foreign, '1', 'set'])
    cases.push(['ucheck', old, now, /not the old folder's own uninstaller/])
    cases.push(['park', old, now, /^refused: /])
    cases.push(['uread', '', '', `${foreign}|`])
    cases.push(['jstate', '', '', 'none'])
    cases.push(['ucmd', cmd(longOld, ' /currentuser --keep-shortcuts'), '1', 'set'])
    cases.push(['ucheck', old, now, /not the old folder's own uninstaller/])
    // Key 2 is checked as well.
    cases.push(['ucmd', cmd(shortOld), '1', 'set'])
    cases.push(['ucmd', foreign, '2', 'set'])
    cases.push(['ucheck', old, now, /not the old folder's own uninstaller/])
    cases.push(['ucmd', cmd(longOld), '2', 'set'])
    cases.push(['ucheck', old, now, 'ok'])
    cases.push(['park', old, now, 'parked'])
    cases.push(['uread', '', '', '|'])
    // The new folder's own command (an interrupted run) is fine and stays.
    cases.push(['ucmd', cmd(real(root, 'DoodleNote')), '1', 'set'])
    cases.push(['ucheck', old, now, 'ok'])
    cases.push(['park', old, now, 'nothing to park'])
    cases.push(['uread', '', '', `${cmd(real(root, 'DoodleNote'))}|`])
    // In customInit a refused command means: upgrade in place (pinned in windows-installer.nsh).

    const casesFile = path.join(sandbox, 'cases.txt')
    const outFile = path.join(sandbox, 'results.txt')
    fs.writeFileSync(
      casesFile,
      Buffer.from(cases.map((c) => `${fields(c).join('|')}\r\n`).join(''), 'utf16le')
    )

    // Hold each file without sharing so the harness cannot delete it.
    for (const file of holds) {
      const holder = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$f = [IO.File]::Open($env:DN_HOLD, 'Open', 'ReadWrite', 'None'); Start-Sleep -Seconds 120; $f.Close()"
        ],
        { stdio: 'ignore', windowsHide: true, env: { ...process.env, DN_HOLD: file } }
      )
      started.push(holder)
    }
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
    const report = cases.map((c, i) => `${fields(c).join(' ')} => ${results[i]}`)
    console.log(report.join('\n'))
    if (keep) write(path.join(keep, 'installer-guards-results.txt'), report.join('\r\n') + '\r\n')

    assert.equal(results.length, cases.length)
    cases.forEach((c, i) => {
      const [kind, a] = c
      const expected = expectation(c)
      if (expected === undefined || ['root', 'noop', 'jkey'].includes(kind)) return
      if (expected instanceof RegExp) assert.match(results[i], expected, `${kind} ${a}`)
      else if (typeof expected === 'function')
        assert.ok(expected(results[i]), `${kind} ${a}: ${results[i]}`)
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
    // L1: the install in another folder named desktop is intact.
    assert.ok(fs.existsSync(path.join(otherParent, 'desktop', 'DoodleNote.exe')))
    assert.ok(fs.existsSync(path.join(otherParent, 'desktop', 'resources', 'app.asar')))
    assert.ok(!fs.existsSync(path.join(otherParent, 'DoodleNote')))
    // L3: the old app was closed by exact path; its exe and held file stay for the retry.
    assert.ok(!alive(l3Old.pid), 'the old app in the pending migration was closed')
    assert.ok(fs.existsSync(path.join(l3, 'desktop', 'DoodleNote.exe')))
    assert.ok(fs.existsSync(path.join(l3, 'desktop', 'locked.dat')))
    assert.ok(fs.existsSync(path.join(l3, 'DoodleNote', 'DoodleNote.exe')))
    // L6: the two pins that started the old exe now start the new one, keeping
    // their arguments and description; the others are byte-for-byte untouched.
    const pinAfter = readShortcuts(Object.values(pinFiles))
    const [a, b, c, d, e] = pinAfter
    // Paths compared resolved: Windows may store a long or an 8.3 form (the runner's TEMP is 8.3).
    const same = (stored, expected) =>
      lower(fs.realpathSync.native(stored)) === lower(fs.realpathSync.native(expected))
    assert.ok(same(a.target, pinNew), a.target)
    assert.equal(a.args, '--hidden')
    assert.equal(a.description, 'keep me')
    assert.match(a.icon, /,0$/)
    assert.ok(same(a.icon.replace(/,0$/, ''), pinNew), a.icon)
    assert.ok(same(a.workdir, path.dirname(pinNew)), a.workdir)
    assert.ok(same(c.target, pinNew), c.target)
    assert.deepEqual([b, d, e], [pinBefore[1], pinBefore[3], pinBefore[4]])
    for (const [file, bytes] of pinBytes) assert.ok(fs.readFileSync(file).equals(bytes), file)
    assert.equal(fs.readFileSync(path.join(pins, 'notes.txt'), 'utf8'), 'not a shortcut')
    assert.deepEqual(
      fs.readdirSync(pins).sort(),
      [
        'My DoodleNote.lnk',
        'notes.txt',
        'Notepad.lnk',
        'Other.lnk',
        'Sibling.lnk',
        'Upper.lnk'
      ].sort()
    )
    if (keep)
      write(
        path.join(keep, 'installer-guards-pins.json'),
        JSON.stringify({ pinBefore, pinAfter }, null, 2)
      )
    // H2: the real move removed the old folder and kept the new one.
    assert.ok(!fs.existsSync(migSource))
    assert.ok(fs.existsSync(path.join(migDest, 'DoodleNote.exe')))
    // D1: nothing was removed where the profile overlaps the old folder.
    assert.ok(fs.existsSync(path.join(d1aOld, 'resources', 'app.asar')))
    assert.ok(fs.existsSync(path.join(d1cOld, 'resources', 'app.asar')))
    assert.ok(fs.existsSync(path.join(d1b2Profile, 'DoodleNote.exe')))
    // D2: the folder that was not the pinned one is intact; the pinned one was emptied.
    assert.equal(fs.readFileSync(path.join(pinB, 'b.txt'), 'utf8'), 'must survive')
    assert.equal(fs.readFileSync(path.join(pinB, 'sub', 'b2.txt'), 'utf8'), 'must survive')
    assert.deepEqual(fs.readdirSync(pinA), [])
    if (!d3ShortTested)
      console.log(
        'note: 8.3 names are off here; the short-name command case ran with the long form'
      )
    let total = cases.length
    const reports = [...report]
    const phase = (name, phaseCases, options) => {
      const { results, elapsed } = runCases(options?.exe ?? exe, sandbox, name, phaseCases, options)
      const lines = phaseCases.map(
        (c, i) => `${fields(c).join(' ')} => ${results[i] ?? '(not reached)'}`
      )
      console.log(`--- ${name} (${elapsed} ms)\n${lines.join('\n')}`)
      reports.push(`--- ${name} (${elapsed} ms)`, ...lines)
      total += phaseCases.length
      return { results, elapsed }
    }

    // D2: a second process swaps folders for junctions to an outside folder while
    // the old folder is being removed. Nothing outside may be deleted.
    const raceRoot = path.join(sandbox, 'race', 'Local', 'Programs')
    const raceProfile = path.join(sandbox, 'race', 'Roaming', 'desktop')
    const raceOld = path.join(raceRoot, 'desktop')
    const raceOutside = path.join(sandbox, 'race-outside')
    fs.mkdirSync(raceProfile, { recursive: true })
    write(path.join(raceOld, 'DoodleNote.exe'), 'old')
    for (let i = 0; i < 600; i++) {
      const dir = path.join(raceOld, `s${String(i).padStart(3, '0')}`)
      write(path.join(dir, 'inner', 'f.txt'), 'x')
      for (let j = 0; j < 3; j++) write(path.join(dir, `f${j}.txt`), 'x')
    }
    const outsideFiles = []
    for (let i = 0; i < 20; i++) {
      const file = path.join(raceOutside, `keep${i}.txt`)
      write(file, `outside ${i}`)
      outsideFiles.push(file)
    }
    write(path.join(raceOutside, 'deep', 'keep.txt'), 'outside deep')
    outsideFiles.push(path.join(raceOutside, 'deep', 'keep.txt'))
    const swapLog = path.join(sandbox, 'race-swapper.txt')
    const swapper = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$L = $env:DN_OLD; $O = $env:DN_OUT; $ok = 0; $fail = 0; $end = (Get-Date).AddSeconds(20); while ((Get-Date) -lt $end -and (Test-Path -LiteralPath $L)) { foreach ($d in @(Get-ChildItem -LiteralPath $L -Directory -ErrorAction SilentlyContinue | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $_.Name -notlike '*.moved' } | Sort-Object Name -Descending)) { foreach ($t in @((Join-Path $d.FullName 'inner'), $d.FullName)) { try { [IO.Directory]::Move($t, $t + '.moved'); New-Item -ItemType Junction -Path $t -Target $O -ErrorAction Stop | Out-Null; $ok++ } catch { $fail++ } } } }; \"swapped=$ok failed=$fail\" | Set-Content -LiteralPath $env:DN_LOG"
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, DN_OLD: raceOld, DN_OUT: raceOutside, DN_LOG: swapLog }
      }
    )
    started.push(swapper)
    // Let the swapper start (PowerShell takes a moment), then race it.
    await new Promise((resolve) => setTimeout(resolve, 700))
    const race = [
      ['root', raceRoot, raceProfile],
      ['remove', raceOld, '', /^(removed|kept|unsafe)$/]
    ]
    const raceRun = phase('d2-race', race)
    checkCases('d2-race', race, raceRun.results)
    await new Promise((resolve) => {
      if (swapper.exitCode !== null) resolve()
      else swapper.on('exit', resolve)
    })
    const swapStats = fs.existsSync(swapLog) ? fs.readFileSync(swapLog, 'utf8').trim() : 'no log'
    reports.push(`d2-race swapper: ${swapStats}; remove => ${raceRun.results[1]}`)
    console.log(`d2-race swapper: ${swapStats}`)
    for (const [i, file] of outsideFiles.entries())
      assert.equal(
        fs.readFileSync(file, 'utf8'),
        i === outsideFiles.length - 1 ? 'outside deep' : `outside ${i}`,
        file
      )
    assert.match(swapStats, /swapped=\d+ failed=\d+/)
    const [, swapped, failed] = /swapped=(\d+) failed=(\d+)/.exec(swapStats).map(Number)
    assert.ok(swapped + failed > 0, 'the swapper raced the removal')

    // D4: the journal survives electron-builder's uninstaller deleting
    // Software\{APP_GUID} on every run: a file held across two runs, a third finishes.
    const d4 = path.join(sandbox, 'd4', 'Local', 'Programs')
    const d4Profile = path.join(sandbox, 'd4', 'Roaming', 'desktop')
    const d4Old = path.join(d4, 'desktop')
    const d4New = path.join(d4, 'DoodleNote')
    fs.mkdirSync(d4Profile, { recursive: true })
    write(path.join(d4Old, 'DoodleNote.exe'), 'old')
    write(path.join(d4Old, 'resources', 'app.asar'), 'asar')
    write(path.join(d4Old, 'locked.dat'), 'x')
    write(path.join(d4New, 'DoodleNote.exe'), 'new')
    const d4State = `${journalKey}-d4`
    registryKeys.push(d4State)
    const d4Setup = [
      ['root', d4, d4Profile],
      ['jkey', `${d4State}\\InstallMigration`, ''],
      ['skey', d4State, ''],
      ['ukey', `${d4State}-uninstall`, '']
    ]
    registryKeys.push(`${d4State}-uninstall`)
    const oldCmd = `"${d4Old}\\Uninstall DoodleNote.exe" /currentuser`
    const newCmd = `"${real(d4, 'DoodleNote')}\\Uninstall DoodleNote.exe" /currentuser`
    const d4Trusted = (r) => lower(r) === lower(real(d4, 'desktop'))
    const d4Holder = hold(path.join(d4Old, 'locked.dat'))
    started.push(d4Holder)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // Run 1: the old install's command is parked; the held file keeps the folder.
    const run1 = [
      ...d4Setup,
      ['ucmd', oldCmd, '1', 'set'],
      ['park', d4Old, d4New, 'parked'],
      ['linkstate', 'DesktopLink', path.join(sandbox, 'no-such.lnk'), '0'],
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['restore', '', '', 'done'],
      ['ucmd', newCmd, '1', 'set'],
      ['finish', d4Old, d4New, '0', 'kept: a file is still in use'],
      ['jstate', '', '', 'armed']
    ]
    checkCases('d4-run1', run1, phase('d4-run1', run1).results)
    // Run 2: now the new copy's uninstaller runs (and wipes the key); still held.
    const run2 = [
      ...d4Setup,
      ['journal', d4New, '', d4Trusted],
      ['park', d4Old, d4New, 'nothing to park'],
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['jstate', '', '', 'none'],
      ['restore', '', '', 'done'],
      ['jstate', '', '', 'armed'],
      ['jread', 'DesktopLink', '', '0'],
      ['jread', 'LegacyUninstallString', '', oldCmd],
      ['finish', d4Old, d4New, '0', 'kept: a file is still in use'],
      ['jstate', '', '', 'armed'],
      ['record', '', '', 'none']
    ]
    checkCases('d4-run2', run2, phase('d4-run2', run2).results)
    process.kill(d4Holder.pid)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // Run 3: the file is free; the journal is still trusted and the move finishes.
    const d4Record = `${lower(real(d4, 'desktop'))}|${lower(real(d4, 'DoodleNote'))}|`
    const run3 = [
      ...d4Setup,
      ['journal', d4New, '', d4Trusted],
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['restore', '', '', 'done'],
      ['finish', d4Old, d4New, '0', 'removed'],
      ['jstate', '', '', 'none'],
      ['record', '', '', (r) => lower(r).startsWith(d4Record)]
    ]
    const run3Results = phase('d4-run3', run3).results
    checkCases('d4-run3', run3, run3Results)
    assert.ok(!fs.existsSync(d4Old), 'the third run removed the old folder')
    assert.ok(fs.existsSync(path.join(d4New, 'DoodleNote.exe')))
    // Another update before the app consumed the record keeps the record.
    const run4 = [
      ...d4Setup,
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['record', '', '', 'none'],
      ['restore', '', '', 'done'],
      ['record', '', '', run3Results[run3.length - 1]],
      ['jstate', '', '', 'none']
    ]
    checkCases('d4-run4', run4, phase('d4-run4', run4).results)

    // D4: a user uninstall of the new copy while a move is unfinished removes the
    // old folder too; a held file or a running old app keeps it (reported).
    const d4u = path.join(sandbox, 'd4u', 'Local', 'Programs')
    const d4uProfile = path.join(sandbox, 'd4u', 'Roaming', 'desktop')
    const d4uOld = path.join(d4u, 'desktop')
    const d4uNew = path.join(d4u, 'DoodleNote')
    fs.mkdirSync(d4uProfile, { recursive: true })
    write(path.join(d4uOld, 'DoodleNote.exe'), 'old')
    write(path.join(d4uOld, 'resources', 'app.asar'), 'asar')
    write(path.join(d4uOld, 'held.dat'), 'x')
    write(path.join(d4uNew, 'DoodleNote.exe'), 'new')
    const d4uState = `${journalKey}-d4u`
    registryKeys.push(d4uState)
    const d4uHolder = hold(path.join(d4uOld, 'held.dat'))
    started.push(d4uHolder)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const uninstallHeld = [
      ['root', d4u, d4uProfile],
      ['jkey', `${d4uState}\\InstallMigration`, ''],
      ['unlegacy', d4uNew, 'never', 'none'],
      ['arm', d4uOld, d4uNew, '', 'armed'],
      ['unlegacy', path.join(d4u, 'Other'), 'never', 'none'],
      ['unlegacy', d4uNew, 'never', 'kept: a file is still in use'],
      ['jstate', '', '', 'armed']
    ]
    checkCases(
      'd4-uninstall-held',
      uninstallHeld,
      phase('d4-uninstall-held', uninstallHeld).results
    )
    process.kill(d4uHolder.pid)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const d4uApp = runAs(path.join(d4uOld, 'DoodleNote.exe'))
    started.push(d4uApp)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const uninstallRunning = [
      ['root', d4u, d4uProfile],
      ['jkey', `${d4uState}\\InstallMigration`, ''],
      ['unlegacy', d4uNew, 'never', /^kept: .* is running$/],
      ['unlegacy', d4uNew, 'close', 'removed'],
      ['jstate', '', '', 'none']
    ]
    checkCases('d4-uninstall', uninstallRunning, phase('d4-uninstall', uninstallRunning).results)
    assert.ok(!fs.existsSync(d4uOld), 'the uninstall removed the old folder')
    assert.ok(fs.existsSync(path.join(d4uNew, 'DoodleNote.exe')))
    assert.ok(!alive(d4uApp.pid), 'the old app was closed by exact path')

    // D5: a closer that never answers is stopped within its budget: "unknown".
    const d5Dir = path.join(sandbox, 'd5', 'desktop')
    write(path.join(d5Dir, 'DoodleNote.exe'), 'x')
    const stall = [['close', d5Dir, 'close', 'unknown']]
    const stallRun = phase('d5-stall', stall, { exe: stallExe })
    checkCases('d5-stall', stall, stallRun.results)
    assert.ok(stallRun.elapsed < 15000, `the stalled closer took ${stallRun.elapsed} ms`)
    const leftover = powershell(
      "@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $env:DN_DATA.Trim('\"') + '*') -and $_.ProcessId -ne $PID }).Count",
      stallMarker
    ).trim()
    assert.equal(leftover, '0', 'the stalled closer was terminated')

    // D6: silent, no --updated, old app running: quit with exit code 2, nothing changed.
    const d6 = path.join(sandbox, 'd6', 'Local', 'Programs')
    const d6Profile = path.join(sandbox, 'd6', 'Roaming', 'desktop')
    fs.mkdirSync(d6Profile, { recursive: true })
    write(path.join(d6, 'desktop', 'resources', 'app.asar'), 'asar')
    write(path.join(d6, 'DoodleNote', 'DoodleNote.exe'), 'new')
    const d6App = runAs(path.join(d6, 'desktop', 'DoodleNote.exe'))
    started.push(d6App)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const d6State = `${journalKey}-d6`
    registryKeys.push(d6State)
    const silent = [
      ['root', d6, d6Profile],
      ['jkey', `${d6State}\\InstallMigration`, ''],
      ['migclose', path.join(d6, 'desktop'), path.join(d6, 'DoodleNote'), 'never', '(quits)']
    ]
    const silentRun = phase('d6-silent', silent, { status: 2 })
    assert.equal(silentRun.results.length, 2, 'the harness quit at the silent case')
    assert.ok(alive(d6App.pid), 'the running old app was left alone')
    assert.ok(fs.existsSync(path.join(d6, 'desktop', 'resources', 'app.asar')))

    if (keep) write(path.join(keep, 'installer-guards-results.txt'), reports.join('\r\n') + '\r\n')
    console.log(`installer guards: ${total} cases passed`)
  } finally {
    for (const child of started) {
      try {
        if (alive(child.pid)) process.kill(child.pid)
      } catch {
        // already gone
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    for (const key of registryKeys) {
      try {
        execFileSync('reg.exe', ['delete', `HKCU\\${key}`, '/f'], { stdio: 'ignore' })
      } catch {
        // never written
      }
    }
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
