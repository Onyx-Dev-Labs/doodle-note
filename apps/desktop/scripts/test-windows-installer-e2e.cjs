#!/usr/bin/env node
// End-to-end installer lifecycle of the QA identity, on a throwaway Windows machine
// only (CI job "windows-installer-e2e"; never on a desktop someone uses, and never
// with the production identity). It installs real installers silently and checks
// the registry, folders, Run value, shortcuts, the MCP client configs and the app's
// own consumption of the installer's record:
//
//   A  basic: legacy QA /S, then the current QA /S --updated, then the app's first
//      launch consumes the record, then uninstall /S (the legacy command is
//      parked, so nothing has to be restored: the log says wrote=none);
//   B  interrupted: the kill-step build (windows-installer-test-steps.nsh)
//      terminates itself right after electron-builder's "uninstall old version"
//      (which, the command parked, ran no uninstaller); the next run's stock step
//      runs the new copy's uninstaller, which deletes the journal, and its
//      customInstall writes it back (wrote=...) and finishes the move;
//   C  consent and held files: /S without --updated while the legacy app runs
//      exits 2 and changes nothing; a held file in the old folder keeps the
//      journal armed across two runs and the third finishes;
//   D  killed right after the stock uninstaller (round 9): an update of the NEW
//      layout, so "uninstall old version" really runs the new copy's uninstaller,
//      which deletes Software\{GUID}; the kill-step build terminates itself the
//      moment uninstallOldVersion returns, first with a move's journal live, then
//      with an unconsumed record live; each next run's first decision must be
//      writing exactly those values back from the recovery copy, before it plans.
// Recovery is identified by the log's wrote= list, and every order is checked as
// a subsequence (assertOrder), never by mere presence.
//
// The installers are the current QA app's bytes (one win-unpacked): "legacy" is
// the legacy installer *layout* (Programs\desktop-qa, no migration include), not
// an older app version; the legacy and kill-step installers use stored (not
// compressed) payloads to save time.
//
//   node scripts/test-windows-installer-e2e.cjs --legacy <setup.exe> --current <setup.exe>
//     --steps <setup.exe> [--evidence <dir>] [--only A,B,C,D]
//
// It refuses to run unless CI is set or DOODLENOTE_E2E_THROWAWAY_MACHINE=1, and
// only ever stops processes it started itself.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync, spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : null
}
const installers = {
  legacy: option('--legacy'),
  current: option('--current'),
  steps: option('--steps')
}
const evidence = option('--evidence')
const SCENARIOS = ['A', 'B', 'C', 'D']
const only = new Set((option('--only') ?? SCENARIOS.join(',')).split(','))
// Never "passed" without running: an unknown or empty selection is an error.
const unknown = [...only].filter((name) => !SCENARIOS.includes(name))
if (unknown.length || only.size === 0)
  throw new Error(`--only: unknown scenario(s) ${JSON.stringify(unknown)}; known: ${SCENARIOS}`)

if (process.platform !== 'win32') throw new Error('Windows only')
if (!process.env.CI && process.env.DOODLENOTE_E2E_THROWAWAY_MACHINE !== '1')
  throw new Error(
    'This installs and uninstalls the QA identity for real: CI (a throwaway runner) only, or DOODLENOTE_E2E_THROWAWAY_MACHINE=1'
  )
for (const [name, file] of Object.entries(installers))
  if (!file || !fs.existsSync(file)) throw new Error(`--${name} <setup.exe> is required (${file})`)

const qa = require(path.join(__dirname, '..', 'src', 'shared', 'app-identities.json')).qa

/** electron-builder's APP_GUID for an appId (UUID v5 in its namespace; windows-install-record.ts). */
function electronBuilderGuid(appId) {
  const ns = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex')
  const hash = createHash('sha1').update(ns).update(appId).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const GUID = electronBuilderGuid(qa.appId)
const programs = path.join(process.env.LOCALAPPDATA, 'Programs')
const OLD = path.join(programs, qa.packageName)
const NEW = path.join(programs, qa.productName)
const EXE = `${qa.productName}.exe`
const UNINSTALLER = `Uninstall ${qa.productName}.exe`
const KEYS = {
  uninstall: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}`,
  state: `Software\\${GUID}`,
  journal: `Software\\${GUID}\\InstallMigration`,
  recovery: `Software\\DoodleNote-InstallRecovery\\${GUID}`,
  recoveryParent: 'Software\\DoodleNote-InstallRecovery',
  status: `Software\\DoodleNote-InstallStatus\\${GUID}`,
  run: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
}
const PROFILE = path.join(process.env.APPDATA, qa.packageName)
const SANDBOX = path.join(PROFILE, 'agent-access-home')
const INSTALL_LOG = path.join(process.env.TEMP, `DoodleNote-install-${qa.appId}.log`)
const START_MENU_LINK = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  `${qa.productName}.lnk`
)

/** Runs Windows PowerShell with `data` as JSON in $env:DN_DATA; returns its trimmed output. */
function powershell(script, data = null) {
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$d = $env:DN_DATA | ConvertFrom-Json; ${script}`
    ],
    { encoding: 'utf8', env: { ...process.env, DN_DATA: JSON.stringify(data) } }
  ).trim()
}

