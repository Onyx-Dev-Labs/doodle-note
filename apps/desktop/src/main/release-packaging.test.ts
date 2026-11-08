import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const builderConfig = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')
const publishScript = readFileSync(
  new URL('../../scripts/publish-release.mjs', import.meta.url),
  'utf8'
)
const windowsBetaPublishScript = readFileSync(
  new URL('../../scripts/publish-windows-beta.mjs', import.meta.url),
  'utf8'
)
const brandScript = readFileSync(
  new URL('../../scripts/build-brand-assets.sh', import.meta.url),
  'utf8'
)
const ciWorkflow = readFileSync(
  new URL('../../../../.github/workflows/ci.yml', import.meta.url),
  'utf8'
)
const modelsView = readFileSync(new URL('../renderer/src/ModelsView.tsx', import.meta.url), 'utf8')
const desktopPackage = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
const packageCheck = createRequire(import.meta.url)('../../scripts/test-windows-package.cjs') as {
  problemsFor(files: string[]): string[]
  foreignNativeBinaries(unpackedDir: string): string[]
  nativeBinariesInAsar(file: string): { path: string; machine: string }[]
  missingRequiredBinaries(unpackedDir: string): string[]
  missingRequiredResources(resourcesDir: string): string[]
  missingDependencies(files: string[], dependencies: Record<string, string>): string[]
  REQUIRED_UNPACKED: string[]
  REQUIRED_RESOURCES: string[]
  listTree(dir: string): string[]
  fileListDifferences(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] }
}
const updaterSource = readFileSync(new URL('./updater.ts', import.meta.url), 'utf8')

function pngMetadata(url: URL): { width: number; height: number; colorType: number } {
  const png = readFileSync(url)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25]
  }
}

test('macOS packages the corrected icon under a cache-busting resource name', () => {
  assert.match(builderConfig, /from:\s*resources\/icon\.icns\s+to:\s*doodlenote-opaque-v0411\.icns/)
  assert.match(builderConfig, /CFBundleIconFile:\s*doodlenote-opaque-v0411\.icns/)
})

test('packaged MCP server retains its ES module metadata', () => {
  assert.match(
    builderConfig,
    /from:\s*\.\.\/\.\.\/packages\/doodle-note-mcp\/package\.json\s+to:\s*mcp\/package\.json/
  )
})

test('desktop and in-app mascot artwork use the opaque sage master', () => {
  const master = new URL('../../resources/icon-master.png', import.meta.url)
  const iPhoneIcon = new URL(
    '../../../ios/DoodleNote/Assets.xcassets/AppIcon.appiconset/icon-1024.png',
    import.meta.url
  )
  const generatedAssets = [
    new URL('../../resources/icon.png', import.meta.url),
    new URL('../renderer/src/assets/mascot-square.png', import.meta.url),
    new URL('../../../web/public/mascot.png', import.meta.url),
    new URL('../../../ios/DoodleNote/Assets.xcassets/Mascot.imageset/mascot.png', import.meta.url)
  ]

  assert.deepEqual(readFileSync(master), readFileSync(iPhoneIcon))
  assert.deepEqual(pngMetadata(master), { width: 1024, height: 1024, colorType: 2 })
  for (const asset of generatedAssets) {
    assert.equal(pngMetadata(asset).colorType, 2, `${asset.pathname} must not contain alpha`)
  }
  assert.match(brandScript, /iconutil --convert icns/)
  assert.match(brandScript, /node "\$SCRIPT_DIR\/build-windows-icons\.cjs"/)
})

test('macOS builds a DMG for website installs while retaining the ZIP updater', () => {
  assert.match(builderConfig, /target:\s*zip[\s\S]*target:\s*dmg/)
  assert.match(
    builderConfig,
    /artifactName:\s*\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/
  )
  assert.match(builderConfig, /path:\s*\/Applications/)
  assert.match(publishScript, /publishMacRelease/)
  assert.match(publishScript, /flags\.includes\('--dmg-only'\)/)
})

test('Windows builds an x64 NSIS updater with the Windows icon and native engines', () => {
  assert.match(builderConfig, /win:\s+[\s\S]*target:\s*nsis[\s\S]*arch:\s+- x64/)
  assert.match(builderConfig, /win:\s+[\s\S]*icon:\s*resources\/icon\.ico/)
  assert.match(builderConfig, /asarUnpack:[\s\S]*sherpa-onnx-win-x64/)
  assert.match(builderConfig, /artifactName:\s*\$\{productName\}-\$\{version\}-setup\.\$\{ext\}/)
  assert.match(publishScript, /name === 'latest\.yml'/)
  assert.match(publishScript, /name\.endsWith\('\.exe\.blockmap'\)/)
  assert.match(builderConfig, /publish:\s+[\s\S]*useMultipleRangeRequest:\s*false/)
})

