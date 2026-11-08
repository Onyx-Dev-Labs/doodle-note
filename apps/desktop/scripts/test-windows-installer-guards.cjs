// Native check of the install folder migration guards (build/windows-install-guards.nsh):
// compiles them into a silent NSIS harness with electron-builder's own makensis and
// runs it against real folders, junctions, a held file and real processes in a
// temporary sandbox. Windows only; nothing outside the sandbox is touched and the
// only processes it stops are the copies of ping.exe it started itself.
//
//   node scripts/test-windows-installer-guards.cjs [--keep <evidence-dir>]
const assert = require('node:assert/strict')
const { execFileSync, spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const desktop = path.resolve(__dirname, '..')
/** MigrationRecord times the installer and the app must agree on (windows-install-record.ts). */
const recordTimes = JSON.parse(
  fs.readFileSync(
    path.join(desktop, 'src', 'main', 'fixtures', 'install-record-times.json'),
    'utf8'
  )
)
/** MigrationRecord 8.3 names the installer and the app must agree on (round 9). */
const recordShortNames = JSON.parse(
  fs.readFileSync(
    path.join(desktop, 'src', 'main', 'fixtures', 'install-record-short-names.json'),
    'utf8'
  )
)
const IDENTITY = 'guards-test|desktop|DoodleNote'
/** The one-value record (dnWriteRecord): DNMR2|<identity>|<old>|<new>|<old 8.3 name>|<UTC>|END. */
const RECORD_FORM =
  /^DNMR2\|guards-test\|desktop\|DoodleNote\|[^|]+\|[^|]+\|[^|]*\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\|END$/
/** A predicate: the record of a move from `from` to `to` (compared case-insensitively). */
const recordOf = (from, to) => (r) =>
  RECORD_FORM.test(r) &&
  r.toLowerCase().startsWith(`DNMR2|${IDENTITY}|${from}|${to}|`.toLowerCase())
const recordValue = (from, to, at = '2026-11-08T01:02:03Z', shortName = '') =>
  `DNMR2|${IDENTITY}|${from}|${to}|${shortName}|${at}|END`

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
    if (expected === undefined || ['root', 'noop', 'jkey', 'skey', 'ukey', 'rkey'].includes(kind))
      return
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
const THREE_FIELDS = new Set(['arm', 'migclose', 'finish', 'pins', 'stwrite'])
let d3ShortTested = false
let d3ShortExeTested = false
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
    // The same guards stopping between dnPinLegacy's checks and the removal until
    // Round 8: a closer that cannot start (DN_POWERSHELL names no file: PowerShell
    // removed or blocked) and one in ConstrainedLanguage mode (as an application-control
    // policy imposes; the real closer script, downgraded first). Test builds only.
    const noStartExe = path.join(sandbox, 'harness-closer-missing.exe')
    compile(noStartExe, [
      `-DDN_POWERSHELL=${path.join(sandbox, 'no-such-folder', 'powershell.exe')}`
    ])
    const clmExe = path.join(sandbox, 'harness-closer-clm.exe')
    compile(clmExe, [
      "-DDN_CLOSE_PS_PRELUDE=$$ExecutionContext.SessionState.LanguageMode='ConstrainedLanguage'; "
    ])
    // <pause>.go exists (test builds only: DN_TEST_PAUSE is never set for an installer).
    const pauseBase = path.join(sandbox, 'pause')
    const pauseExe = path.join(sandbox, 'harness-pause.exe')
    compile(pauseExe, [`-DDN_TEST_PAUSE=${pauseBase}`])
    // The same guards terminating right after the registry write a `stopat` case
    // names (dnTestStep; test builds only: DN_TEST_STEPS is never set for an installer).
    const stepsExe = path.join(sandbox, 'harness-steps.exe')
    compile(stepsExe, ['-DDN_TEST_STEPS=1'])
    // An uninstaller built from the real windows-installer.nsh with electron-builder's
    // hook order (test-windows-uninstaller-hooks.nsi; DN_TEST_ASK_CANCEL is never set for
    // an installer). Its writer writes it into its own install folder.
    const hooksGuid = `dn-hooks-${path.basename(sandbox)}`
    const hooksDir = path.join(sandbox, 'hooks', 'Local', 'Programs', 'DoodleNoteHooks')
    const hooksUninstaller = path.join(hooksDir, 'Uninstall DoodleNoteHooks.exe')
    const hooksWriter = path.join(sandbox, 'hooks-writer.exe')
    execFileSync(
      nsis.path,
      [
        '-V2',
        '-WX',
        `-DAPP_GUID=${hooksGuid}`,
        '-DAPP_ID=com.doodlenote.hooks.test',
        '-DAPP_FILENAME=desktop-hooks',
        '-DPRODUCT_FILENAME=DoodleNoteHooks',
        '-DPRODUCT_NAME=DoodleNoteHooks',
        '-DUNINSTALL_FILENAME=Uninstall DoodleNoteHooks.exe',
        `-DINSTALLER_NSH=${path.join(desktop, 'build', 'windows-installer.nsh')}`,
        `-DOUT_FILE=${hooksWriter}`,
        `-DUNINSTALLER_OUT=${hooksUninstaller}`,
        path.join(__dirname, 'test-windows-uninstaller-hooks.nsi')
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
      ['pin', path.join(profileRoot, 'desktop'), path.join(profileRoot, 'DoodleNote'), /profile/],
      ['root', root, profile],
      ['pin', old, now, 'ok'],
      ['pin', path.join(root, 'desktop-old'), now, /is not .*\\desktop$/],
      ['root', aliasOld, profile],
      [
        'pin',
        path.join(aliasOld, 'desktop'),
        path.join(aliasOld, 'DoodleNote'),
        /junction or link/
      ],
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

    // H2: a real move (old folder removed) writes the record the app requires before
    // it repoints anything (one value, MigrationRecord); then the journal is cleared.
    const migSource = path.join(mig, 'desktop')
    const migDest = path.join(mig, 'DoodleNote')
    cases.push(['root', mig, migProfile])
    cases.push(['arm', migSource, migDest, '', 'armed'])
    cases.push(['finish', migSource, migDest, '0', 'removed'])
    cases.push(['jstate', '', '', 'none'])
    cases.push(['record', '', '', recordOf(real(mig, 'desktop'), real(mig, 'DoodleNote'))])
    // Round 9: a folder's own 8.3 name as Windows reports it (none for a valid 8.3
    // name, or with 8.3 names off), the alias the record carries for the old folder.
    for (const name of ['desktop', 'desktop-qa', 'Long Folder Name.qa']) {
      const dir = path.join(sandbox, 'short-names', name)
      fs.mkdirSync(dir, { recursive: true })
      const short = path.basename(shortPath(dir))
      cases.push(['sname', dir, '', short.toLowerCase() === name.toLowerCase() ? 'none' : short])
    }

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
    // A fully short uninstaller path (UNINST~1.EXE) is the old folder's own while the
    // file exists; a short name that cannot be expanded is refused.
    const oldUninstaller = path.join(old, 'Uninstall DoodleNote.exe')
    write(oldUninstaller, 'old uninstaller')
    const shortExe = shortPath(oldUninstaller)
    d3ShortExeTested = !/Uninstall DoodleNote\.exe$/i.test(shortExe)
    const shortExeCmd = `"${shortExe}" /currentuser`
    cases.push(['jkey', `${journalKey}\\D3c\\InstallMigration`, ''])
    cases.push(['uninstof', shortExeCmd, '', (r) => lower(r) === lower(longOld)])
    cases.push(['uninstof', `"${longOld}\\UNINST~9.EXE" /currentuser`, '', 'none'])
    cases.push(['ucmd', shortExeCmd, '1', 'set'])
    cases.push(['ucmd', '', '2', 'set'])
    cases.push(['ucheck', old, now, 'ok'])
    cases.push(['park', old, now, 'parked'])
    cases.push(['jread', 'LegacyUninstallString', '', shortExeCmd])
    cases.push(['uread', '', '', '|'])
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
    if (!d3ShortExeTested)
      console.log('note: 8.3 file names are off here; the UNINST~1.EXE case ran with the long name')
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

    // Root handoff: the old folder is pinned before it is checked and removed only
    // through that pin. A second process retargets the Programs junction at the
    // pause between the checks and the removal (onto the profile's parent, then onto
    // a decoy that looks like an install): nothing anywhere is deleted, and the
    // journal stays armed. A control run with no retarget removes the folder.
    const rr = path.join(sandbox, 'rr')
    const rrReal = path.join(rr, 'Local', 'RealPrograms')
    const rrPrograms = path.join(rr, 'Local', 'Programs')
    const rrRoaming = path.join(rr, 'Roaming')
    const rrProfile = path.join(rrRoaming, 'desktop')
    const rrDecoy = path.join(rr, 'Decoy')
    const rrFiles = {
      [path.join(rrReal, 'desktop', 'DoodleNote.exe')]: 'old',
      [path.join(rrReal, 'desktop', 'resources', 'app.asar')]: 'asar',
      [path.join(rrReal, 'DoodleNote', 'DoodleNote.exe')]: 'new',
      // The profile looks like an install too, so only identity tells them apart.
      [path.join(rrProfile, 'DoodleNote.exe')]: 'profile exe',
      [path.join(rrProfile, 'settings.json')]: 'profile settings',
      [path.join(rrProfile, 'meetings', 'm1.md')]: 'profile meeting',
      [path.join(rrRoaming, 'DoodleNote', 'DoodleNote.exe')]: 'roaming new',
      [path.join(rrDecoy, 'desktop', 'DoodleNote.exe')]: 'decoy exe',
      [path.join(rrDecoy, 'desktop', 'resources', 'app.asar')]: 'decoy asar',
      [path.join(rrDecoy, 'DoodleNote', 'DoodleNote.exe')]: 'decoy new'
    }
    for (const [file, text] of Object.entries(rrFiles)) write(file, text)
    junction(rrPrograms, rrReal)
    const rrState = `${journalKey}-rr`
    registryKeys.push(rrState)
    const rrOld = path.join(rrPrograms, 'desktop')
    const rrNew = path.join(rrPrograms, 'DoodleNote')
    const rrSetup = [
      ['root', rrPrograms, rrProfile],
      ['jkey', `${rrState}\\InstallMigration`, ''],
      ['skey', rrState, '']
    ]
    /** At the pause: retarget `link` to `target` ('' = leave it), then let the harness go on. */
    const retargetAtPause = (target, log) =>
      spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$p = $env:DN_PAUSE; $end = (Get-Date).AddSeconds(120); while (-not (Test-Path -LiteralPath ($p + '.ready'))) { if ((Get-Date) -gt $end) { 'timeout' | Set-Content -LiteralPath $env:DN_LOG; exit 1 }; Start-Sleep -Milliseconds 20 }; $r = 'unchanged'; if ($env:DN_TARGET) { [IO.Directory]::Delete($env:DN_LINK); New-Item -ItemType Junction -Path $env:DN_LINK -Target $env:DN_TARGET | Out-Null; $r = 'retargeted=' + @((Get-Item -LiteralPath $env:DN_LINK).Target)[0] }; $r | Set-Content -LiteralPath $env:DN_LOG; New-Item -ItemType File -Path ($p + '.go') | Out-Null"
        ],
        {
          stdio: 'ignore',
          windowsHide: true,
          env: {
            ...process.env,
            DN_PAUSE: pauseBase,
            DN_LINK: rrPrograms,
            DN_TARGET: target,
            DN_LOG: log
          }
        }
      )
    const rrRun = async (name, target, runCasesList) => {
      const log = path.join(sandbox, `${name}-retarget.txt`)
      const swapper = retargetAtPause(target, log)
      started.push(swapper)
      const run = phase(name, runCasesList, { exe: pauseExe })
      await new Promise((resolve) => {
        if (swapper.exitCode !== null) resolve()
        else swapper.on('exit', resolve)
      })
      const note = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : 'no log'
      reports.push(`${name}: ${note}`)
      console.log(`${name}: ${note}`)
      checkCases(name, runCasesList, run.results)
      for (const signal of ['.ready', '.go']) fs.rmSync(pauseBase + signal, { force: true })
      // Put the junction back for the next run.
      fs.rmdirSync(rrPrograms)
      junction(rrPrograms, rrReal)
      return note
    }
    const rrUntouched = (except = []) => {
      for (const [file, text] of Object.entries(rrFiles))
        if (!except.includes(file)) assert.equal(fs.readFileSync(file, 'utf8'), text, file)
    }
    const identityKept = /^kept: something in the old folder failed an identity check/
    for (const [name, target] of [
      ['rr-profile', rrRoaming],
      ['rr-decoy', rrDecoy]
    ]) {
      const note = await rrRun(name, target, [
        ...rrSetup,
        ['arm', rrOld, rrNew, '', 'armed'],
        ['finish', rrOld, rrNew, '0', identityKept],
        ['jstate', '', '', 'armed'],
        ['record', '', '', 'none']
      ])
      assert.match(note, /^retargeted=/, `${name}: the junction was retargeted at the pause`)
      rrUntouched()
    }
    // The same race in a user uninstall's clean-up of the old folder.
    const rrUninstall = await rrRun('rr-uninstall', rrRoaming, [
      ...rrSetup,
      ['unlegacy', rrNew, 'never', 'kept: an identity check failed while removing it'],
      ['jstate', '', '', 'armed']
    ])
    assert.match(rrUninstall, /^retargeted=/)
    rrUntouched()
    // Control: nothing retargeted, so the pinned folder (and only it) goes.
    // The record names the old folder as the installer knew it (through the junction).
    const rrRecord = `\\rr\\local\\programs\\desktop|`
    const rrControl = await rrRun('rr-control', '', [
      ...rrSetup,
      ['finish', rrOld, rrNew, '0', 'removed'],
      ['jstate', '', '', 'none'],
      ['record', '', '', (r) => lower(r).includes(rrRecord)]
    ])
    assert.equal(rrControl, 'unchanged')
    assert.ok(
      !fs.existsSync(path.join(rrReal, 'desktop')),
      'the control run removed the old folder'
    )
    rrUntouched([
      path.join(rrReal, 'desktop', 'DoodleNote.exe'),
      path.join(rrReal, 'desktop', 'resources', 'app.asar')
    ])

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
      ['ukey', `${d4State}-uninstall`, ''],
      ['rkey', `${d4State}-recovery`, '']
    ]
    registryKeys.push(`${d4State}-uninstall`, `${d4State}-recovery`)
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
    const run3 = [
      ...d4Setup,
      ['journal', d4New, '', d4Trusted],
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['restore', '', '', 'done'],
      ['finish', d4Old, d4New, '0', 'removed'],
      ['jstate', '', '', 'none'],
      ['record', '', '', recordOf(real(d4, 'desktop'), real(d4, 'DoodleNote'))]
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

    // P2: the journal and record are copied outside Software\{APP_GUID} before
    // "uninstall old version", so an installer killed right after that step loses
    // nothing: the next run's customInit (dnRecoverState) puts both back.
    const p2 = path.join(sandbox, 'p2', 'Local', 'Programs')
    const p2Profile = path.join(sandbox, 'p2', 'Roaming', 'desktop')
    const p2Old = path.join(p2, 'desktop')
    const p2New = path.join(p2, 'DoodleNote')
    fs.mkdirSync(p2Profile, { recursive: true })
    write(path.join(p2Old, 'DoodleNote.exe'), 'old')
    write(path.join(p2Old, 'Uninstall DoodleNote.exe'), 'old uninstaller')
    write(path.join(p2Old, 'resources', 'app.asar'), 'asar')
    const p2State = `${journalKey}-p2`
    const p2Recovery = `${journalKey}-p2-recovery`
    registryKeys.push(p2State, `${p2State}-uninstall`, p2Recovery)
    const p2Setup = [
      ['root', p2, p2Profile],
      ['jkey', `${p2State}\\InstallMigration`, ''],
      ['skey', p2State, ''],
      ['ukey', `${p2State}-uninstall`, ''],
      ['rkey', p2Recovery, '']
    ]
    const p2OldCmd = `"${p2Old}\\Uninstall DoodleNote.exe" /currentuser`
    const p2Trusted = (r) => lower(r) === lower(real(p2, 'desktop'))
    // Run 1 dies right after "uninstall old version" deleted the live keys.
    const p2Run1 = [
      ...p2Setup,
      ['ucmd', p2OldCmd, '1', 'set'],
      ['park', p2Old, p2New, 'parked'],
      ['linkstate', 'DesktopLink', path.join(sandbox, 'no-such.lnk'), '0'],
      ['save', '', '', 'done'],
      ['rstate', '', '', 'present'],
      ['wipe', '', '', 'done'],
      ['jstate', '', '', 'none'],
      ['kill', '', '', '(killed)']
    ]
    const p2Run1Results = phase('p2-run1-killed', p2Run1, { status: 9 }).results
    assert.equal(p2Run1Results.length, p2Run1.length - 1, 'the harness died at the kill')
    checkCases('p2-run1-killed', p2Run1.slice(0, -1), p2Run1Results)
    // Run 2: customInit recovers before anything reads the journal, then finishes.
    write(path.join(p2New, 'DoodleNote.exe'), 'new')
    const p2Run2 = [
      ...p2Setup,
      ['jstate', '', '', 'none'],
      ['recover', '', '', 'done'],
      ['jstate', '', '', 'armed'],
      ['jread', 'LegacyUninstallString', '', p2OldCmd],
      ['jread', 'DesktopLink', '', '0'],
      ['rstate', '', '', 'none'],
      ['journal', p2New, '', p2Trusted],
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['restore', '', '', 'done'],
      ['rstate', '', '', 'none'],
      ['finish', p2Old, p2New, '0', 'removed'],
      ['jstate', '', '', 'none'],
      ['record', '', '', recordOf(real(p2, 'desktop'), real(p2, 'DoodleNote'))]
    ]
    const p2Run2Results = phase('p2-run2-recovers', p2Run2).results
    checkCases('p2-run2-recovers', p2Run2, p2Run2Results)
    const p2Record = p2Run2Results[p2Run2.length - 1]
    assert.ok(!fs.existsSync(p2Old), 'the recovered run removed the old folder')
    // Update before the first launch, killed after "uninstall old version" too.
    const p2Run3 = [
      ...p2Setup,
      ['recover', '', '', 'done'],
      ['save', '', '', 'done'],
      ['rread', 'MigrationRecord', '', p2Record],
      ['wipe', '', '', 'done'],
      ['record', '', '', 'none'],
      ['kill', '', '', '(killed)']
    ]
    const p2Run3Results = phase('p2-run3-killed', p2Run3, { status: 9 }).results
    checkCases('p2-run3-killed', p2Run3.slice(0, -1), p2Run3Results)
    const p2Run4 = [
      ...p2Setup,
      ['recover', '', '', 'done'],
      ['record', '', '', p2Record],
      ['rstate', '', '', 'none'],
      ['jstate', '', '', 'none']
    ]
    checkCases('p2-run4-recovers', p2Run4, phase('p2-run4-recovers', p2Run4).results)
    // The app's own code reads the recovered record, runs, and clears it.
    const consume = execFileSync(
      process.execPath,
      [
        require.resolve('tsx/cli', { paths: [desktop] }),
        path.join(__dirname, 'consume-install-record.ts'),
        `HKEY_CURRENT_USER\\${p2State}`,
        path.join(fs.realpathSync.native(p2New), 'DoodleNote.exe'),
        IDENTITY
      ],
      { encoding: 'utf8', cwd: desktop }
    ).trim()
    const consumed = JSON.parse(consume.split(/\r?\n/).pop())
    reports.push(`p2 app consumed: ${JSON.stringify(consumed)}`)
    console.log(`p2 app consumed: ${JSON.stringify(consumed)}`)
    assert.equal(consumed.result.ran, true)
    assert.equal(consumed.after, null)
    assert.deepEqual(
      // DNMR2|<identity (3 fields)>|<old>|<new>|<old 8.3 name>|<UTC>|END
      [
        consumed.record.from,
        consumed.record.to,
        consumed.record.fromShortName ?? '',
        consumed.record.at
      ],
      p2Record.split('|').slice(4, 8)
    )
    total += 1
    // The recovery copy is checked before anything is restored from it; one that
    // fails the checks is left where it is (a user uninstall deletes it).
    const p2Real = real(p2)
    const p2Foreign = path.join(sandbox, 'elsewhere', 'desktop')
    const p2Tamper = [
      ...p2Setup,
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['rwrite', 'Identity', IDENTITY, 'set'],
      ['rwrite', 'SourceDir', p2Foreign, 'set'],
      ['rwrite', 'DestDir', p2New, 'set'],
      ['rwrite', 'MigrationRecord', recordValue(p2Foreign, path.join(p2Real, 'DoodleNote')), 'set'],
      ['recover', '', '', 'done'],
      ['jstate', '', '', 'none'],
      ['record', '', '', 'none'],
      ['rstate', '', '', 'present'],
      // Another identity's copy is not ours to restore or delete.
      ['rwrite', 'RecoveryFor', 'other-guid|desktop|DoodleNote', 'set'],
      ['rwrite', 'Identity', 'other-guid|desktop|DoodleNote', 'set'],
      ['rwrite', 'SourceDir', p2Old, 'set'],
      ['rwrite', 'DestDir', p2New, 'set'],
      ['rwrite', 'MigrationRecord', '', 'set'],
      ['recover', '', '', 'done'],
      ['jstate', '', '', 'none'],
      ['rstate', '', '', 'present']
    ]
    checkCases('p2-checked', p2Tamper, phase('p2-checked', p2Tamper).results)

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
    // L2: a closer that cannot tell which processes are ours keeps the old folder,
    // recorded as unknown-process.
    const d5State = `${journalKey}-d5`
    registryKeys.push(d5State, `${d5State}-status`)
    const stallKeep = [
      ['root', path.join(sandbox, 'd5'), path.join(sandbox, 'd5-profile')],
      ['jkey', `${d5State}\\InstallMigration`, ''],
      ['stkey', `${d5State}-status`, path.join(sandbox, 'd5-install.log'), 'set'],
      ['migclose', d5Dir, path.join(sandbox, 'd5', 'DoodleNote'), 'close', '1'],
      ['status', '', '', (r) => /^close\|close-keep\|unknown-process\|\d{4}-/.test(r)]
    ]
    checkCases(
      'd5-stall-keep',
      stallKeep,
      phase('d5-stall-keep', stallKeep, { exe: stallExe }).results
    )

    // D5b (round 8): the closer cannot start, or runs in ConstrainedLanguage mode, with
    // the old app really running from the old folder. Both answer "unknown": the old
    // folder (and with it the old exe the login item starts) is kept, the move is
    // recorded as close-keep / unknown-process, and the old app is left running. A
    // full-language closer finds the same process (control).
    const d5bDir = path.join(sandbox, 'd5b', 'desktop')
    const d5bApp = runAs(path.join(d5bDir, 'DoodleNote.exe'))
    started.push(d5bApp)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    checkCases(
      'd5b-control',
      [['close', d5bDir, 'never', 'running']],
      phase('d5b-control', [['close', d5bDir, 'never', 'running']]).results
    )
    for (const [name, exe] of [
      ['d5b-missing', noStartExe],
      ['d5b-clm', clmExe]
    ]) {
      const state = `${journalKey}-${name}`
      registryKeys.push(state, `${state}-status`)
      const keep = [
        ['close', d5bDir, 'close', 'unknown'],
        ['root', path.join(sandbox, 'd5b'), path.join(sandbox, 'd5b-profile')],
        ['jkey', `${state}\\InstallMigration`, ''],
        ['stkey', `${state}-status`, path.join(sandbox, `${name}-install.log`), 'set'],
        ['migclose', d5bDir, path.join(sandbox, 'd5b', 'DoodleNote'), 'close', '1'],
        ['status', '', '', (r) => /^close\|close-keep\|unknown-process\|\d{4}-/.test(r)]
      ]
      checkCases(name, keep, phase(name, keep, { exe }).results)
      assert.ok(fs.existsSync(path.join(d5bDir, 'DoodleNote.exe')), `${name}: the old exe is kept`)
      assert.ok(alive(d5bApp.pid), `${name}: the old app was not closed`)
      assert.match(
        // The install log is UTF-16LE with a BOM (dnStatus).
        fs.readFileSync(path.join(sandbox, `${name}-install.log`), 'utf16le'),
        /close-keep.*unknown-process/,
        `${name}: the install log records it`
      )
    }

    // D6: silent, no --updated, old app running: quit with exit code 2; no folder touched.
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
    const d6Status = `${d6State}-status`
    const d6Log = path.join(sandbox, 'd6-install.log')
    registryKeys.push(d6Status)
    const silent = [
      ['root', d6, d6Profile],
      ['jkey', `${d6State}\\InstallMigration`, ''],
      ['stkey', d6Status, d6Log, 'set'],
      ['migclose', path.join(d6, 'desktop'), path.join(d6, 'DoodleNote'), 'never', '(quits)']
    ]
    const silentRun = phase('d6-silent', silent, { status: 2 })
    assert.equal(silentRun.results.length, 3, 'the harness quit at the silent case')
    // L2: the exit code 2 is recorded before the installer quits.
    const d6Values = JSON.parse(
      powershell(
        "$k = Get-ItemProperty -LiteralPath ('HKCU:\\' + ($env:DN_DATA | ConvertFrom-Json)); ConvertTo-Json -Compress @($k.LastStep, $k.LastResult, $k.LastReason)",
        d6Status
      )
    )
    assert.deepEqual(d6Values, ['close', 'exit-2', 'app-running-silent'])
    const d6Line = fs.readFileSync(d6Log).subarray(2).toString('utf16le').trim()
    assert.match(d6Line, / installer step=close result=exit-2 reason=app-running-silent from=/)
    reports.push(`d6 status: ${d6Values.join('|')}`, `d6 log: ${d6Line}`)
    total += 1
    assert.ok(alive(d6App.pid), 'the running old app was left alone')
    assert.ok(fs.existsSync(path.join(d6, 'desktop', 'resources', 'app.asar')))

    // Round 7 (P3): the uninstaller's earliest exits are recorded too. electron-builder's
    // un.onInit calls un.checkAppRunning (customCheckAppRunning) before customUnInit, so a
    // /S uninstall of the running app (exit code 2) and a cancelled close prompt end
    // there; the status destinations are set in that hook. The real windows-installer.nsh,
    // in that order: the status key and the log name the exit.
    const hooksStatus = `Software\\DoodleNote-InstallStatus\\${hooksGuid}`
    registryKeys.push(hooksStatus)
    fs.mkdirSync(hooksDir, { recursive: true })
    execFileSync(hooksWriter, [], { stdio: 'ignore' })
    assert.ok(fs.existsSync(hooksUninstaller), 'the hooks uninstaller was written')
    const hooksApp = runAs(path.join(hooksDir, 'DoodleNoteHooks.exe'))
    started.push(hooksApp)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const hooksTemp = path.join(sandbox, 'hooks-temp')
    fs.mkdirSync(hooksTemp, { recursive: true })
    const hooksLog = path.join(hooksTemp, 'DoodleNote-install-com.doodlenote.hooks.test.log')
    const uninstall = (args) =>
      spawnSync(hooksUninstaller, [...args, `_?=${hooksDir}`], {
        env: { ...process.env, TEMP: hooksTemp, TMP: hooksTemp },
        stdio: 'ignore',
        timeout: 120_000
      })
    const hooksValues = () =>
      JSON.parse(
        powershell(
          "$k = Get-ItemProperty -LiteralPath ('HKCU:\\' + ($env:DN_DATA | ConvertFrom-Json)); ConvertTo-Json -Compress @($k.LastStep, $k.LastResult, $k.LastReason)",
          hooksStatus
        )
      )
    const hooksLines = () =>
      fs.readFileSync(hooksLog).subarray(2).toString('utf16le').trim().split(/\r?\n/)
    const silentUninstall = uninstall(['/S'])
    assert.equal(silentUninstall.status, 2, 'a /S uninstall of the running app exits with 2')
    assert.deepEqual(hooksValues(), ['close', 'exit-2', 'app-running'])
    assert.match(
      hooksLines().at(-1),
      / uninstaller step=close result=exit-2 reason=app-running in=.*DoodleNoteHooks$/
    )
    assert.ok(alive(hooksApp.pid), 'the running app was left alone')
    const cancelled = uninstall(['/ask'])
    assert.equal(cancelled.error, undefined)
    assert.deepEqual(hooksValues(), ['close', 'cancelled', 'user-cancelled'])
    assert.match(
      hooksLines().at(-1),
      / uninstaller step=close result=cancelled reason=user-cancelled in=.*DoodleNoteHooks$/
    )
    assert.equal(hooksLines().length, 2)
    assert.ok(alive(hooksApp.pid), 'the running app was left alone')
    assert.ok(fs.existsSync(path.join(hooksDir, 'DoodleNoteHooks.exe')))
    reports.push(`uninstaller hooks: ${hooksLines().join(' / ')}`)
    total += 2

    // L2: every decision is recorded where QA can read it after a one-click run:
    // LastStep / LastResult / LastReason / LastRun under the identity's status key,
    // and the same as one line in the log, naming no path but the install folders.
    const l2 = path.join(sandbox, 'l2', 'Local', 'Programs')
    const l2Profile = path.join(sandbox, 'l2', 'Roaming', 'desktop')
    const l2Old = path.join(l2, 'desktop')
    const l2New = path.join(l2, 'DoodleNote')
    fs.mkdirSync(l2Profile, { recursive: true })
    write(path.join(l2Profile, 'settings.json'), 'profile')
    write(path.join(l2Old, 'DoodleNote.exe'), 'old')
    write(path.join(l2Old, 'resources', 'app.asar'), 'asar')
    write(path.join(l2Old, 'held.dat'), 'x')
    write(path.join(l2New, 'DoodleNote.exe'), 'new')
    const l2Alias = path.join(sandbox, 'l2-alias', 'Programs')
    write(path.join(l2Alias, 'DoodleNote', 'DoodleNote.exe'), 'new')
    junction(path.join(l2Alias, 'desktop'), path.join(l2Alias, 'DoodleNote'))
    const l2State = `${journalKey}-l2`
    const l2Status = `${journalKey}-l2-status`
    registryKeys.push(l2State, `${l2State}-uninstall`, `${l2State}-recovery`, l2Status)
    const l2Log = path.join(sandbox, 'l2-logs', 'DoodleNote-install-test.log')
    fs.mkdirSync(path.dirname(l2Log), { recursive: true })
    const status = (step, result, reason) => (r) =>
      new RegExp(
        `^${step}\\|${result}\\|${reason}\\|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$`
      ).test(r)
    const l2Setup = [
      ['root', l2, l2Profile],
      ['jkey', `${l2State}\\InstallMigration`, ''],
      ['skey', l2State, ''],
      ['ukey', `${l2State}-uninstall`, ''],
      ['rkey', `${l2State}-recovery`, ''],
      ['stkey', l2Status, l2Log, 'set']
    ]
    const foreignUninstaller = `"${path.join(sandbox, 'Elsewhere')}\\Uninstall DoodleNote.exe" /currentuser`
    const l2Holder = hold(path.join(l2Old, 'held.dat'))
    started.push(l2Holder)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const l2Plan = [
      ...l2Setup,
      ['plan', l2New, '', (r) => r.endsWith('||')],
      ['status', '', '', status('plan', 'plan-in-place', 'no-legacy')],
      ['root', fresh, path.join(sandbox, 'fresh', 'Roaming', 'desktop')],
      ['plan', path.join(fresh, 'desktop'), '', (r) => r.endsWith('||')],
      ['status', '', '', status('plan', 'plan-in-place', 'fresh-install')],
      ['root', l2Alias, l2Profile],
      ['plan', path.join(l2Alias, 'desktop'), '', /junction or link/],
      ['status', '', '', status('plan', 'plan-in-place', 'legacy-link')],
      ['root', l2, l2Profile],
      ['plan', path.join(otherParent, 'desktop'), '', / is not in /],
      ['status', '', '', status('plan', 'plan-in-place', 'not-default-folder')],
      [
        'plan',
        l2Old,
        '',
        (r) => lower(r) === `${lower(real(l2, 'DoodleNote'))}|${lower(real(l2, 'desktop'))}|`
      ],
      ['status', '', '', status('plan', 'plan-move', 'legacy-found')],
      // The journal's refusals carry codes too.
      ['arm', l2Old, l2New, 'someone-else|desktop|DoodleNote', 'armed'],
      ['journal', l2New, '', /^none: /],
      ['why', '', '', 'journal-foreign'],
      ['arm', l2Old, path.join(l2, 'Elsewhere'), '', 'armed'],
      ['journal', l2New, '', /^none: /],
      ['why', '', '', 'journal-other-dest'],
      // Park: a foreign uninstall command is refused (customInit quits with 2), ours parked.
      ['ucmd', foreignUninstaller, '1', 'set'],
      ['park', l2Old, l2New, /^refused: /],
      ['status', '', '', status('park', 'refused-park', 'uninstall-command')],
      ['ucmd', `"${l2Old}\\Uninstall DoodleNote.exe" /currentuser`, '1', 'set'],
      ['park', l2Old, l2New, 'parked'],
      ['status', '', '', status('park', 'parked', 'parked')],
      // Close: nothing runs from either folder.
      ['migclose', l2Old, l2New, 'close', '0'],
      ['status', '', '', status('close', 'close-ok', 'none')],
      // Remove: kept (app not closed, a held file, a folder that is not the old default).
      ['finish', l2Old, l2New, '1', /^kept: .* still running/],
      ['status', '', '', status('remove', 'kept', 'app-running')],
      ['finish', l2Old, l2New, '0', 'kept: a file is still in use'],
      ['status', '', '', status('remove', 'kept', 'file-in-use')],
      [
        'finish',
        path.join(otherParent, 'desktop'),
        path.join(otherParent, 'DoodleNote'),
        '0',
        /^kept: the old folder is not /
      ],
      ['status', '', '', status('remove', 'kept', 'legacy-not-default')],
      ['jstate', '', '', 'armed'],
      ['record', '', '', 'none']
    ]
    checkCases('l2-decisions', l2Plan, phase('l2-decisions', l2Plan).results)
    process.kill(l2Holder.pid)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const l2Done = [
      ...l2Setup,
      ['finish', l2Old, l2New, '0', 'removed'],
      ['status', '', '', status('record', 'moved', 'record-written')],
      ['record', '', '', recordOf(real(l2, 'desktop'), real(l2, 'DoodleNote'))],
      // Recover: a copy saved before "uninstall old version" is restored next run.
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['recover', '', '', 'done'],
      ['status', '', '', status('recover', 'recovered', 'restored')],
      ['rwrite', 'RecoveryFor', 'other-guid|desktop|DoodleNote', 'set'],
      ['recover', '', '', 'done'],
      ['status', '', '', status('recover', 'recovery-ignored', 'recovery-foreign')],
      // The uninstaller's own result.
      ['unlegacy', l2New, 'never', 'none'],
      ['status', '', '', status('uninstall', 'uninstalled', 'no-pending-move')],
      // A note goes to the log only.
      ['stwrite', 'note', 'journal-ignored', 'journal-foreign', 'done'],
      ['status', '', '', status('uninstall', 'uninstalled', 'no-pending-move')]
    ]
    checkCases('l2-moved', l2Done, phase('l2-moved', l2Done).results)
    assert.ok(!fs.existsSync(l2Old), 'l2: the old folder was removed')
    // The log: one line per decision, in order, in the documented form, naming
    // only the install folders (never the profile or the foreign uninstaller).
    const readLog = (file) => {
      const raw = fs.readFileSync(file)
      assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe], `${file}: UTF-16 with a BOM`)
      return raw.subarray(2).toString('utf16le').split('\r\n').filter(Boolean)
    }
    const l2Lines = readLog(l2Log)
    reports.push('--- l2 log', ...l2Lines)
    const lineForm =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z installer step=[a-z-]+ result=[a-z0-9-]+ reason=[a-z0-9-]*( (from|to|in)=[^=]+)*$/
    for (const line of l2Lines) {
      assert.match(line, lineForm)
      assert.ok(!lower(line).includes(lower(l2Profile)), `l2 log names the profile: ${line}`)
      assert.ok(!line.includes('Elsewhere\\Uninstall'), `l2 log names a command: ${line}`)
    }
    const steps = l2Lines.map((line) =>
      / step=(\S+) result=(\S+) reason=(\S*)/.exec(line).slice(1).join(' ')
    )
    for (const expected of [
      'plan plan-in-place no-legacy',
      'plan plan-move legacy-found',
      'park refused-park uninstall-command',
      'park parked parked',
      'close close-ok none',
      'remove kept app-running',
      'remove kept file-in-use',
      'remove moved removed',
      'record moved record-written',
      'recover recovered restored',
      'recover recovery-ignored recovery-foreign',
      'uninstall uninstalled no-pending-move',
      'note journal-ignored journal-foreign'
    ])
      assert.ok(steps.includes(expected), `l2 log has "${expected}"`)
    assert.ok(
      steps.indexOf('remove moved removed') < steps.indexOf('record moved record-written'),
      'removal is logged before the record'
    )
    // Bounded: past 64 KiB the log becomes <log>.1 (replacing an older one).
    const l2Big = path.join(sandbox, 'l2-logs', 'big.log')
    fs.writeFileSync(l2Big, Buffer.alloc(70000, 0x41))
    fs.writeFileSync(`${l2Big}.1`, 'older')
    const l2Rotate = [
      ['stkey', l2Status, l2Big, 'set'],
      ['stwrite', 'plan', 'plan-move', 'legacy-found', 'done']
    ]
    checkCases('l2-rotate', l2Rotate, phase('l2-rotate', l2Rotate).results)
    assert.equal(fs.statSync(`${l2Big}.1`).size, 70000, 'the full log became <log>.1')
    assert.equal(readLog(l2Big).length, 1)
    checkCases('l2-append', l2Rotate, phase('l2-append', l2Rotate).results)
    assert.equal(readLog(l2Big).length, 2, 'a small log is appended to')
    assert.equal(fs.statSync(`${l2Big}.1`).size, 70000)
    // A log that cannot be written never stops the run.
    const l2NoLog = [
      ['stkey', l2Status, path.join(sandbox, 'no-such-folder', 'x.log'), 'set'],
      ['stwrite', 'park', 'parked', 'parked', 'done'],
      ['status', '', '', status('park', 'parked', 'parked')]
    ]
    checkCases('l2-nolog', l2NoLog, phase('l2-nolog', l2NoLog).results)

    // L4: a user uninstall that has to keep the old folder (its app would not
    // close) drops this identity's login entry when it starts that stale copy or
    // the copy being uninstalled, with its Task Manager state; anything else stays.
    const l4 = path.join(sandbox, 'l4', 'Local', 'Programs')
    const l4Profile = path.join(sandbox, 'l4', 'Roaming', 'desktop')
    const l4Old = path.join(l4, 'desktop')
    const l4New = path.join(l4, 'DoodleNote')
    fs.mkdirSync(l4Profile, { recursive: true })
    write(path.join(l4Old, 'resources', 'app.asar'), 'asar')
    write(path.join(l4New, 'DoodleNote.exe'), 'new')
    const l4App = runAs(path.join(l4Old, 'DoodleNote.exe'))
    started.push(l4App)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const l4State = `${journalKey}-l4`
    registryKeys.push(l4State, `${l4State}-status`, `${l4State}-run`, `${l4State}-approved`)
    const l4Log = path.join(sandbox, 'l4-install.log')
    const oldEntry = `"${l4Old}\\DoodleNote.exe" --process-start-args "--hidden"`
    const shortNew = shortPath(l4New)
    const l4Cases = [
      ['root', l4, l4Profile],
      ['jkey', `${l4State}\\InstallMigration`, ''],
      ['stkey', `${l4State}-status`, l4Log, 'set'],
      ['runkey', `${l4State}-run`, `${l4State}-approved`, 'set'],
      ['arm', l4Old, l4New, '', 'armed'],
      // /S (never close): the old app keeps running, the folder stays, the entry goes.
      ['runwrite', oldEntry, '', 'set'],
      ['runread', '', '', `${oldEntry}|present`],
      ['unlegacy', l4New, 'never', /^kept: .* is running$/],
      ['runread', '', '', 'none|none'],
      ['status', '', '', status('uninstall', 'uninstalled-legacy-kept', 'app-running')],
      ['jstate', '', '', 'armed'],
      // The copy being uninstalled (here through its 8.3 name) is ours too.
      ['runwrite', `"${shortNew}\\DoodleNote.exe"`, '', 'set'],
      ['unlegacy', l4New, 'never', /^kept: /],
      ['runread', '', '', 'none|none'],
      // Not ours: another exe, a longer name, an unquoted path. Never touched.
      ['runwrite', `"${path.join(sandbox, 'Elsewhere', 'DoodleNote.exe')}"`, '', 'set'],
      ['unlegacy', l4New, 'never', /^kept: /],
      ['runread', '', '', `"${path.join(sandbox, 'Elsewhere', 'DoodleNote.exe')}"|present`],
      ['runwrite', `"${l4Old}\\DoodleNote.exe.old" --x`, '', 'set'],
      ['droplogin', l4Old, l4New, 'kept'],
      ['runwrite', `${l4Old}\\DoodleNote.exe`, '', 'set'],
      ['droplogin', l4Old, l4New, 'kept'],
      ['runwrite', `"${l4Old}\\DoodleNote.exe"`, '', 'set'],
      ['droplogin', l4Old, l4New, 'removed'],
      ['droplogin', l4Old, l4New, 'absent'],
      // A removed old folder leaves the entry alone (the app repoints it at next launch).
      ['runwrite', oldEntry, '', 'set'],
      ['unlegacy', l4New, 'close', 'removed'],
      ['runread', '', '', `${oldEntry}|present`],
      ['status', '', '', status('uninstall', 'uninstalled-legacy-removed', 'removed')]
    ]
    checkCases('l4-login-item', l4Cases, phase('l4-login-item', l4Cases).results)
    assert.ok(!fs.existsSync(l4Old), 'l4: the old folder was removed once its app closed')
    assert.ok(!alive(l4App.pid), 'l4: the old app was closed by exact path')
    const l4Steps = readLog(l4Log).map((line) =>
      / step=(\S+) result=(\S+) reason=(\S*)/.exec(line).slice(1).join(' ')
    )
    reports.push('--- l4 log', ...readLog(l4Log))
    assert.deepEqual(
      l4Steps.filter((step) => step.startsWith('login-item')),
      [
        'login-item login-item-removed run-value-deleted',
        'login-item login-item-removed run-value-deleted',
        'login-item login-item-kept not-ours'
      ]
    )

    // P6: every step of the recovery, and the record itself, can be cut short at
    // any registry write and is finished by the next run. The record is one value
    // (all of it or none); a journal is complete only with Identity, SourceDir and
    // DestDir (Identity written last); the recovery copy is deleted only once every
    // value in it reads back from the live keys, then its parent if it is empty.
    // The steps build terminates the harness right after the named write
    // (dnTestStep; never compiled into an installer).
    const p6 = path.join(sandbox, 'p6', 'Local', 'Programs')
    const p6Profile = path.join(sandbox, 'p6', 'Roaming', 'desktop')
    const p6Old = path.join(p6, 'desktop')
    const p6New = path.join(p6, 'DoodleNote')
    fs.mkdirSync(p6Profile, { recursive: true })
    write(path.join(p6New, 'DoodleNote.exe'), 'new')
    const p6Real = real(p6)
    const p6From = path.join(p6Real, 'desktop')
    const p6To = path.join(p6Real, 'DoodleNote')
    const p6Foreign = path.join(sandbox, 'elsewhere', 'desktop')
    const p6State = `${journalKey}-p6`
    const p6Journal = `${p6State}\\InstallMigration`
    const p6Parent = `${journalKey}-p6-recovery`
    const p6Recovery = `${p6Parent}\\guards-test`
    const p6Status = `${journalKey}-p6-status`
    registryKeys.push(p6State, `${p6State}-uninstall`, p6Parent, p6Status)
    const p6Log = path.join(sandbox, 'p6-logs', 'DoodleNote-install-test.log')
    fs.mkdirSync(path.dirname(p6Log), { recursive: true })
    const p6Setup = [
      ['root', p6, p6Profile],
      ['jkey', p6Journal, ''],
      ['skey', p6State, ''],
      ['ukey', `${p6State}-uninstall`, ''],
      ['rkey', p6Recovery, p6Parent],
      ['stkey', p6Status, p6Log, 'set']
    ]
    const p6Rec = recordValue(p6From, p6To)
    const p6Cmd = `"${p6From}\\Uninstall DoodleNote.exe" /currentuser`
    const p6Values = [
      ['Identity', IDENTITY],
      ['SourceDir', p6From],
      ['DestDir', p6To],
      ['LegacyUninstallString', p6Cmd],
      ['DesktopLink', '0'],
      ['StartMenuLink', '1'],
      ['LegacyShortName', 'DESKTO~1']
    ]
    const p6Live = [
      ...p6Values.map(([name, data]) => ['jwrite', name, data, 'set']),
      ['lwrite', 'MigrationRecord', p6Rec, 'set']
    ]
    const p6IsLive = [
      ...p6Values.map(([name, data]) => ['jread', name, '', data]),
      ['record', '', '', p6Rec]
    ]
    const p6Clean = [
      ['wipe', '', '', 'done'],
      ['rwipe', '', '', 'done'],
      ['recover', '', '', 'done'],
      ['keyexists', p6Parent, '', 'none']
    ]

    // The checks: a record is complete for this identity and its two folders, or
    // not a record; a journal is complete for them, or not trusted.
    const p6Whole = ['DNMR2', IDENTITY, p6From, p6To, '', '2026-11-08T01:02:03Z', 'END']
    const cut = p6Whole.join('|')
    const p6Checks = [
      ...p6Setup,
      ['rcheck', '', p6Rec, 'ok'],
      ['rcheck', '', recordValue(p6From.toUpperCase(), p6To.toLowerCase()), 'ok'],
      ['rcheck', '', recordValue(`${p6From}\\`, `${p6To}\\.`), 'ok'],
      ['rcheck', '', '', 'none'],
      // Cut short anywhere: before each "|", and inside END.
      ...[...cut]
        .map((ch, i) => (ch === '|' ? i : -1))
        .filter((i) => i > 0)
        .map((i) => ['rcheck', '', cut.slice(0, i), /^(format|identity)$/]),
      ['rcheck', '', cut.slice(0, -1), 'format'],
      ['rcheck', '', `${cut}|`, 'format'],
      ['rcheck', '', `${cut}|END`, 'format'],
      ['rcheck', '', recordValue(p6From, p6To, ''), 'format'],
      ['rcheck', '', recordValue('', p6To), 'format'],
      ['rcheck', '', `DNMR3|${p6Whole.slice(1).join('|')}`, 'format'],
      ['rcheck', '', `dnmr2|${p6Whole.slice(1).join('|')}`, 'format'],
      // DNMR1 (no 8.3 name; this change's builds before round 9).
      ['rcheck', '', `DNMR1|${IDENTITY}|${p6From}|${p6To}|2026-11-08T01:02:03Z|END`, 'format'],
      ['rcheck', '', `${p6From}|${p6To}|2026-11-08T01:02:03Z`, 'format'],
      ['rcheck', '', cut.replace('guards-test|', 'other-guid|'), 'identity'],
      ['rcheck', '', cut.replace('|DoodleNote|', '|DoodleNote QA|'), 'identity'],
      ['rcheck', '', recordValue(p6Foreign, p6To), 'folders'],
      ['rcheck', '', recordValue(p6To, p6From), 'folders'],
      ['rcheck', '', recordValue(p6From, path.join(p6Real, 'DoodleNote QA')), 'folders'],
      // Round 7: the time has exactly the shape the app requires (one fixture for both).
      ...recordTimes.valid.map((time) => ['rcheck', '', recordValue(p6From, p6To, time), 'ok']),
      ...recordTimes.invalid
        .filter((time) => time !== '')
        .map((time) => ['rcheck', '', recordValue(p6From, p6To, time), 'time']),
      // Round 9: the old folder's 8.3 name has exactly the shape the app requires.
      ...recordShortNames.valid.map((name) => [
        'rcheck',
        '',
        recordValue(p6From, p6To, undefined, name),
        'ok'
      ]),
      ...recordShortNames.invalid.map((name) => [
        'rcheck',
        '',
        recordValue(p6From, p6To, undefined, name),
        'format'
      ]),
      ['wipe', '', '', 'done'],
      ['jcheck', p6Journal, '', 'none'],
      ['jwrite', 'Identity', IDENTITY, 'set'],
      ['jcheck', p6Journal, '', 'incomplete'],
      ['journal', p6New, '', 'none: the migration journal is incomplete'],
      ['jwrite', 'SourceDir', p6From, 'set'],
      ['jcheck', p6Journal, '', 'incomplete'],
      ['journal', p6New, '', 'none: the migration journal is incomplete'],
      ['why', '', '', 'journal-incomplete'],
      ['jwrite', 'DestDir', p6To, 'set'],
      ['jcheck', p6Journal, '', 'ok'],
      ['jwrite', 'Identity', '', 'set'],
      ['jcheck', p6Journal, '', 'incomplete'],
      ['journal', p6New, '', 'none: '],
      ['jwrite', 'Identity', 'other-guid|desktop|DoodleNote', 'set'],
      ['jcheck', p6Journal, '', 'identity'],
      ['jwrite', 'Identity', IDENTITY, 'set'],
      ['jwrite', 'SourceDir', p6Foreign, 'set'],
      ['jcheck', p6Journal, '', 'folders'],
      ['jwrite', 'SourceDir', p6From, 'set'],
      ['jwrite', 'DestDir', path.join(p6Real, 'DoodleNote QA'), 'set'],
      ['jcheck', p6Journal, '', 'folders'],
      ...p6Clean
    ]
    checkCases('p6-checks', p6Checks, phase('p6-checks', p6Checks).results)

    // Restoration killed right after each of its writes: the next run finishes it,
    // every value comes back exactly, and only then do the copy and its parent go.
    const restoreSteps = [
      'recover-LegacyUninstallString',
      'recover-DesktopLink',
      'recover-StartMenuLink',
      'recover-LegacyShortName',
      'recover-SourceDir',
      'recover-DestDir',
      'recover-Identity',
      'recover-MigrationRecord',
      'recover-deleted'
    ]
    const at = (name) => restoreSteps.indexOf(`recover-${name}`)
    for (const [n, step] of restoreSteps.entries()) {
      const killed = [
        ...p6Setup,
        ...p6Live,
        ['save', '', '', 'done'],
        ['rstate', '', '', 'present'],
        ['wipe', '', '', 'done'],
        ['stopat', step, '', 'set'],
        ['recover', '', '', '(killed)']
      ]
      const run1 = phase(`p6-${step}-killed`, killed, { exe: stepsExe, status: 9 }).results
      assert.equal(run1.length, killed.length - 1, `${step}: the harness died at the step`)
      checkCases(`p6-${step}-killed`, killed.slice(0, -1), run1)
      const run2 = [
        ...p6Setup,
        // What the killed run left: the journal is not complete before Identity,
        // and the record is all there or not at all.
        [
          'jcheck',
          p6Journal,
          '',
          n < at('SourceDir') ? 'none' : n < at('Identity') ? 'incomplete' : 'ok'
        ],
        ['record', '', '', n < at('MigrationRecord') ? 'none' : p6Rec],
        ['keyexists', p6Recovery, '', n < at('deleted') ? 'present' : 'none'],
        ['keyexists', p6Parent, '', 'present'],
        ['recover', '', '', 'done'],
        ...p6IsLive,
        ['jcheck', p6Journal, '', 'ok'],
        ['rstate', '', '', 'none'],
        ['keyexists', p6Recovery, '', 'none'],
        ['keyexists', p6Parent, '', 'none'],
        [
          'status',
          '',
          '',
          n < at('deleted') ? status('recover', 'recovered', 'restored') : undefined
        ]
      ]
      checkCases(`p6-${step}-next`, run2, phase(`p6-${step}-next`, run2).results)
    }

    // A move killed after its old folder was removed but before the record (the
    // record is written first, then the journal cleared): the next run sees the
    // complete journal with its old folder gone and writes the record; one killed
    // after the record keeps that record and only clears the journal.
    for (const step of ['finish-removed', 'finish-record']) {
      write(path.join(p6Old, 'DoodleNote.exe'), 'old')
      write(path.join(p6Old, 'resources', 'app.asar'), 'asar')
      const killed = [
        ...p6Setup,
        ['wipe', '', '', 'done'],
        ['arm', p6Old, p6New, '', 'armed'],
        ['jdone', p6New, '', 'none'],
        ['stopat', step, '', 'set'],
        ['finish', p6Old, p6New, '0', '(killed)']
      ]
      const run1 = phase(`p6-${step}-killed`, killed, { exe: stepsExe, status: 9 }).results
      assert.equal(run1.length, killed.length - 1, `${step}: the harness died at the step`)
      checkCases(`p6-${step}-killed`, killed.slice(0, -1), run1)
      assert.ok(!fs.existsSync(p6Old), `${step}: the killed run removed the old folder`)
      const kept = step === 'finish-record' ? recordOf(p6From, p6To) : 'none'
      const run2 = [
        ...p6Setup,
        ['jstate', '', '', 'armed'],
        ['record', '', '', kept],
        // Not the old folder for a move any more: dnTrustedJournal refuses it.
        ['journal', p6New, '', /^none: /],
        ['jdone', p6New, '', (r) => lower(r) === lower(p6From)],
        // Only for its own destination.
        ['jdone', path.join(p6Real, 'Other'), '', 'none'],
        ['complete', p6Old, p6New, 'done'],
        ['jstate', '', '', 'none'],
        ['record', '', '', recordOf(p6From, p6To)],
        ['status', '', '', status('install', 'moved', 'journal-completed')],
        ['jdone', p6New, '', 'none']
      ]
      const next = phase(`p6-${step}-next`, run2).results
      checkCases(`p6-${step}-next`, run2, next)
      if (step === 'finish-record')
        assert.equal(
          next[p6Setup.length + 1],
          next[p6Setup.length + 7],
          'the record is kept as it was'
        )
      // The app reads that record, repoints, and clears it.
      const consumedP6 = JSON.parse(
        execFileSync(
          process.execPath,
          [
            require.resolve('tsx/cli', { paths: [desktop] }),
            path.join(__dirname, 'consume-install-record.ts'),
            `HKEY_CURRENT_USER\\${p6State}`,
            path.join(p6To, 'DoodleNote.exe'),
            IDENTITY
          ],
          { encoding: 'utf8', cwd: desktop }
        )
          .trim()
          .split(/\r?\n/)
          .pop()
      )
      reports.push(`p6 ${step} app consumed: ${JSON.stringify(consumedP6)}`)
      assert.equal(consumedP6.result.ran, true, step)
      assert.equal(consumedP6.after, null, step)
      total += 1
    }
    // jdone is only for a folder that is really gone: not one still there, and
    // not a link left in its place (even a dangling one).
    write(path.join(p6Old, 'DoodleNote.exe'), 'old')
    const p6Gone = [...p6Setup, ['arm', p6Old, p6New, '', 'armed'], ['jdone', p6New, '', 'none']]
    checkCases('p6-jdone-present', p6Gone, phase('p6-jdone-present', p6Gone).results)
    fs.rmSync(p6Old, { recursive: true, force: true })
    fs.mkdirSync(path.join(sandbox, 'p6-target'))
    junction(p6Old, path.join(sandbox, 'p6-target'))
    fs.rmSync(path.join(sandbox, 'p6-target'), { recursive: true, force: true })
    const p6Dangling = [
      ...p6Setup,
      ['jdone', p6New, '', 'none'],
      ['jwrite', 'Identity', '', 'set'],
      ['jdone', p6New, '', 'none'],
      ['wipe', '', '', 'done']
    ]
    checkCases('p6-jdone-link', p6Dangling, phase('p6-jdone-link', p6Dangling).results)
    fs.rmSync(p6Old, { recursive: true, force: true })

    // The first journal write and the copy's writes, killed after each.
    for (const step of ['park-SourceDir', 'park-DestDir']) {
      write(path.join(p6Old, 'DoodleNote.exe'), 'old')
      write(path.join(p6Old, 'Uninstall DoodleNote.exe'), 'old uninstaller')
      const parkCmd = `"${p6Old}\\Uninstall DoodleNote.exe" /currentuser`
      const killed = [
        ...p6Setup,
        ['wipe', '', '', 'done'],
        ['ucmd', parkCmd, '1', 'set'],
        ['stopat', step, '', 'set'],
        ['park', p6Old, p6New, '(killed)']
      ]
      const run1 = phase(`p6-${step}-killed`, killed, { exe: stepsExe, status: 9 }).results
      checkCases(`p6-${step}-killed`, killed.slice(0, -1), run1)
      const run2 = [
        ...p6Setup,
        // No Identity yet: not a journal anyone trusts, and nothing was parked.
        ['jcheck', p6Journal, '', 'incomplete'],
        ['journal', p6New, '', 'none: '],
        ['jdone', p6New, '', 'none'],
        ['uread', '', '', `${parkCmd}|`],
        ['park', p6Old, p6New, 'parked'],
        ['jcheck', p6Journal, '', 'ok'],
        ['uread', '', '', '|'],
        ['ucmd', '', '1', 'set'],
        ['wipe', '', '', 'done']
      ]
      checkCases(`p6-${step}-next`, run2, phase(`p6-${step}-next`, run2).results)
      fs.rmSync(p6Old, { recursive: true, force: true })
    }
    for (const step of ['save-journal', 'save-record']) {
      // A new copy cut short has no RecoveryFor and is ignored; the live keys were
      // not touched yet ("uninstall old version" runs after dnSaveState), and the
      // next save starts the copy again.
      const killed = [
        ...p6Setup,
        ...p6Live,
        ['stopat', step, '', 'set'],
        ['save', '', '', '(killed)']
      ]
      const run1 = phase(`p6-${step}-killed`, killed, { exe: stepsExe, status: 9 }).results
      checkCases(`p6-${step}-killed`, killed.slice(0, -1), run1)
      const run2 = [
        ...p6Setup,
        ['rstate', '', '', 'none'],
        ['keyexists', p6Recovery, '', 'present'],
        ['recover', '', '', 'done'],
        ...p6IsLive,
        ['save', '', '', 'done'],
        ['rstate', '', '', 'present'],
        ['rread', 'MigrationRecord', '', p6Rec],
        ['wipe', '', '', 'done'],
        ['recover', '', '', 'done'],
        ...p6IsLive,
        ['keyexists', p6Parent, '', 'none']
      ]
      checkCases(`p6-${step}-next`, run2, phase(`p6-${step}-next`, run2).results)
    }

    // Copies that fail their checks are ignored and left for a user uninstall;
    // a copy is deleted only on a full match, and a kept one is updated in place.
    const p6Tamper = [
      ...p6Setup,
      ['wipe', '', '', 'done'],
      // Wrong identity in the journal part, another folder in the record.
      ['rwrite', 'Identity', 'other-guid|desktop|DoodleNote', 'set'],
      ['rwrite', 'SourceDir', p6From, 'set'],
      ['rwrite', 'DestDir', p6To, 'set'],
      ['rwrite', 'MigrationRecord', recordValue(p6Foreign, p6To), 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['recover', '', '', 'done'],
      ['jcheck', p6Journal, '', 'none'],
      ['record', '', '', 'none'],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recovery-ignored', 'journal-identity')],
      // Foreign folders in the journal part.
      ['rwrite', 'Identity', IDENTITY, 'set'],
      ['rwrite', 'SourceDir', p6Foreign, 'set'],
      ['rwrite', 'MigrationRecord', '', 'set'],
      ['recover', '', '', 'done'],
      ['jcheck', p6Journal, '', 'none'],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recovery-ignored', 'journal-folders')],
      // A good journal part with a bad record: the journal is restored, the copy kept.
      ['rwrite', 'SourceDir', p6From, 'set'],
      ['rwrite', 'MigrationRecord', recordValue(p6From, p6To).replace('|END', ''), 'set'],
      ['recover', '', '', 'done'],
      ['jcheck', p6Journal, '', 'ok'],
      ['record', '', '', 'none'],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recover-incomplete', 'record-format')],
      ['wipe', '', '', 'done'],
      // A live record cut short or for another identity is replaced by the copy's.
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['lwrite', 'MigrationRecord', p6Rec.slice(0, -4), 'set'],
      ['recover', '', '', 'done'],
      ['record', '', '', p6Rec],
      ['rstate', '', '', 'none'],
      ['keyexists', p6Parent, '', 'none'],
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['lwrite', 'MigrationRecord', p6Rec.replace('guards-test|', 'other-guid|'), 'set'],
      ['recover', '', '', 'done'],
      ['record', '', '', p6Rec],
      ['rstate', '', '', 'none'],
      // Round 7: so is a live record whose time is malformed (the app would leave it
      // pending forever): the copy's valid record replaces it, and the copy goes.
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['lwrite', 'MigrationRecord', recordValue(p6From, p6To, '2026-11-08 01:02:03'), 'set'],
      ['recover', '', '', 'done'],
      ['record', '', '', p6Rec],
      ['rstate', '', '', 'none'],
      // A complete live record that differs is not overwritten, and the copy stays.
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['lwrite', 'MigrationRecord', recordValue(p6From, p6To, '2026-11-09T00:00:00Z'), 'set'],
      ['recover', '', '', 'done'],
      ['record', '', '', recordValue(p6From, p6To, '2026-11-09T00:00:00Z')],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recover-incomplete', 'record-mismatch')],
      // So does a journal value that differs; the next save updates the kept copy
      // from the (complete) live keys, one value at a time, and then it matches.
      ['wipe', '', '', 'done'],
      ...p6Values.map(([name, data]) => ['rwrite', name, data, 'set']),
      ['rwrite', 'MigrationRecord', '', 'set'],
      ...p6Values.map(([name, data]) => ['jwrite', name, data, 'set']),
      ['jwrite', 'DesktopLink', '1', 'set'],
      ['recover', '', '', 'done'],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recover-incomplete', 'journal-mismatch')],
      ['jwrite', 'StartMenuLink', '', 'set'],
      ['save', '', '', 'done'],
      ['rread', 'DesktopLink', '', '1'],
      ['rread', 'StartMenuLink', '', 'none'],
      ['wipe', '', '', 'done'],
      ['recover', '', '', 'done'],
      ['jread', 'DesktopLink', '', '1'],
      ['jread', 'StartMenuLink', '', 'none'],
      ['rstate', '', '', 'none'],
      ['status', '', '', status('recover', 'recovered', 'restored')],
      ['keyexists', p6Parent, '', 'none'],
      // A kept copy is not replaced by a save whose live state is incomplete.
      ['wipe', '', '', 'done'],
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ['lwrite', 'MigrationRecord', recordValue(p6From, p6To, '2026-11-09T00:00:00Z'), 'set'],
      ['recover', '', '', 'done'],
      ['lwrite', 'MigrationRecord', '', 'set'],
      ['jwrite', 'Identity', IDENTITY, 'set'],
      ['save', '', '', 'done'],
      ['rread', 'MigrationRecord', '', p6Rec],
      ['rstate', '', '', 'present'],
      ...p6Clean
    ]
    checkCases('p6-tamper', p6Tamper, phase('p6-tamper', p6Tamper).results)

    // The parent key goes only when no other identity's copy is in it.
    const p6Sibling = `${p6Parent}\\other-guid`
    const p6Parents = [
      ...p6Setup,
      ['rkey', p6Sibling, p6Parent],
      ['rwrite', 'RecoveryFor', 'other-guid|desktop|DoodleNote', 'set'],
      ['rkey', p6Recovery, p6Parent],
      ...p6Live,
      ['save', '', '', 'done'],
      ['wipe', '', '', 'done'],
      ['recover', '', '', 'done'],
      ...p6IsLive,
      ['keyexists', p6Recovery, '', 'none'],
      ['keyexists', p6Sibling, '', 'present'],
      ['keyexists', p6Parent, '', 'present'],
      ['rkey', p6Sibling, p6Parent],
      ['recover', '', '', 'done'],
      ['rstate', '', '', 'present'],
      ['status', '', '', status('recover', 'recovery-ignored', 'recovery-foreign')],
      ['rwipe', '', '', 'done'],
      ['rkey', p6Recovery, p6Parent],
      ...p6Clean
    ]
    checkCases('p6-parent', p6Parents, phase('p6-parent', p6Parents).results)

    // Round 7: a save never copies a malformed live record over a valid copy: the kept
    // copy keeps its record, the uninstaller's wipe follows, and the restore brings back
    // the valid one.
    const p7Malformed = recordValue(p6From, p6To, '2026-11-08T1:02:03Z')
    const p7Save = [
      ...p6Setup,
      ['wipe', '', '', 'done'],
      ['rwipe', '', '', 'done'],
      ...p6Values.map(([name, data]) => ['rwrite', name, data, 'set']),
      ['rwrite', 'MigrationRecord', p6Rec, 'set'],
      ['rwrite', 'RecoveryFor', IDENTITY, 'set'],
      ...p6Values.map(([name, data]) => ['jwrite', name, data, 'set']),
      ['lwrite', 'MigrationRecord', p7Malformed, 'set'],
      ['rcheck', '', p7Malformed, 'time'],
      ['save', '', '', 'done'],
      ['rread', 'MigrationRecord', '', p6Rec],
      ['wipe', '', '', 'done'],
      ['restore', '', '', 'done'],
      ['record', '', '', p6Rec],
      ...p6Clean
    ]
    checkCases('p7-save-malformed', p7Save, phase('p7-save-malformed', p7Save).results)

    // The app leaves a record that is not complete for its identity where it is,
    // for a later installer run to repair, and acts on nothing.
    for (const [label, value] of [
      ['cut-short', p6Rec.slice(0, p6Rec.lastIndexOf('|'))],
      ['other-identity', p6Rec.replace('guards-test|', 'other-guid|')],
      ['earlier-format', `${p6From}|${p6To}|2026-11-08T01:02:03Z`]
    ]) {
      const setRecord = [...p6Setup, ['lwrite', 'MigrationRecord', value, 'set']]
      checkCases(`p6-app-${label}`, setRecord, phase(`p6-app-${label}`, setRecord).results)
      const output = (() => {
        try {
          return execFileSync(
            process.execPath,
            [
              require.resolve('tsx/cli', { paths: [desktop] }),
              path.join(__dirname, 'consume-install-record.ts'),
              `HKEY_CURRENT_USER\\${p6State}`,
              path.join(p6To, 'DoodleNote.exe'),
              IDENTITY
            ],
            { encoding: 'utf8', cwd: desktop, stdio: ['ignore', 'pipe', 'ignore'] }
          )
        } catch (error) {
          assert.equal(error.status, 1, `${label}: consume exit code`)
          return String(error.stdout)
        }
      })()
      const consumedPending = JSON.parse(output.trim().split(/\r?\n/).pop())
      reports.push(`p6 app, ${label}: ${JSON.stringify(consumedPending)}`)
      assert.equal(consumedPending.result.ran, false, label)
      assert.ok(consumedPending.record && consumedPending.record.pending, label)
      assert.deepEqual(consumedPending.after, consumedPending.record, label)
      assert.match(consumedPending.log.join('\n'), /left for the installer/, label)
      const still = [
        ...p6Setup,
        ['record', '', '', value],
        ['lwrite', 'MigrationRecord', '', 'set']
      ]
      checkCases(`p6-app-${label}-kept`, still, phase(`p6-app-${label}-kept`, still).results)
      total += 1
    }

    // Round 7 (P2): a launch that cannot read the record at all (the reader, the speech
    // worker in the app, is unavailable) repoints nothing, leaves the record exactly as it
    // is, and records AppMigration = read-failed in the identity's status key; the next
    // launch with a working reader consumes it and records complete.
    const p7Status = `${p6State}-appstatus`
    registryKeys.push(p7Status)
    const p7Set = [...p6Setup, ['lwrite', 'MigrationRecord', p6Rec, 'set']]
    checkCases('p7-reader-setup', p7Set, phase('p7-reader-setup', p7Set).results)
    const consumeWith = (extra) => {
      try {
        const out = execFileSync(
          process.execPath,
          [
            require.resolve('tsx/cli', { paths: [desktop] }),
            path.join(__dirname, 'consume-install-record.ts'),
            `HKEY_CURRENT_USER\\${p6State}`,
            path.join(p6To, 'DoodleNote.exe'),
            IDENTITY,
            ...extra
          ],
          { encoding: 'utf8', cwd: desktop, stdio: ['ignore', 'pipe', 'ignore'] }
        )
        return { status: 0, json: JSON.parse(out.trim().split(/\r?\n/).pop()) }
      } catch (error) {
        return {
          status: error.status,
          json: JSON.parse(String(error.stdout).trim().split(/\r?\n/).pop())
        }
      }
    }
    const appStatus = () =>
      JSON.parse(
        powershell(
          "$k = Get-ItemProperty -LiteralPath ('HKCU:\\' + ($env:DN_DATA | ConvertFrom-Json)); ConvertTo-Json -Compress @($k.AppMigration, $k.AppMigrationReason, $k.AppMigrationLastAttempt)",
          p7Status
        )
      )
    const failedRead = consumeWith([p7Status, '--reader-fails'])
    reports.push(`p7 reader unavailable: ${JSON.stringify(failedRead.json)}`)
    assert.equal(failedRead.status, 1)
    assert.equal(failedRead.json.result.ran, false)
    assert.deepEqual(failedRead.json.result.status.state, 'read-failed')
    assert.deepEqual(failedRead.json.after, failedRead.json.record, 'the record is untouched')
    const [failedState, failedReason, failedAt] = appStatus()
    assert.deepEqual([failedState, failedReason], ['read-failed', 'reader-unavailable'])
    assert.match(failedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    checkCases(
      'p7-reader-kept',
      [...p6Setup, ['record', '', '', p6Rec]],
      phase('p7-reader-kept', [...p6Setup, ['record', '', '', p6Rec]]).results
    )
    const retried = consumeWith([p7Status])
    reports.push(`p7 reader back: ${JSON.stringify(retried.json)}`)
    assert.equal(retried.status, 0)
    assert.equal(retried.json.result.ran, true)
    assert.equal(retried.json.after, null)
    assert.deepEqual(appStatus().slice(0, 2), ['complete', 'repointed'])
    total += 1

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