/** HKCU key's values as an object, or null when the key does not exist. */
function reg(key) {
  const out = powershell(
    "$k = 'HKCU:\\' + $d.key; if (Test-Path -LiteralPath $k) { $p = Get-Item -LiteralPath $k; $o = [ordered]@{}; foreach ($n in $p.GetValueNames()) { $o[$n] = [string]$p.GetValue($n) }; ConvertTo-Json -Compress -InputObject $o } else { 'null' }",
    { key }
  )
  return JSON.parse(out || 'null')
}

function setRunValue(value) {
  powershell(
    "New-Item -Force -Path ('HKCU:\\' + $d.key) | Out-Null; Set-ItemProperty -LiteralPath ('HKCU:\\' + $d.key) -Name $d.name -Value $d.value",
    { key: KEYS.run, name: qa.appId, value }
  )
}

function deleteRunValue() {
  powershell(
    "$p = 'HKCU:\\' + $d.key; if ((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p).GetValueNames() -contains $d.name)) { Remove-ItemProperty -LiteralPath $p -Name $d.name }; exit 0",
    { key: KEYS.run, name: qa.appId }
  )
}

/** Every HKCU uninstall entry whose DisplayName starts with the QA product name. */
function qaUninstallEntries() {
  return JSON.parse(
    powershell(
      // -InputObject: piped, Windows PowerShell 5.1 turns a one-element array into a bare string.
      "ConvertTo-Json -Compress -InputObject @(Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { ([string]$_.GetValue('DisplayName')).StartsWith($d.name) } | ForEach-Object { $_.PSChildName })",
      { name: qa.productName }
    ) || '[]'
  )
}

/** The target of a .lnk file (WScript.Shell), or null when there is none. */
function linkTarget(file) {
  if (!fs.existsSync(file)) return null
  return powershell('(New-Object -ComObject WScript.Shell).CreateShortcut($d.file).TargetPath', {
    file
  })
}

const desktopLink = () =>
  path.join(powershell("[Environment]::GetFolderPath('Desktop')"), `${qa.productName}.lnk`)

/** The 8.3 form of an existing path. */
function shortPath(long) {
  return powershell(
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($d.path).ShortPath',
    { path: long }
  )
}

/** The install log's lines (UTF-16LE with a BOM), or []. */
function installLog() {
  if (!fs.existsSync(INSTALL_LOG)) return []
  return fs
    .readFileSync(INSTALL_LOG, 'utf16le')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)
}

/**
 * `step|result|reason` of each log line written since `from` lines; a recovery
 * line also carries what it wrote back: `recover|recovered|restored|wrote=<names>`
 * (`wrote=none`: every value of the copy was still live, nothing was restored).
 */
function logSteps(from) {
  return installLog()
    .slice(from)
    .map((line) => {
      const m = / step=(\S+) result=(\S+) reason=(\S+)(?:.* wrote=(\S+))?/.exec(line)
      return m ? `${m[1]}|${m[2]}|${m[3]}${m[4] ? `|wrote=${m[4]}` : ''}` : line
    })
}

/** A recovery that wrote back exactly `names` (the order dnRecoverState writes them). */
const RECOVERED = (names) => `recover|recovered|restored|wrote=${names.length ? names.join(',') : 'none'}`

/**
 * `steps` holds `order` as a subsequence, in that order (a string matches exactly,
 * a RegExp by test). Returns the index of each match.
 */
function assertOrder(steps, order, label) {
  const found = []
  let at = 0
  for (const wanted of order) {
    const index = steps.findIndex(
      (entry, i) => i >= at && (typeof wanted === 'string' ? entry === wanted : wanted.test(entry))
    )
    assert.ok(
      index >= 0,
      `${label}: log has ${wanted} after ${found.length ? order[found.length - 1] : 'the start'} (log: ${steps.join(' -> ')})`
    )
    found.push(index)
    at = index + 1
  }
  return found
}

// ---------------------------------------------------------------------------
const timings = []
const notes = []
const started = []