/** The `mac.files` patterns, which replace the shared allowlist on macOS. */
function macFilePatterns(config: string): string[] {
  const mac = /^mac:\n((?:[ \t].*\n|\n)*)/m.exec(config.replace(/\r\n/g, '\n'))?.[1] ?? ''
  const files = /^ {2}files:\n((?: {4}.*\n)*)/m.exec(mac)?.[1] ?? ''
  return files
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/^(['"])(.*)\1$/, '$2'))
}

test('the Mac package excludes the Windows-only Koffi DLL loader', () => {
  const patterns = macFilePatterns(builderConfig)
  assert.ok(patterns.includes('out/**'), 'the mac files block was found')
  assert.ok(patterns.includes('!**/node_modules/koffi/**'))
  assert.ok(patterns.includes('!**/node_modules/@koromix/**'))
  // Windows still ships it, unpacked so its native binary loads from disk.
  assert.match(builderConfig, /asarUnpack:[\s\S]*"\*\*\/node_modules\/koffi\/\*\*"/)
  assert.match(
    builderConfig,
    /asarUnpack:[\s\S]*"\*\*\/node_modules\/@koromix\/koffi-win32-x64\/\*\*"/
  )
  const win = /^win:\n((?:[ \t].*\n|\n)*)/m.exec(builderConfig.replace(/\r\n/g, '\n'))?.[1] ?? ''
  assert.doesNotMatch(win, /node_modules\/(koffi|@koromix)\/\*\*|koffi-win32-x64/)
})

/** The `win.files` patterns, which replace the shared allowlist on Windows too. */
function winFilePatterns(config: string): string[] {
  const win = /^win:\n((?:[ \t].*\n|\n)*)/m.exec(config.replace(/\r\n/g, '\n'))?.[1] ?? ''
  const files = /^ {2}files:\n((?: {4}.*\n)*)/m.exec(win)?.[1] ?? ''
  return files
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).replace(/^(['"])(.*)\1$/, '$2'))
}

test('the Windows app.asar is limited to the built app, like the Mac one', () => {
  // Without an explicit allowlist the platform exclusions alone shipped src/,
  // scripts/, docs/ and editor/tooling files inside app.asar.
  assert.equal(winFilePatterns(builderConfig)[0], 'out/**')
  assert.ok(
    winFilePatterns(builderConfig)
      .slice(1)
      .every((pattern) => pattern.startsWith('!'))
  )
  assert.equal(macFilePatterns(builderConfig)[0], 'out/**')
  assert.match(
    ciWorkflow,
    /node apps\/desktop\/scripts\/test-windows-package\.cjs apps\/desktop\/release\/win-unpacked/
  )
})

test('the packaged-content check rejects source, tooling, tests and sourcemaps', () => {
  const { problemsFor } = packageCheck
  assert.deepEqual(
    problemsFor([
      'package.json',
      'out/main/index.js',
      'out/renderer/assets/index-abc.js',
      'node_modules/electron-updater/out/main.js.map',
      'node_modules/some-lib/test/helper.js'
    ]),
    []
  )
  const flagged = problemsFor([
    'src/main/index.ts',
    'scripts/build-windows-icons.cjs',
    'docs/calendar-accounts.md',
    '.eslintcache',
    'tsconfig.json',
    'out/main/index.js.map',
    'out/main/updater.test.js',
    'out/renderer/__tests__/a.js'
  ])
  assert.equal(flagged.length, 8)
})

test('Windows installs move to a DoodleNote folder without forking the install or profile', () => {
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const config = builderConfig.replace(/\r\n/g, '\n')
  assert.match(config, /^nsis:\n(?: {2}.*\n)*? {2}include: build\/windows-installer\.nsh$/m)
  // The uninstall key derives from appId and the profile (%APPDATA%\desktop, which
  // holds the library location, settings and accounts) from the package name.
  assert.match(config, /^appId: com\.doodlenote\.desktop$/m)
  assert.equal(JSON.parse(desktopPackage).name, 'desktop')
  assert.doesNotMatch(config, /extraMetadata|^ {2}guid:/m)
  for (const hook of ['customInit', 'customCheckAppRunning', 'customInstall']) {
    assert.match(installer, new RegExp(`!macro ${hook}\\b`))
  }
  // The old folder is deleted only in customInstall, after the new copy is verified
  // and the old folder has been checked again (dnFinishMigration).
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  )
    .replace(/\r\n/g, '\n')
    // Functions the uninstaller shares are named ${DN_FN}dnX (un.dnX there).
    .replace(/\$\{DN_FN\}/g, '')
  const install = installer.slice(installer.indexOf('!macro customInstall'))
  assert.equal(installer.match(/Call dnRemoveLegacyDir/g), null)
  assert.equal(installer.match(/Call dnFinishMigration/g)?.length, 1)
  assert.ok(
    install.indexOf('FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"') <
      install.indexOf('Call dnFinishMigration')
  )
  const finish = guards.slice(guards.indexOf('Function dnFinishMigration'))
  // dnFinishMigration and (uninstaller) dnUninstallLegacy, each after dnPinLegacy
  // (which runs dnCheckLegacyDir) and each followed by dnUnpin.
  assert.equal(guards.match(/^\s+Call dnRemoveLegacyDir$/gm)?.length, 2)
  assert.ok(finish.indexOf('Call dnPinLegacy') < finish.indexOf('Call dnRemoveLegacyDir'))
  assert.ok(finish.indexOf('Call dnRemoveLegacyDir') < finish.indexOf('Call dnUnpin'))
  const uninstallLegacy = guards.slice(guards.indexOf('Function dnUninstallLegacy'))
  assert.ok(
    uninstallLegacy.indexOf('Call dnPinLegacy') < uninstallLegacy.indexOf('Call dnRemoveLegacyDir')
  )
  assert.ok(
    uninstallLegacy.indexOf('Call dnRemoveLegacyDir') < uninstallLegacy.indexOf('Call dnUnpin')
  )
  // The record the app needs before it repoints anything is written only after a
  // real move, and otherwise only put back as it was saved: from the recovery key
  // after checking it names this identity's two folders (dnRecoverState), or from
  // memory (dnRestoreState).
  const removed = finish.indexOf('${if} $3 == "removed"')
  const restoreState = guards.slice(guards.indexOf('Function dnRestoreState'))
  const recoverState = guards.slice(
    guards.indexOf('Function dnRecoverState'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnRecoverState'))
  )
  for (const value of ['MigratedFrom', 'MigratedTo', 'MigratedAt']) {
    assert.equal(
      `${installer}\n${guards}`.split(`WriteRegStr HKCU $dnStateKey "${value}"`).length,
      4,
      value
    )
    assert.ok(finish.indexOf(`WriteRegStr HKCU $dnStateKey "${value}"`) > removed, value)
    assert.match(restoreState, new RegExp(`WriteRegStr HKCU \\$dnStateKey "${value}" \\$dnSaved`))
    assert.ok(
      recoverState.indexOf(`WriteRegStr HKCU $dnStateKey "${value}"`) >
        recoverState.indexOf('${andIf} $3 == "$1\\${PRODUCT_FILENAME}"\n      ${andIf} $4 != ""'),
      value
    )
  }
  // The recovery copy lives outside Software\{APP_GUID}, which electron-builder's
  // uninstaller deletes; customInit restores from it before anything reads the
  // journal; a user uninstall (not --updated) deletes it.
  assert.match(
    installer,
    /!define DN_RECOVERY_KEY "Software\\DoodleNote-InstallRecovery\\\$\{APP_GUID\}"/
  )
  const init = installer.slice(installer.indexOf('!macro customInit'))
  assert.ok(
    init.indexOf('StrCpy $dnRecoveryKey "${DN_RECOVERY_KEY}"') < init.indexOf('Call dnRecoverState')
  )
  assert.ok(init.indexOf('Call dnRecoverState') < init.indexOf('Call dnPlanMigration'))
  assert.ok(init.indexOf('Call dnRecoverState') < init.indexOf('Call dnTrustedJournal'))
  assert.ok(restoreState.indexOf('Call dnRecoverState') < restoreState.indexOf('dnRestoreValue'))
  const saveState = guards.slice(
    guards.indexOf('Function dnSaveState'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnSaveState'))
  )
  assert.ok(
    saveState.lastIndexOf('dnCopyValue') <
      saveState.indexOf('WriteRegStr HKCU $dnRecoveryKey "RecoveryFor"')
  )
  // Never DeleteRegKey HKCU "" (the whole hive): every use is guarded.
  for (const fnText of [saveState, recoverState])
    assert.ok(
      fnText.indexOf('${if} $dnRecoveryKey != ""') <
        fnText.indexOf('DeleteRegKey HKCU $dnRecoveryKey')
    )
  const uninstall = installer.slice(installer.indexOf('!macro customUnInstall'))
  assert.ok(
    uninstall.indexOf('${ifNot} ${isUpdated}') <
      uninstall.indexOf('DeleteRegKey HKCU "Software\\DoodleNote-InstallRecovery\\${APP_GUID}"')
  )
  assert.ok(removed > finish.indexOf('Call dnRemoveLegacyDir'))
  // Shortcuts: what the user had deleted stays deleted; pins are repointed by target only.
  assert.ok(
    install.indexOf('${if} $dnHadStartMenuLink == "0"') <
      install.indexOf('Delete "$newStartMenuLink"')
  )
  assert.ok(
    install.indexOf('Delete "$newStartMenuLink"') < install.indexOf('StrCpy $launchLink "$appExe"')
  )
  assert.ok(install.indexOf('Call dnRepointPins') < install.indexOf('Call dnFinishMigration'))
  assert.doesNotMatch(install, /CreateShortCut/)
  const running = installer.slice(installer.indexOf('!macro dnMigrationCheckAppRunning'))
  for (const link of ['$oldDesktopLink', '$oldStartMenuLink'])
    assert.ok(running.indexOf(`Push ${link}\n      Call dnShortcutState`) > 0, link)
  // A /D=<folder> install is never redirected, and only <LocalAppData>\Programs\APP_FILENAME
  // itself is (an install recorded in another folder named desktop is upgraded in place).
  assert.match(
    installer,
    /GetDParameter \$R0\s+\$\{if\} \$R0 == ""\s+StrCpy \$dnPlanDir "\$INSTDIR"\s+Call dnPlanMigration/
  )
  const plan = guards.slice(
    guards.indexOf('Function dnPlanMigration'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnPlanMigration'))
  )
  assert.ok(plan.indexOf('Push $dnPlanDir\n    Call dnCanonical') > 0)
  assert.ok(plan.indexOf('${elseif} $3 != $1') < plan.indexOf('StrCpy $dnPlanDir'))
})

test('the install migration journal belongs to one app identity and is validated before use', () => {
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  // Namespaced by APP_GUID (derived from appId), so a QA identity never reads it.
  assert.match(installer, /!define DN_STATE_KEY "Software\\\$\{APP_GUID\}"/)
  assert.match(installer, /!define DN_MIGRATION_KEY "\$\{DN_STATE_KEY\}\\InstallMigration"/)
  assert.doesNotMatch(installer, /Software\\DoodleNote\\/)
  assert.match(
    installer,
    /!define DN_MIGRATION_IDENTITY "\$\{APP_GUID\}\|\$\{APP_FILENAME\}\|\$\{PRODUCT_FILENAME\}"/
  )
  assert.match(installer, /StrCpy \$dnJournalKey "\$\{DN_MIGRATION_KEY\}"/)
  const guardsText = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const park = guardsText.slice(guardsText.indexOf('Function dnParkUninstaller'))
  for (const value of ['Identity', 'SourceDir', 'DestDir', 'LegacyUninstallString']) {
    assert.match(park, new RegExp(`WriteRegStr HKCU \\$dnJournalKey "${value}"`))
  }
  // Parking checks every registered command first and writes nothing if one is foreign.
  assert.ok(park.indexOf('Call dnCheckUninstallCommand') < park.indexOf('WriteRegStr'))
  const init = installer.slice(
    installer.indexOf('!macro customInit'),
    installer.indexOf('!macroend', installer.indexOf('!macro customInit'))
  )
  // Identity, destination and source are all checked (dnTrustedJournal) before
  // anything recorded is used.
  const restore = init.indexOf('WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"')
  assert.ok(restore > 0)
  for (const check of [
    'Call dnTrustedJournal',
    '${if} $R6 == ""',
    'Call dnUninstallerDir',
    '${if} $R9 == $R6'
  ]) {
    const at = init.indexOf(check)
    assert.ok(at > 0 && at < restore, check)
  }
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  )
    .replace(/\r\n/g, '\n')
    // Functions the uninstaller shares are named ${DN_FN}dnX (un.dnX there).
    .replace(/\$\{DN_FN\}/g, '')
  const trust = guards.slice(
    guards.indexOf('Function dnTrustedJournal'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnTrustedJournal'))
  )
  for (const check of [
    '${elseif} $1 != "${DN_MIGRATION_IDENTITY}"',
    '${if} $3 != $0',
    'Call dnCheckLegacyDir'
  ]) {
    assert.ok(trust.includes(check), check)
  }
  // Only the old folder's own uninstaller, parsed and normalised, is ever put back or
  // parked; a registered command that is neither the old nor the new folder's own
  // means: upgrade in place (customInit), before anything is closed or parked.
  assert.match(installer, /StrCpy \$\{OUT\} '"\$\{DIR\}\\\$\{UNINSTALL_FILENAME\}" \/currentuser'/)
  const ownUninstaller = guardsText.slice(guardsText.indexOf('Function dnUninstallerDir'))
  assert.match(ownUninstaller, /\$\{if\} \$2 S== " \/currentuser"/)
  assert.match(ownUninstaller, /\$\{andIf\} \$2 == "\$\{DN_UNINSTALLER_EXE\}"/)
  // The whole exe path is normalised before its name is compared (UNINST~1.EXE).
  assert.ok(
    ownUninstaller.indexOf('Push $1\n          Call dnCanonical') <
      ownUninstaller.indexOf('${GetFileName} $1 $2')
  )
  assert.match(installer, /!define DN_UNINSTALLER_EXE "Uninstall \$\{PRODUCT_FILENAME\}\.exe"/)
  assert.match(
    init,
    /Call dnCheckUninstallCommand\s+Pop \$R6\s+\$\{if\} \$R6 != ""\s+DetailPrint "Not moving \$dnLegacyDir: \$R6"\s+StrCpy \$INSTDIR \$dnLegacyDir\s+StrCpy \$dnLegacyDir ""/
  )
  assert.doesNotMatch(installer, /\$\{if\} \$R4 != ""\s+\$\{andIf\} \$R5 == ""/)
})

test('the install migration never removes through a link and closes only its own exe', () => {
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  )
    .replace(/\r\n/g, '\n')
    // Functions the uninstaller shares are named ${DN_FN}dnX (un.dnX there).
    .replace(/\$\{DN_FN\}/g, '')
  const both = `${installer}\n${guards}`
  const code = both
    .split('\n')
    .filter((line) => !line.trim().startsWith(';'))
    .join('\n')
  // NSIS's RMDir /r follows junctions (verified on Dev04); our walk never does.
  assert.doesNotMatch(code, /RMDir \/r/i)
  assert.match(guards, /DN_ATTR_REPARSE_POINT 0x400/)
  assert.match(guards, /GetFinalPathNameByHandleW/)
  assert.match(guards, /GetLongPathNameW/)
  assert.match(installer, /StrCpy \$dnProgramsRoot "\$LOCALAPPDATA\\Programs"/)
  assert.match(installer, /StrCpy \$dnProfileDir "\$APPDATA\\\$\{APP_FILENAME\}"/)
  for (const reason of [
    'is a junction or link',
    'has no ${DN_APP_EXE}',
    'the old folder is not $2\\${APP_FILENAME}',
    'the new folder is not $2\\${PRODUCT_FILENAME}',
    'overlaps the app profile',
    'the old and new folders overlap',
    'resolve to the same place'
  ]) {
    assert.ok(guards.includes(reason), reason)
  }
  // The exe is deleted last, so a partly removed folder is still recognisable.
  const remove = guards.slice(
    guards.indexOf('Function dnRemoveLegacyDir'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnRemoveLegacyDir'))
  )
  assert.ok(
    remove.indexOf('Push "${DN_APP_EXE}"\n        Call dnRemoveTreeAt') <
      remove.indexOf('Push ""\n          Call dnRemoveTreeAt')
  )
  // Removal is by verified handle only: no path-based Delete / RMDir in the deleter,
  // entries opened without following links, checked by file ID and final path.
  const tree = guards.slice(
    guards.indexOf('Function dnRemoveTreeAt'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnRemoveLegacyDir'))
  )
  assert.doesNotMatch(tree, /^\s+(Delete|RMDir)\b/m)
  assert.match(guards, /!define DN_OPEN_NO_FOLLOW 0x02200000/)
  assert.match(guards, /GetFileInformationByHandleEx\(p r0, i 9,/)
  assert.match(guards, /GetFileInformationByHandle\(p r0, p r1\)/)
  assert.match(guards, /SetFileInformationByHandle\(p r0, i 21,/)
  assert.ok(tree.includes('${orIf} $6 != "$9\\$4"'))
  assert.ok(tree.includes('${orIf} $6 != $9'))
  // The root is pinned before it is checked, checked again on the pinned handles,
  // and removed only through that pin: dnRemoveLegacyDir never opens a path.
  const fn = (name: string): string =>
    guards.slice(
      guards.indexOf(`Function ${name}`),
      guards.indexOf('FunctionEnd', guards.indexOf(`Function ${name}`))
    )
  const pinLegacy = fn('dnPinLegacy')
  assert.ok(pinLegacy.indexOf('Pop $dnPinRoot') < pinLegacy.indexOf('Call dnCheckLegacyDir'))
  assert.ok(pinLegacy.indexOf('Pop $dnPinProfile') < pinLegacy.indexOf('Call dnCheckLegacyDir'))
  assert.ok(pinLegacy.indexOf('Pop $dnPinDest') < pinLegacy.indexOf('Call dnCheckLegacyDir'))
  for (const check of [
    'the pinned old folder is not a real folder',
    'the pinned old folder is $2, not in $3',
    'the pinned old folder has no ${DN_APP_EXE}',
    'the pinned old folder overlaps the app profile',
    'the pinned old folder overlaps the new folder'
  ])
    assert.ok(pinLegacy.includes(check), check)
  assert.doesNotMatch(remove, /dnOpenNoFollow|dnFinalPath|CreateFileW/)
  assert.match(remove, /StrCpy \$1 \$dnPinRoot/)
  assert.ok(tree.includes('${if} $6 == $dnProtectProfile\n      ${orIf} $6 == $dnProtectDest'))
  // The test pause exists only in a harness build.
  assert.equal(guards.split('DN_TEST_PAUSE').length - 1, 4)
  assert.match(guards, /!ifdef DN_TEST_PAUSE\n/)
  assert.doesNotMatch(installer, /DN_TEST_PAUSE/)
  // Overlap with the profile is checked on resolved paths too (junctions followed).
  const legacyCheck = guards.slice(
    guards.indexOf('Function dnCheckLegacyDir'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function dnCheckLegacyDir'))
  )
  assert.match(legacyCheck, /Push \$dnProfileDir\n\s+Call dnResolved/)
  assert.ok(legacyCheck.includes('the old folder really overlaps the app profile'))
  assert.ok(legacyCheck.includes('the new folder really overlaps the app profile'))
  // The closer cannot hang: CIM timeouts, a budget, and a watchdog instead of nsExec.
  assert.doesNotMatch(code, /nsExec::/)
  assert.match(guards, /Get-CimInstance -ClassName Win32_Process -OperationTimeoutSec 10/)
  assert.match(guards, /\$\$budget\.Elapsed\.TotalSeconds -gt 25/)
  assert.match(guards, /WaitForSingleObject\(p r5, i r1\)/)
  assert.match(guards, /TerminateProcess\(p r5, i 1\)/)
  assert.equal(code.match(/Call dnRunHidden/g)?.length, 2)
  // electron-builder's prefix / image-name matching and taskkill fallback are never compiled in.
  for (const stock of [
    '_CHECK_APP_RUNNING',
    'KILL_PROCESS',
    'FIND_PROCESS',
    'taskkill',
    'StartsWith',
    'getProcessInfo'
  ]) {
    assert.ok(!code.includes(stock), stock)
  }
  assert.match(guards, /\[IO\.Path\]::GetFullPath\(\$\$p\.ExecutablePath\) -eq \$\$want/)
  // Paths reach PowerShell only through the environment.
  assert.doesNotMatch(
    guards.slice(guards.indexOf('!define DN_CLOSE_PS')).split('\n')[0],
    /\$\{DIR\}|\$INSTDIR/
  )
  // A pending migration checks the old folder on its own, whatever exists in the new one.
  const check = installer.slice(installer.indexOf('!macro dnMigrationCheckAppRunning'))
  assert.match(
    check,
    /^\s+\$\{if\} \$dnLegacyDir != ""\n\s+Push \$dnLegacyDir\n\s+Push \$INSTDIR\n\s+Call dnMigrationClose/m
  )
  const close = guards.slice(guards.indexOf('Function dnMigrationClose'))
  assert.ok(close.indexOf('dnCloseAppIn "$0"') < close.indexOf('dnEnsureNotRunning "$1"'))
  // Nothing is closed without consent: silent installs nobody asked for never close,
  // and a pending move with the old app running then quits with exit code 2.
  assert.match(guards, /\$\{elseif\} \$\{Silent\}\n\s+StrCpy \$\{OUT\} "never"/)
  assert.match(
    close,
    /\$\{elseif\} \$dnCloseResult == "running"\n\s+\$\{andIf\} \$dnClosePolicy == "never"\n(?:\s+;[^\n]*\n)*\s+DetailPrint [^\n]+\n\s+!insertmacro dnStatus close exit-2 app-running-silent "from=\$0"\n\s+SetErrorLevel 2\n\s+Quit/
  )
  // The journal and record survive electron-builder's uninstaller deleting
  // Software\{APP_GUID}: saved before "uninstall old version", restored first in customInstall.
  assert.match(check, /Call dnSaveState\n\s+!macroend/)
  assert.match(installer, /!macro customInstall\n(?:\s+;[^\n]*\n)*\s+Call dnRestoreState/)
  // A user uninstall (not --updated) removes an old folder an unfinished move left.
  assert.match(
    installer,
    /!macro customUnInstall\n\s+\$\{ifNot\} \$\{isUpdated\}[\s\S]*?Call un\.dnUninstallLegacy/
  )
  assert.match(
    ciWorkflow.replace(/\r\n/g, '\n'),
    /node apps\/desktop\/scripts\/test-windows-installer-guards\.cjs/
  )
})

test('every installer decision is recorded where QA can read it (status key and log)', () => {
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  // Per identity, outside Software\{APP_GUID} (deleted by every "uninstall old version").
  assert.match(
    installer,
    /!define DN_STATUS_KEY "Software\\DoodleNote-InstallStatus\\\$\{APP_GUID\}"/
  )
  assert.match(installer, /!define DN_STATUS_LOG "\$TEMP\\DoodleNote-install-\$\{APP_ID\}\.log"/)
  const init = installer.slice(installer.indexOf('!macro customInit'))
  assert.ok(
    init.indexOf('StrCpy $dnStatusKey "${DN_STATUS_KEY}"') < init.indexOf('Call dnRecoverState')
  )
  const uninstall = installer.slice(installer.indexOf('!macro customUnInstall'))
  assert.ok(
    uninstall.indexOf('StrCpy $dnStatusKey "${DN_STATUS_KEY}"') <
      uninstall.indexOf('Call un.dnUninstallLegacy')
  )
  // Every way out of the run is recorded first: each Quit in the guards follows a dnStatus.
  const lines = guards.split('\n')
  lines.forEach((line, i) => {
    if (line.trim() !== 'Quit') return
    const before = lines.slice(Math.max(0, i - 5), i).join('\n')
    assert.match(before, /!insertmacro dnStatus close (exit-2|cancelled) /, `Quit at line ${i + 1}`)
  })
  // Each decision point writes a status.
  for (const [fn, step] of [
    ['Function dnRecoverState', 'recover'],
    ['Function dnPlanMigration', 'plan'],
    ['Function dnMigrationClose', 'close'],
    ['Function dnParkUninstaller', 'park'],
    ['Function dnFinishMigration', 'remove'],
    ['Function dnFinishMigration', 'record'],
    ['Function ${DN_FN}dnUninstallLegacy', 'uninstall']
  ]) {
    const body = guards.slice(guards.indexOf(fn), guards.indexOf('FunctionEnd', guards.indexOf(fn)))
    assert.match(body, new RegExp(`!insertmacro dnStatus ${step} `), `${fn}: ${step}`)
  }
  const install = installer.slice(installer.indexOf('!macro customInstall'))
  assert.match(install, /!insertmacro dnStatus install in-place \$dnInstallWhy "to=\$INSTDIR"/)
  assert.match(install, /!insertmacro dnStatus install kept incomplete-install /)
  // The writer: four values and one log line; the log is bounded and starts with a BOM.
  const writer = guards.slice(guards.indexOf('Function ${DN_FN}dnStatus'))
  for (const value of ['LastRun', 'LastStep', 'LastResult', 'LastReason'])
    assert.match(writer, new RegExp(`WriteRegStr HKCU \\$dnStatusKey "${value}"`))
  assert.match(
    writer,
    /\$\{if\} \$5 > 65536\n\s+Delete "\$dnStatusLog\.1"\n\s+Rename \$dnStatusLog "\$dnStatusLog\.1"/
  )
  assert.match(writer, /FileWriteWord \$4 0xFEFF/)
  // The documented sentence about an install log is gone.
  const doc = readFileSync(
    new URL('../../../../docs/WINDOWS-RELEASE-QA.md', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(doc, /the reason is in the install\s+log/)
  assert.match(doc, /HKCU\\Software\\DoodleNote-InstallStatus\\\{APP_GUID\}/)
})

test('a Windows package missing its speech engine, Koffi, reflink or llama binaries fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-required-'))
  try {
    assert.deepEqual(packageCheck.missingRequiredBinaries(dir), packageCheck.REQUIRED_UNPACKED)
    for (const rel of packageCheck.REQUIRED_UNPACKED.slice(1)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), 'x')
    }
    assert.deepEqual(packageCheck.missingRequiredBinaries(dir), [
      'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // The QA packager uses package:win's (pnpm) node_modules collector even when started with node.
  const qa = readFileSync(new URL('../../scripts/package-win-qa.cjs', import.meta.url), 'utf8')
  assert.match(qa, /env\.npm_config_user_agent = 'pnpm'/)
})

test('the presence check covers every runtime binary, resource and dependency the app needs', () => {
  // What the round-2 QA collector bug dropped, and what else loads at run time.
  for (const rel of [
    'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
    'node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll',
    'node_modules/sherpa-onnx-win-x64/onnxruntime.dll',
    'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
    'node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node',
    'node_modules/@node-llama-cpp/win-x64-vulkan/bins/win-x64-vulkan/llama-addon.node',
    'node_modules/node-llama-cpp/node_modules/@node-llama-cpp/win-x64/bins/win-x64/llama-addon.node'
  ])
    assert.ok(packageCheck.REQUIRED_UNPACKED.includes(rel), rel)
  for (const rel of [
    'engine/dictation-helper.exe',
    'engine/dictation-helper.manifest.json',
    'mcp/cli.js'
  ])
    assert.ok(packageCheck.REQUIRED_RESOURCES.includes(rel), rel)
  const dir = mkdtempSync(join(tmpdir(), 'dn-resources-'))
  try {
    assert.deepEqual(packageCheck.missingRequiredResources(dir), packageCheck.REQUIRED_RESOURCES)
    for (const rel of packageCheck.REQUIRED_RESOURCES) {
      if (rel === 'mcp/cli.js') continue
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), 'x')
    }
    assert.deepEqual(packageCheck.missingRequiredResources(dir), ['mcp/cli.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // Every dependency of the app has its package in app.asar (production and QA alike).
  const dependencies = (JSON.parse(desktopPackage) as { dependencies: Record<string, string> })
    .dependencies
  assert.ok(Object.keys(dependencies).includes('sherpa-onnx-node'))
  const files = Object.keys(dependencies)
    .filter((name) => name !== 'koffi')
    .map((name) => `node_modules/${name}/package.json`)
  assert.deepEqual(packageCheck.missingDependencies(files, dependencies), ['koffi'])
  assert.deepEqual(
    packageCheck.missingDependencies([...files, 'node_modules/koffi/package.json'], dependencies),
    []
  )
  // A nested copy does not count as the app's own.
  assert.deepEqual(
    packageCheck.missingDependencies(
      [...files, 'node_modules/x/node_modules/koffi/package.json'],
      dependencies
    ),
    ['koffi']
  )
})

test('native binaries packed inside app.asar itself are checked for their CPU too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-asar-'))
  try {
    const pe = (machine: number): Buffer => {
      const b = Buffer.alloc(0x90)
      b.write('MZ', 0, 'latin1')
      b.writeUInt32LE(0x80, 0x3c)
      b.write('PE\0\0', 0x80, 'latin1')
      b.writeUInt16LE(machine, 0x84)
      return b
    }
    const contents: [string, Buffer][] = [
      ['out/main/index.js', Buffer.from('// app')],
      ['node_modules/a/x64.node', pe(0x8664)],
      ['node_modules/b/arm64.node', pe(0xaa64)],
      ['node_modules/c/linux.node', Buffer.from('\x7fELF' + '.'.repeat(80))],
      ['node_modules/d/short.dll', Buffer.from('MZ')]
    ]
    // An asar: [4][header pickle size] then the pickled JSON tree, then the file data.
    const files: Record<string, unknown> = {}
    let offset = 0
    for (const [rel, bytes] of contents) {
      const parts = rel.split('/')
      let node = files
      for (const part of parts.slice(0, -1)) {
        node[part] ??= { files: {} }
        node = (node[part] as { files: Record<string, unknown> }).files
      }
      node[parts.at(-1)!] = { size: bytes.length, offset: String(offset) }
      offset += bytes.length
    }
    ;(files.node_modules as { files: Record<string, unknown> }).files.e = {
      files: { 'unpacked.node': { size: 10, unpacked: true } }
    }
    const json = Buffer.from(JSON.stringify({ files }))
    const padded = Math.ceil(json.length / 4) * 4
    const headerPickle = Buffer.alloc(8 + padded)
    headerPickle.writeUInt32LE(4 + padded, 0)
    headerPickle.writeUInt32LE(json.length, 4)
    json.copy(headerPickle, 8)
    const prefix = Buffer.alloc(8)
    prefix.writeUInt32LE(4, 0)
    prefix.writeUInt32LE(headerPickle.length, 4)
    const asar = join(dir, 'app.asar')
    writeFileSync(asar, Buffer.concat([prefix, headerPickle, ...contents.map(([, b]) => b)]))
    assert.deepEqual(packageCheck.nativeBinariesInAsar(asar), [
      { path: 'node_modules/a/x64.node', machine: 'x64' },
      { path: 'node_modules/b/arm64.node', machine: '0xaa64' },
      { path: 'node_modules/c/linux.node', machine: 'not-pe' },
      { path: 'node_modules/d/short.dll', machine: 'not-pe' }
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('only x64 Windows native binaries ship unpacked in the Windows package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-unpacked-'))
  try {
    const pe = (machine: number): Buffer => {
      const b = Buffer.alloc(0x90)
      b.write('MZ', 0, 'latin1')
      b.writeUInt32LE(0x80, 0x3c)
      b.write('PE\0\0', 0x80, 'latin1')
      b.writeUInt16LE(machine, 0x84)
      return b
    }
    const files: Record<string, Buffer> = {
      'node_modules/koffi/win32_x64/koffi.node': pe(0x8664),
      'node_modules/@koromix/koffi-win32-arm64/koffi.node': pe(0xaa64),
      'node_modules/@reflink/reflink-linux-x64-gnu/reflink.node': Buffer.from('\x7fELF....'),
      'node_modules/sherpa-onnx-win-x64/onnxruntime.dll': pe(0x8664),
      'node_modules/sherpa-onnx-node/README.md': Buffer.from('docs')
    }
    for (const [rel, bytes] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true })
      writeFileSync(join(dir, rel), bytes)
    }
    assert.deepEqual(packageCheck.foreignNativeBinaries(dir).sort(), [
      'node_modules/@koromix/koffi-win32-arm64/koffi.node: PE machine 0xaa64, not x64',
      'node_modules/@reflink/reflink-linux-x64-gnu/reflink.node: not a Windows binary'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const win = winFilePatterns(builderConfig)
  assert.ok(
    win.includes('!**/node_modules/@koromix/koffi-{darwin,linux,freebsd,openbsd,android}-*/**')
  )
  assert.ok(win.includes('!**/node_modules/@reflink/reflink-{darwin,linux}-*/**'))
})

test('only the platform-guarded Windows speech worker loads Koffi', () => {
  const src = new URL('../', import.meta.url)
  const sources = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replace(/\\/g, '/'))
    .filter((name) => /\.(ts|tsx|js|cjs|mjs)$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name))
  const read = (name: string): string => readFileSync(new URL(name, src), 'utf8')
  const importing = (pattern: RegExp): string[] =>
    sources.filter((name) => pattern.test(read(name)))
  assert.deepEqual(importing(/['"]koffi['"]/), ['main/windows-asr-runtime.ts'])
  assert.deepEqual(importing(/['"]\.\/windows-asr-runtime['"]/), [
    'main/windows-asr-recognizers.ts'
  ])
  assert.deepEqual(importing(/['"]\.\/windows-asr-recognizers['"]/), ['main/engine-win.ts'])
  // engine-win is its own bundle entry, started only by the Windows hosts.
  assert.deepEqual(importing(/from ['"]\.\/engine-win['"]/), [])
  assert.match(read('main/windows-asr-runtime.ts'), /process\.platform !== 'win32'/)
  // Bark's helper check runs inside that same worker, through the FFI the worker already loads.
  assert.deepEqual(importing(/['"]\.\/windows-helper-check['"]/), ['main/engine-win.ts'])
  assert.doesNotMatch(read('main/windows-helper-check.ts'), /require\(|['"]koffi['"]/)
})

test('CI builds and retains a real Windows installer', () => {
  assert.match(ciWorkflow, /windows-package:[\s\S]*runs-on:\s*windows-latest/)
  assert.match(ciWorkflow, /pnpm --filter desktop package:win/)
  assert.match(ciWorkflow, /Smoke packaged Windows native modules/)
  assert.match(ciWorkflow, /sherpa and llama native modules loaded successfully/)
  assert.match(ciWorkflow, /Get-AuthenticodeSignature/)
  assert.match(ciWorkflow, /actions\/upload-artifact@[0-9a-f]{40}\s+# v7\.0\.1/)
  assert.match(desktopPackage, /release:win[\s\S]*verify-windows-signature\.ps1/)
})

test('Windows website betas cannot replace the production updater feed', () => {
  assert.match(desktopPackage, /publish:win-beta[\s\S]*publish-windows-beta\.mjs/)
  assert.match(windowsBetaPublishScript, /-beta-setup\.exe/)
  assert.doesNotMatch(windowsBetaPublishScript, /put\('updates\/latest\.yml'/)
  assert.match(updaterSource, /applyUpdatePolicy\(autoUpdater\)/)
})

test('macOS-only settings are gated out of the Windows UI', () => {
  assert.match(modelsView, /detect\?\.platform === 'darwin'[\s\S]*Full Island in menu bar/)
  assert.match(
    modelsView,
    /detect\?\.platform === 'darwin'[\s\S]*Capture without screen permission/
  )
})

const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test("the production Mac package ships Bark's typing helper beside the engine", () => {
  assert.match(builderConfig, /from: \.\.\/\.\.\/engine\/\.build\/release\/dictation-helper/)
  assert.match(builderConfig, /to: engine\/dictation-helper/)
  // The app looks for it in Resources/engine when packaged.
  assert.match(indexSource, /join\(process\.resourcesPath, 'engine', 'dictation-helper'\)/)
})

test('the microphone permission text covers dictation as well as meetings', () => {
  const text = /NSMicrophoneUsageDescription: (.+)/.exec(builderConfig)?.[1] ?? ''
  assert.match(text, /meeting audio/)
  assert.match(text, /dictation/i)
  assert.match(text, /on-device/)
  assert.match(text, /Nothing leaves your Mac/)
})

test('Bark is no longer limited to the development build, and still needs macOS and the engine', () => {
  const block = /dictation = createDictationHost\(\{[\s\S]*?\n {2}\}\)/.exec(indexSource)?.[0] ?? ''
  assert.ok(block.length > 0, 'the dictation host options were found')
  assert.doesNotMatch(block, /APP_CHANNEL\s*===\s*'dev'/)
  assert.match(block, /process\.platform === 'darwin' && engine instanceof EngineProcess/)
})

test("CI proves the QA package ships exactly the production package's files", () => {
  const differences = packageCheck.fileListDifferences(
    ['out/main/index.js', 'node_modules/a/index.js', 'package.json'],
    ['out/main/index.js', 'node_modules/b/index.js', 'package.json']
  )
  assert.deepEqual(differences, {
    onlyA: ['node_modules/a/index.js'],
    onlyB: ['node_modules/b/index.js']
  })
  assert.deepEqual(packageCheck.fileListDifferences(['x'], ['x']), { onlyA: [], onlyB: [] })
  const dir = mkdtempSync(join(tmpdir(), 'dn-tree-'))
  try {
    mkdirSync(join(dir, 'node_modules', 'k'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'k', 'k.node'), '')
    writeFileSync(join(dir, 'a.txt'), '')
    assert.deepEqual(packageCheck.listTree(dir), ['a.txt', 'node_modules/k/k.node'])
    assert.deepEqual(packageCheck.listTree(join(dir, 'missing')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  // After the production package and its checks: the QA package, then the comparison.
  const qaStep = ciWorkflow.indexOf(
    "- name: Check the QA package ships exactly the production package's files"
  )
  assert.ok(qaStep > ciWorkflow.indexOf('run: pnpm --filter desktop package:win'))
  assert.ok(qaStep > ciWorkflow.indexOf('uses: actions/upload-artifact'))
  const qa = ciWorkflow.slice(qaStep)
  assert.ok(
    qa.indexOf('node apps/desktop/scripts/package-win-qa.cjs --dir') <
      qa.indexOf(
        'node apps/desktop/scripts/test-windows-package.cjs apps/desktop/release-qa/win-unpacked --same-files-as apps/desktop/release/win-unpacked'
      )
  )
})
