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
    const exe = path.join(sandbox, 'harness.exe')
    execFileSync(
      nsis.path,
      [
        '-V2',
        '-WX',
        '-DAPP_FILENAME=desktop',
        '-DPRODUCT_FILENAME=DoodleNote',
        '-DDN_APP_EXE=DoodleNote.exe',
        `-DDN_MIGRATION_IDENTITY=${IDENTITY}`,
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
    // Not allowed to close (silent, no --updated): keep the old folder, journal armed.
    cases.push(['migclose', l3Source, l3Dest, 'never', '1'])
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
    assert.equal(lower(a.target), lower(pinNew))
    assert.equal(a.args, '--hidden')
    assert.equal(a.description, 'keep me')
    assert.equal(lower(a.icon), lower(`${pinNew},0`))
    assert.equal(lower(a.workdir), lower(path.dirname(pinNew)))
    assert.equal(lower(c.target), lower(pinNew))
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