async function step(name, run) {
  const t0 = Date.now()
  process.stdout.write(`\n== ${name}\n`)
  try {
    const result = await run()
    timings.push([name, Date.now() - t0, 'ok'])
    return result
  } catch (error) {
    timings.push([name, Date.now() - t0, 'FAILED'])
    throw error
  }
}

/** Runs an installer or uninstaller and waits for it; returns its exit code. */
function runInstaller(file, extra = [], env = {}) {
  const t0 = Date.now()
  const r = spawnSync(file, extra, {
    env: { ...process.env, ...env },
    timeout: 10 * 60_000,
    windowsHide: true
  })
  if (r.error) throw r.error
  console.log(
    `  ${path.basename(file)} ${extra.join(' ')} -> exit ${r.status} in ${Date.now() - t0} ms`
  )
  return r.status
}

/**
 * A one-click NSIS uninstaller copies itself to %TEMP% and returns at once; wait
 * until the uninstall entry and the folder are gone (or `timeout`).
 */
async function uninstall(dir, extra = ['/S', '/currentuser']) {
  const code = runInstaller(path.join(dir, UNINSTALLER), extra)
  assert.equal(code, 0, 'the uninstaller started')
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (!reg(KEYS.uninstall) && !fs.existsSync(path.join(dir, EXE))) return
    await sleep(1000)
  }
  throw new Error('the uninstall did not finish in 3 minutes')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startApp(exe, label) {
  const child = spawn(exe, [], { stdio: 'ignore', detached: false })
  child.on('error', (error) => console.log(`  ${label}: ${error.message}`))
  started.push(child)
  console.log(`  started ${label} (pid ${child.pid}): ${exe}`)
  return child
}

/** Stops a process this script started, and its children (taskkill /T on its PID only). */
async function stopApp(child) {
  if (child.exitCode !== null) return
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  for (let i = 0; i < 50 && child.exitCode === null && child.signalCode === null; i++)
    await sleep(100)
  await sleep(1500) // its children release their files
}

/** Holds a file open without FILE_SHARE_DELETE (as a running program would) until released. */
async function holdFile(file) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$f = [IO.File]::Open($env:DN_HOLD, 'Open', 'Read', 'Read'); Set-Content -LiteralPath $env:DN_READY 'held'; Start-Sleep -Seconds 900; $f.Close()"
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, DN_HOLD: file, DN_READY: path.join(process.env.TEMP, 'dn-e2e-held') }
    }
  )
  started.push(child)
  const marker = path.join(process.env.TEMP, 'dn-e2e-held')
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await sleep(100)
  assert.ok(fs.existsSync(marker), `${file} is held`)
  fs.rmSync(marker, { force: true })
  return child
}

// ---------------------------------------------------------------------------
// What the legacy app would have left behind: a login item and MCP entries naming
// the old exe (the Run value and the Codex entry through the 8.3 short path, the
// old folder's own short name included: once the folder is removed only the
// installer's record says which alias it had).

/**
 * The legacy folder's own 8.3 name while it exists ("" when it has none: 8.3
 * names off, or a valid 8.3 name), which the record must carry (round 9).
 */
let legacyShortName = ''
/** The Run value as seeded (through the old folder's 8.3 path), until the app repoints it. */
let seededRun = ''

function seedLegacyEntries() {
  const oldExe = path.join(OLD, EXE)
  const shortOldExe = path.join(shortPath(OLD), EXE)
  seededRun = `"${shortOldExe}"`
  setRunValue(seededRun)
  const entry = {
    command: oldExe,
    args: [path.join(OLD, 'resources', 'mcp', 'cli.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
  fs.mkdirSync(path.join(SANDBOX, '.codex'), { recursive: true })
  fs.mkdirSync(path.join(SANDBOX, 'AppData', 'Roaming', 'Claude'), { recursive: true })
  fs.writeFileSync(
    path.join(SANDBOX, '.claude.json'),
    JSON.stringify({ theme: 'dark', mcpServers: { [qa.mcpServerKey]: entry } }, null, 2) + '\n'
  )
  fs.writeFileSync(
    path.join(SANDBOX, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    JSON.stringify({ mcpServers: { other: { command: 'npx' }, [qa.mcpServerKey]: entry } }) + '\n'
  )
  fs.writeFileSync(
    path.join(SANDBOX, '.codex', 'config.toml'),
    `model = "o3"\n\n[mcp_servers.${qa.mcpServerKey}]\ncommand = ${JSON.stringify(shortOldExe)}\nargs = []\n\n[projects."C:/work/[demo]"]\ntrust_level = "trusted"\n`
  )
  console.log(
    `  seeded: Run = "${shortOldExe}", three MCP configs naming the old exe; the old folder's 8.3 name: ${legacyShortName || '(none)'}`
  )
}

function mcpCommands() {
  const json = (file) =>
    JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.[qa.mcpServerKey]?.command
  const toml = fs.readFileSync(path.join(SANDBOX, '.codex', 'config.toml'), 'utf8')
  const codex = new RegExp(`\\[mcp_servers\\.${qa.mcpServerKey}\\]\\ncommand = ("[^"\\n]*")`).exec(
    toml.replace(/\r\n/g, '\n')
  )
  return {
    claudeCode: json(path.join(SANDBOX, '.claude.json')),
    claudeDesktop: json(
      path.join(SANDBOX, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    ),
    codex: codex ? JSON.parse(codex[1]) : null,
    codexKeepsProjects: toml.includes('[projects."C:/work/[demo]"]\ntrust_level = "trusted"')
  }
}

/** Nothing of the QA identity is installed (checked before each scenario). */
function assertClean(label) {
  assert.ok(!fs.existsSync(OLD), `${label}: ${OLD} absent`)
  assert.ok(!fs.existsSync(NEW), `${label}: ${NEW} absent`)
  assert.equal(reg(KEYS.uninstall), null, `${label}: no uninstall entry`)
  assert.equal(reg(KEYS.state), null, `${label}: no Software\\{GUID}`)
  assert.equal(reg(KEYS.recovery), null, `${label}: no recovery copy`)
}

/** Resets what a scenario leaves behind that the next one must not inherit. */
function resetIdentityState() {
  deleteRunValue()
  powershell(
    "foreach ($k in $d.keys) { $p = 'HKCU:\\' + $k; if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force } }; exit 0",
    { keys: [KEYS.status, KEYS.state, KEYS.recovery] }
  )
  fs.rmSync(PROFILE, { recursive: true, force: true })
}

async function installLegacy(label) {
  const code = runInstaller(installers.legacy, ['/S'])
  assert.equal(code, 0, `${label}: legacy install exit code`)
  assert.ok(fs.existsSync(path.join(OLD, EXE)), `${label}: legacy exe in ${OLD}`)
  assert.ok(!fs.existsSync(NEW), `${label}: no new folder yet`)
  assertRegisteredIn(OLD, `${label}: the legacy install is registered`)
  const short = path.basename(shortPath(OLD))
  legacyShortName = short.toLowerCase() === qa.packageName.toLowerCase() ? '' : short
}

/**
 * electron-builder registers an install twice: UninstallString in the uninstall
 * entry and InstallLocation in Software\{GUID}. Both must name `dir`.
 */
function assertRegisteredIn(dir, label) {
  assert.equal(
    reg(KEYS.uninstall)?.UninstallString?.toLowerCase(),
    `"${path.join(dir, UNINSTALLER)}" /currentuser`.toLowerCase(),
    `${label}: UninstallString`
  )
  assert.equal(
    reg(KEYS.state)?.InstallLocation?.toLowerCase(),
    dir.toLowerCase(),
    `${label}: InstallLocation`
  )
}

/** The record of a move from `from` to `to`, carrying the old folder's 8.3 name `short` exactly. */
const RECORD = (from, to, short) =>
  new RegExp(
    `^DNMR2\\|${GUID}\\|${qa.packageName}\\|${qa.productName}\\|${escape(from)}\\|${escape(to)}\\|${escape(short)}\\|\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\|END$`,
    'i'
  )
function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The state right after a completed move, before the app's first launch. */
function assertMoved(label) {
  assert.ok(!fs.existsSync(OLD), `${label}: ${OLD} removed`)
  for (const rel of [EXE, path.join('resources', 'app.asar'), UNINSTALLER])
    assert.ok(fs.existsSync(path.join(NEW, rel)), `${label}: ${rel} in the new folder`)
  assert.deepEqual(qaUninstallEntries(), [GUID], `${label}: exactly one QA uninstall entry`)
  assertRegisteredIn(NEW, `${label}: the new install is registered`)
  const state = reg(KEYS.state)
  assert.ok(state, `${label}: Software\\{GUID} exists`)
  assert.match(
    state.MigrationRecord ?? '',
    RECORD(OLD, NEW, legacyShortName),
    `${label}: MigrationRecord (the old folder's 8.3 name: ${legacyShortName || '(none)'})`
  )
  assert.equal(reg(KEYS.journal), null, `${label}: journal gone`)
  assert.equal(reg(KEYS.recovery), null, `${label}: recovery copy gone`)
  assert.equal(reg(KEYS.recoveryParent), null, `${label}: recovery parent gone`)
  const status = reg(KEYS.status)
  assert.deepEqual(
    [status?.LastStep, status?.LastResult, status?.LastReason],
    ['record', 'moved', 'record-written'],
    `${label}: status`
  )
  assert.match(status?.LastRun ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  assert.equal(linkTarget(START_MENU_LINK)?.toLowerCase(), path.join(NEW, EXE).toLowerCase())
  assert.equal(linkTarget(desktopLink())?.toLowerCase(), path.join(NEW, EXE).toLowerCase())
}

/** Launches the installed app and waits for it to consume the record. */
async function firstLaunch(label) {
  const app = startApp(path.join(NEW, EXE), `${label} first launch`)
  const deadline = Date.now() + 240_000
  let status = null
  while (Date.now() < deadline) {
    status = reg(KEYS.status)
    if (status?.AppMigration === 'complete') break
    if (app.exitCode !== null) throw new Error(`${label}: the app exited (${app.exitCode})`)
    await sleep(1000)
  }
  console.log(`  status after launch: ${JSON.stringify(status)}`)
  assert.equal(status?.AppMigration, 'complete', `${label}: AppMigration`)
  assert.equal(status?.AppMigrationReason, 'repointed', `${label}: AppMigrationReason`)
  assert.match(status?.AppMigrationLastAttempt ?? '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  assert.equal(reg(KEYS.state)?.MigrationRecord, undefined, `${label}: record consumed`)
  const run = reg(KEYS.run)?.[qa.appId]
  assert.equal(
    run?.toLowerCase(),
    `"${path.join(NEW, EXE)}"`.toLowerCase(),
    `${label}: Run value repointed`
  )
  const mcp = mcpCommands()
  const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : value)
  const exe = path.join(NEW, EXE).toLowerCase()
  assert.deepEqual(
    Object.fromEntries(Object.entries(mcp).map(([k, v]) => [k, lower(v)])),
    { claudeCode: exe, claudeDesktop: exe, codex: exe, codexKeepsProjects: true },
    `${label}: MCP configs repointed (${JSON.stringify(mcp)})`
  )
  const file = JSON.parse(
    fs.readFileSync(path.join(PROFILE, 'install-migration-status.json'), 'utf8')
  )
  assert.deepEqual([file.state, file.reason], ['complete', 'repointed'])
  await stopApp(app)
}

async function uninstallAndCheck(label) {
  const before = installLog().length
  await uninstall(NEW)
  assert.ok(!fs.existsSync(NEW), `${label}: new folder removed`)
  assert.ok(!fs.existsSync(OLD), `${label}: no old folder`)
  assert.equal(reg(KEYS.uninstall), null, `${label}: uninstall entry removed`)
  assert.equal(reg(KEYS.state), null, `${label}: Software\\{GUID} removed`)
  assert.equal(reg(KEYS.recovery), null, `${label}: recovery copy removed`)
  assert.equal(reg(KEYS.recoveryParent), null, `${label}: recovery parent removed`)
  assert.equal(linkTarget(START_MENU_LINK), null, `${label}: Start menu shortcut removed`)
  assert.equal(linkTarget(desktopLink()), null, `${label}: desktop shortcut removed`)
  const status = reg(KEYS.status)
  assert.deepEqual(
    [status?.LastStep, status?.LastResult, status?.LastReason],
    ['uninstall', 'uninstalled', 'no-pending-move'],
    `${label}: status after uninstall`
  )
  assert.ok(logSteps(before).includes('uninstall|uninstalled|no-pending-move'))
  // Kept on purpose (owner acknowledgement item): the status key and the log; the profile.
  assert.ok(fs.existsSync(INSTALL_LOG), `${label}: install log kept`)
  assert.ok(fs.existsSync(PROFILE), `${label}: profile kept`)
  const run = reg(KEYS.run)?.[qa.appId]
  notes.push(
    `${label}: after the uninstall the Run value is ${run === undefined ? 'gone' : `still ${run} (electron-builder's uninstaller leaves an app's own login item; only an unfinished move's is dropped)`}`
  )
}

// ---------------------------------------------------------------------------

async function scenarioA() {
  await step('A0 clean machine', () => assertClean('A0'))
  await step('A1 legacy QA install /S', () => installLegacy('A1'))
  await step('A1 seed login item and MCP entries', () => seedLegacyEntries())
  const before = installLog().length
  await step('A2 current QA install /S --updated', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    assertMoved('A2')
    const steps = logSteps(before)
    console.log(`  log: ${steps.join(' -> ')}`)
    assertOrder(
      steps,
      [
        'plan|plan-move|legacy-found',
        'close|close-ok|none',
        'park|parked|parked',
        // The copy saved before "uninstall old version" is checked and deleted in
        // customInstall; the legacy command was parked, so the stock step ran no
        // uninstaller and nothing had to be restored. (Restoration is B3, D4, D6.)
        RECOVERED([]),
        'remove|moved|removed',
        'record|moved|record-written'
      ],
      'A2'
    )
    // Not yet repointed: that is the app's job, on the record.
    assert.equal(reg(KEYS.run)?.[qa.appId], seededRun, 'A2: the Run value as seeded')
  })
  await step('A3 first launch consumes the record', () => firstLaunch('A3'))
  await step('A4 uninstall /S', () => uninstallAndCheck('A4'))
}

async function scenarioB() {
  await step('B0 reset', () => {
    resetIdentityState()
    assertClean('B0')
  })
  await step('B1 legacy QA install /S', () => installLegacy('B1'))
  await step('B1 seed login item and MCP entries', () => seedLegacyEntries())
  await step('B2 kill-step install, killed after "uninstall old version"', () => {
    const code = runInstaller(installers.steps, ['/S', '--updated'], {
      DN_TEST_STOP_AT: 'after-stock-uninstall'
    })
    assert.equal(code, 9, 'B2: the installer terminated itself at the step')
    // The old uninstall command was parked, so the stock step ran nothing; the new
    // files were copied and registered, then the run died before customInstall
    // verified them: the old folder is still there and the journal armed. The next
    // run's stock step will run the NEW copy's uninstaller (now the registered one),
    // which deletes Software\{GUID} with the journal: the recovery copy's case.
    assert.ok(fs.existsSync(path.join(OLD, EXE)), 'B2: old folder kept')
    assert.ok(fs.existsSync(path.join(NEW, EXE)), 'B2: new files copied')
    const journal = reg(KEYS.journal)
    console.log(`  journal: ${JSON.stringify(journal)}`)
    assert.equal(journal?.SourceDir?.toLowerCase(), OLD.toLowerCase(), 'B2: journal SourceDir')
    assert.equal(journal?.DestDir?.toLowerCase(), NEW.toLowerCase(), 'B2: journal DestDir')
    assert.match(journal?.LegacyUninstallString ?? '', /desktop-qa/i, 'B2: old command parked')
    assertRegisteredIn(NEW, 'B2: the new copy is registered')
    assert.equal(reg(KEYS.state)?.MigrationRecord, undefined, 'B2: no record')
  })
  const before = installLog().length
  await step('B3 current QA install /S --updated recovers and finishes', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    const steps = logSteps(before)
    console.log(`  log: ${steps.join(' -> ')}`)
    // customInit: B2's copy is checked (its journal still live, nothing to write)
    // BEFORE the run plans, and the plan resumes the journal. Then the stock step
    // runs the NEW copy's uninstaller (B2 registered it), which deletes
    // Software\{GUID} with the journal; customInstall writes it back from the copy.
    assertOrder(
      steps,
      [
        RECOVERED([]),
        'plan|plan-move|journal-resumed',
        'close|close-ok|none',
        'park|parked|nothing-to-park',
        /^recover\|recovered\|restored\|wrote=(?=.*\bSourceDir\b)(?=.*\bDestDir\b).*\bIdentity$/,
        'remove|moved|removed',
        'record|moved|record-written'
      ],
      'B3'
    )
    assertMoved('B3')
  })
  await step('B4 first launch consumes the record', () => firstLaunch('B4'))
  await step('B5 uninstall /S', () => uninstallAndCheck('B5'))
}

async function scenarioC() {
  await step('C0 reset', () => {
    resetIdentityState()
    assertClean('C0')
  })
  await step('C1 legacy QA install /S', () => installLegacy('C1'))
  const legacyApp = await step('C2 the legacy app is running', async () => {
    const app = startApp(path.join(OLD, EXE), 'legacy app')
    await sleep(8000)
    assert.equal(app.exitCode, null, 'C2: the legacy app runs')
    return app
  })
  const before = installLog().length
  await step('C3 /S without --updated while it runs: exit 2, nothing changed', async () => {
    assert.equal(runInstaller(installers.current, ['/S']), 2, 'C3: exit code')
    assert.equal(legacyApp.exitCode, null, 'C3: the legacy app was not closed')
    assert.ok(fs.existsSync(path.join(OLD, EXE)), 'C3: old folder intact')
    assertRegisteredIn(OLD, 'C3: still the legacy install')
    const status = reg(KEYS.status)
    assert.deepEqual(
      [status?.LastStep, status?.LastResult, status?.LastReason],
      ['close', 'exit-2', 'app-running-silent']
    )
    console.log(`  log: ${logSteps(before).join(' -> ')}`)
    await stopApp(legacyApp)
  })
  const held = path.join(OLD, 'LICENSE.electron.txt')
  const holder = await step('C4 hold a file in the old folder', () => holdFile(held))
  for (const run of [1, 2])
    await step(`C5.${run} /S --updated with the file held: journal stays armed`, () => {
      const mark = installLog().length
      assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
      const steps = logSteps(mark)
      console.log(`  log: ${steps.join(' -> ')}`)
      assert.ok(fs.existsSync(held), `C5.${run}: the held file is still there`)
      assert.ok(fs.existsSync(path.join(NEW, EXE)), `C5.${run}: new copy installed`)
      const journal = reg(KEYS.journal)
      assert.ok(
        journal?.SourceDir && journal?.DestDir,
        `C5.${run}: journal armed (${JSON.stringify(journal)})`
      )
      assert.equal(reg(KEYS.state)?.MigrationRecord, undefined, `C5.${run}: no record yet`)
      const status = reg(KEYS.status)
      assert.deepEqual(
        [status?.LastStep, status?.LastResult, status?.LastReason],
        ['remove', 'kept', 'file-in-use']
      )
      assert.deepEqual(qaUninstallEntries(), [GUID], `C5.${run}: one uninstall entry`)
    })
  await step('C6 release the file', () => stopApp(holder))
  await step('C7 third /S --updated finishes the move', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    assertMoved('C7')
  })
  await step('C8 uninstall /S', () => uninstallAndCheck('C8'))
}

/** The recovery copy's values for the journal: what the stock uninstaller deleted. */
const JOURNAL_VALUES = [
  'Identity',
  'SourceDir',
  'DestDir',
  'LegacyUninstallString',
  'DesktopLink',
  'StartMenuLink',
  'LegacyShortName'
]

/** The order dnRecoverState writes the journal values back in (Identity last). */
const JOURNAL_RESTORE_ORDER = [
  'LegacyUninstallString',
  'DesktopLink',
  'StartMenuLink',
  'LegacyShortName',
  'SourceDir',
  'DestDir',
  'Identity'
]

async function scenarioD() {
  await step('D0 reset', () => {
    resetIdentityState()
    assertClean('D0')
  })
  await step('D1 legacy QA install /S', () => installLegacy('D1'))
  await step('D1 seed login item and MCP entries', () => seedLegacyEntries())
  // A move left unfinished (a held file), so its journal is live and the NEW copy is
  // the registered install: the next update's stock step runs the new uninstaller.
  const held = path.join(OLD, 'LICENSE.electron.txt')
  const holder = await step('D2 hold a file in the old folder', () => holdFile(held))
  const journal = await step('D2 /S --updated with the file held: journal armed', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    const live = reg(KEYS.journal)
    console.log(`  journal: ${JSON.stringify(live)}`)
    assert.ok(live?.SourceDir && live?.DestDir && live?.Identity, 'D2: journal armed')
    assertRegisteredIn(NEW, 'D2: the new copy is registered')
    return live
  })
  await step('D2 release the file', () => stopApp(holder))
  await step('D3 kill-step update, killed the moment uninstallOldVersion returns', () => {
    const code = runInstaller(installers.steps, ['/S', '--updated'], {
      DN_TEST_STOP_AT: 'after-uninstall-old-version'
    })
    assert.equal(code, 9, 'D3: the installer terminated itself at the step')
    // The new copy's uninstaller ran and deleted Software\{GUID} with the journal;
    // only the recovery copy (written by dnSaveState just before) still has it.
    assert.equal(
      reg(KEYS.journal),
      null,
      'D3: the live journal was deleted by the stock uninstaller'
    )
    const copy = reg(KEYS.recovery)
    console.log(`  recovery copy: ${JSON.stringify(copy)}`)
    assert.equal(copy?.RecoveryFor?.split('|')[0], GUID, "D3: the recovery copy is this identity's")
    for (const name of JOURNAL_VALUES)
      assert.equal(copy?.[name], journal[name], `D3: the recovery copy has the journal's ${name}`)
    assert.ok(fs.existsSync(path.join(OLD, EXE)), 'D3: old folder kept')
  })
  let before = installLog().length
  await step('D4 /S --updated recovers the journal and finishes the move', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    const steps = logSteps(before)
    console.log(`  log: ${steps.join(' -> ')}`)
    // The first thing this run logs: the journal D3's stock uninstaller deleted,
    // written back value for value from the copy (exactly the values it had),
    // before any plan; then the move, from the recovered journal, finishes.
    const restored = JOURNAL_RESTORE_ORDER.filter((name) => journal[name])
    const [first] = assertOrder(
      steps,
      [
        RECOVERED(restored),
        /^plan\|plan-move\|/,
        'close|close-ok|none',
        /^park\|parked\|/,
        'remove|moved|removed',
        'record|moved|record-written'
      ],
      'D4'
    )
    assert.equal(first, 0, 'D4: the recovery is the run\'s first decision (customInit)')
    assert.ok(
      first < steps.findIndex((entry) => entry.startsWith('plan|')),
      'D4: the journal is recovered before the run plans'
    )
    assertMoved('D4')
  })
  // Now an unconsumed record is the live state (the app has not started yet).
  const record = reg(KEYS.state)?.MigrationRecord
  await step(
    'D5 kill-step update with the record live, killed the moment uninstallOldVersion returns',
    () => {
      const code = runInstaller(installers.steps, ['/S', '--updated'], {
        DN_TEST_STOP_AT: 'after-uninstall-old-version'
      })
      assert.equal(code, 9, 'D5: the installer terminated itself at the step')
      assert.equal(
        reg(KEYS.state)?.MigrationRecord,
        undefined,
        'D5: the stock uninstaller deleted the record'
      )
      const copy = reg(KEYS.recovery)
      console.log(`  recovery copy: ${JSON.stringify(copy)}`)
      assert.equal(copy?.MigrationRecord, record, 'D5: the recovery copy has the record exactly')
    }
  )
  before = installLog().length
  await step('D6 /S --updated recovers the record', () => {
    assert.equal(runInstaller(installers.current, ['/S', '--updated']), 0)
    const steps = logSteps(before)
    console.log(`  log: ${steps.join(' -> ')}`)
    // First: the record D5's stock uninstaller deleted, written back from the copy,
    // before any plan.
    const [first] = assertOrder(steps, [RECOVERED(['MigrationRecord']), /^plan\|/], 'D6')
    assert.equal(first, 0, 'D6: the recovery is the run\'s first decision (customInit)')
    assert.equal(reg(KEYS.state)?.MigrationRecord, record, 'D6: the record is back exactly')
    assert.equal(reg(KEYS.recovery), null, 'D6: recovery copy gone')
    assert.equal(reg(KEYS.recoveryParent), null, 'D6: recovery parent gone')
    assertRegisteredIn(NEW, 'D6: the new install is registered')
    assert.ok(fs.existsSync(path.join(NEW, EXE)), 'D6: the new exe is there')
  })
  await step('D7 first launch consumes the recovered record', () => firstLaunch('D7'))
  await step('D8 uninstall /S', () => uninstallAndCheck('D8'))
}

async function main() {
  console.log(`QA identity ${qa.appId}, APP_GUID ${GUID}; old ${OLD}; new ${NEW}`)
  assert.ok(GUID.startsWith('320d0756-'), 'the QA APP_GUID')
  try {
    if (only.has('A')) await scenarioA()
    if (only.has('B')) await scenarioB()
    if (only.has('C')) await scenarioC()
    if (only.has('D')) await scenarioD()
    const ran = new Set(timings.map(([name]) => name[0]))
    assert.deepEqual([...ran].sort(), [...only].sort(), 'every selected scenario ran')
  } finally {
    for (const child of started) await stopApp(child)
    const table = [
      '| Step | ms | |',
      '|---|---:|---|',
      ...timings.map(([name, ms, ok]) => `| ${name} | ${ms} | ${ok} |`)
    ].join('\n')
    console.log(`\n${table}\n`)
    for (const note of notes) console.log(`note: ${note}`)
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Installer end-to-end (QA identity)\n\n${table}\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`
      )
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true })
      fs.writeFileSync(path.join(evidence, 'timings.md'), `${table}\n`)
      if (fs.existsSync(INSTALL_LOG))
        fs.copyFileSync(INSTALL_LOG, path.join(evidence, path.basename(INSTALL_LOG)))
      fs.writeFileSync(
        path.join(evidence, 'final-state.json'),
        JSON.stringify(
          {
            status: reg(KEYS.status),
            run: reg(KEYS.run)?.[qa.appId] ?? null,
            uninstallEntries: qaUninstallEntries(),
            notes
          },
          null,
          2
        )
      )
    }
  }
  console.log(`installer end-to-end: every selected scenario passed (${[...only].join(', ')})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
