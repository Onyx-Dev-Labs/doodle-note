import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appIdentity } from './app-identity'

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
  peImports(file: string): string[]
  isSystemDll(name: string): boolean
  dependencyClosure(
    dir: string,
    absent?: string[]
  ): { binaries: number; imports: number; missing: { binary: string; dll: string }[] }
  closureNegativeControl(dir: string, rel: string): string[]
  ggmlBackendProblems(dir: string, absent?: string[]): string[]
  listTree(dir: string): string[]
  fileListDifferences(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] }
  IDENTITY_DIFFERENCES: Record<
    string,
    (here: Buffer, there: Buffer, dirs: { here: string; there: string }) => string | null
  >
  PACKAGE_DIFFERENCES: Record<string, unknown>
  bundleSelfProblem(
    text: string,
    identity: { key: string },
    helperDigest: string | null
  ): string | null
  versionEntries(data: Buffer): [string, string][]
  equalExcept(a: Buffer, b: Buffer, start: number, end: number, holes?: [number, number][]): boolean
  guidText(bytes: Buffer): string
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
  // The record the app needs before it repoints anything is one value
  // (MigrationRecord), written in one step only after a real move (dnWriteRecord,
  // then the journal is cleared), or by the next run when one stopped in between
  // (dnCompleteMove), and otherwise only put back as it was saved: from the
  // recovery key after checking it is complete for this identity's two folders
  // (dnRecoverState), or from memory (dnRestoreState).
  const removed = finish.indexOf('${if} $3 == "removed"')
  const fnBody = (name: string): string =>
    guards.slice(
      guards.indexOf(`Function ${name}`),
      guards.indexOf('FunctionEnd', guards.indexOf(`Function ${name}`))
    )
  const restoreState = fnBody('dnRestoreState')
  const recoverState = fnBody('dnRecoverState')
  const writeRecord = fnBody('dnWriteRecord')
  const completeMove = fnBody('dnCompleteMove')
  assert.equal(
    `${installer}\n${guards}`.split('WriteRegStr HKCU $dnStateKey "MigrationRecord"').length,
    4
  )
  assert.doesNotMatch(`${installer}\n${guards}`, /\$dnStateKey "Migrated(From|To|At)"/)
  assert.match(
    writeRecord,
    /WriteRegStr HKCU \$dnStateKey "MigrationRecord" \$2\n\s+ReadRegStr \$3 HKCU \$dnStateKey "MigrationRecord"\n\s+\$\{if\} \$3 S== \$2/
  )
  assert.ok(finish.indexOf('Call dnWriteRecord') > removed)
  assert.ok(
    finish.indexOf('DeleteRegKey HKCU $dnJournalKey') >
      finish.indexOf('${if} $2 == "written"', finish.indexOf('Call dnWriteRecord'))
  )
  assert.ok(completeMove.indexOf('Call dnRecordCheck') < completeMove.indexOf('Call dnWriteRecord'))
  assert.ok(
    completeMove.indexOf('${if} $2 == "written"') <
      completeMove.indexOf('DeleteRegKey HKCU $dnJournalKey')
  )
  assert.match(
    restoreState,
    /Push \$dnSavedRecord\n\s+Call dnRecordCheck\n\s+Pop \$0\n\s+\$\{if\} \$0 == ""\n\s+WriteRegStr HKCU \$dnStateKey "MigrationRecord" \$dnSavedRecord/
  )
  // Journal values are restored Identity last (a journal cut short is incomplete).
  const recovered = [...recoverState.matchAll(/dnRecoverValue "(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(recovered, [
    'LegacyUninstallString',
    'DesktopLink',
    'StartMenuLink',
    'SourceDir',
    'DestDir',
    'Identity'
  ])
  const restored = [...restoreState.matchAll(/dnRestoreValue \$dnJournalKey "(\w+)"/g)].map(
    (m) => m[1]
  )
  assert.equal(restored.at(-1), 'Identity')
  const park = fnBody('dnParkUninstaller')
  assert.ok(park.indexOf('"DestDir" $1') < park.indexOf('"Identity" "${DN_MIGRATION_IDENTITY}"'))
  // The copy goes only after every value in it read back, then its parent if empty.
  const copyDeleted = recoverState.indexOf('DeleteRegKey HKCU $dnRecoveryKey')
  assert.ok(recoverState.lastIndexOf('dnMatchValue') < copyDeleted)
  assert.ok(recoverState.indexOf('StrCpy $5 "record-mismatch"') < copyDeleted)
  assert.ok(recoverState.indexOf('WriteRegStr HKCU $dnStateKey "MigrationRecord" $2') < copyDeleted)
  assert.ok(copyDeleted < recoverState.indexOf('DeleteRegKey /ifempty HKCU $dnRecoveryParent'))
  for (const at of [...recoverState.matchAll(/DeleteRegKey \/ifempty HKCU \$dnRecoveryParent/g)])
    assert.match(
      recoverState.slice(0, at.index),
      /\$\{(?:else)?if\} \$dnRecoveryParent != ""\n(?:\s+;[^\n]*\n)*\s+$/
    )
  // Test-only termination points compile to nothing in an installer.
  assert.match(
    guards,
    /!ifdef DN_TEST_STEPS\n(?:[^\n]*\n){1,8}?\s+System::Call 'kernel32::TerminateProcess\(p -1, i 9\)'[^]*?!else\n\s+!macro dnTestStep NAME\n\s+!macroend\n!endif/
  )
  assert.equal(guards.split('TerminateProcess(p -1').length - 1, 1)
  assert.doesNotMatch(installer, /DN_TEST_STEPS|dnTestStopAt/)
  // An earlier run's removed-but-unrecorded move is finished only after the new
  // copy is verified, and only when this run moves nothing.
  const inPlace = install.slice(install.indexOf('!insertmacro dnStatus install in-place'))
  assert.ok(inPlace.indexOf('${andIf} $R7 == $R9') < inPlace.indexOf('Call dnCompleteMove'))
  assert.ok(
    inPlace.indexOf('FileExists} "$INSTDIR\\resources\\app.asar"') <
      inPlace.indexOf('Call dnCompleteMove')
  )
  // The recovery copy lives outside Software\{APP_GUID}, which electron-builder's
  // uninstaller deletes; customInit restores from it before anything reads the
  // journal; a user uninstall (not --updated) deletes it.
  assert.match(installer, /!define DN_RECOVERY_KEY "\$\{DN_RECOVERY_PARENT\}\\\$\{APP_GUID\}"/)
  assert.match(installer, /!define DN_RECOVERY_PARENT "Software\\DoodleNote-InstallRecovery"/)
  const init = installer.slice(installer.indexOf('!macro customInit'))
  assert.ok(
    init.indexOf('StrCpy $dnRecoveryKey "${DN_RECOVERY_KEY}"') < init.indexOf('Call dnRecoverState')
  )
  assert.ok(
    init.indexOf('StrCpy $dnRecoveryParent "${DN_RECOVERY_PARENT}"') <
      init.indexOf('Call dnRecoverState')
  )
  assert.ok(init.indexOf('Call dnPlanMigration') < init.indexOf('Call dnJournalDone'))
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
  // Round 8: an installer runs the system's Windows PowerShell with no prelude; only the
  // harness (-D) names a missing PowerShell or prepends ConstrainedLanguage mode.
  assert.match(
    guards,
    /^!define \/ifndef DN_POWERSHELL "\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe"$/m
  )
  assert.match(guards, /^!define \/ifndef DN_CLOSE_PS_PRELUDE ""$/m)
  for (const text of [installer, builderConfig, desktopPackage])
    assert.doesNotMatch(text, /DN_POWERSHELL|DN_CLOSE_PS_PRELUDE/)
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
    ['Function dnWriteRecord', 'record'],
    ['Function dnCompleteMove', 'install'],
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

test('a user uninstall asks before closing the old app and drops a login entry that would start it', () => {
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  // The one-click uninstaller is SetSilent by customUnInstall: the policy comes from
  // the command line in customUnInit (--updated close, /S never, otherwise ask).
  const unInit = installer.slice(
    installer.indexOf('!macro customUnInit'),
    installer.indexOf('!macroend', installer.indexOf('!macro customUnInit'))
  )
  assert.match(unInit, /\$\{if\} \$\{isUpdated\}\n\s+StrCpy \$dnClosePolicy "close"/)
  assert.match(
    unInit,
    /\$\{GetOptions\} \$R0 "\/S" \$R1\n\s+\$\{if\} \$\{Errors\}\n\s+StrCpy \$dnClosePolicy "ask"\n\s+\$\{else\}\n\s+StrCpy \$dnClosePolicy "never"/
  )
  const unInstall = installer.slice(installer.indexOf('!macro customUnInstall'))
  assert.doesNotMatch(
    unInstall.slice(0, unInstall.indexOf('!macroend')),
    /!insertmacro dnClosePolicy/
  )
  // The login entry is this identity's (appId = the Run value name Electron writes).
  assert.match(unInstall, /StrCpy \$dnRunKey "Software\\Microsoft\\Windows\\CurrentVersion\\Run"/)
  assert.match(
    unInstall,
    /StrCpy \$dnStartupKey "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"/
  )
  assert.match(unInstall, /StrCpy \$dnLoginItem "\$\{APP_ID\}"/)
  for (const name of ['production', 'qa'] as const)
    assert.equal(appIdentity(name).loginItemName, appIdentity(name).appId)
  // Dropped only when the old folder is kept, and only after the close was refused.
  const legacy = guards.slice(guards.indexOf('Function ${DN_FN}dnUninstallLegacy'))
  const kept = legacy.indexOf('!insertmacro dnStatus uninstall uninstalled-legacy-kept')
  assert.ok(legacy.indexOf('Call ${DN_FN}dnDropLoginItem') < kept)
  assert.ok(
    legacy.indexOf('!insertmacro dnStatus uninstall uninstalled-legacy-removed') <
      legacy.indexOf('Call ${DN_FN}dnDropLoginItem')
  )
  const drop = guards.slice(
    guards.indexOf('Function ${DN_FN}dnDropLoginItem'),
    guards.indexOf('FunctionEnd', guards.indexOf('Function ${DN_FN}dnDropLoginItem'))
  )
  assert.match(drop, /Push "\$0\\\$\{DN_APP_EXE\}"\n\s+Call \$\{DN_FN\}dnCanonical/)
  assert.match(drop, /Push "\$1\\\$\{DN_APP_EXE\}"\n\s+Call \$\{DN_FN\}dnCanonical/)
  assert.match(drop, /DeleteRegValue HKCU \$dnStartupKey \$dnLoginItem/)
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
  // So do the install folder move's registry reads and writes (the main process asks the worker).
  assert.deepEqual(importing(/from ['"]\.\/windows-registry['"]/), ['main/engine-win.ts'])
  assert.doesNotMatch(read('main/windows-registry.ts'), /require\(|['"]koffi['"]|child_process/)
  assert.doesNotMatch(read('main/windows-install-record.ts'), /child_process|execFile/)
})

test('CI builds and retains a real Windows installer', () => {
  assert.match(ciWorkflow, /windows-package:[\s\S]*runs-on:\s*windows-latest/)
  assert.match(ciWorkflow, /pnpm --filter desktop package:win/)
  assert.match(ciWorkflow, /Smoke packaged Windows native modules/)
  assert.match(
    ciWorkflow.replace(/\r\n/g, '\n'),
    /Check Windows app\.asar contents[\s\S]*?run: node apps\/desktop\/scripts\/test-windows-package\.cjs apps\/desktop\/release\/win-unpacked\n/
  )
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
  const qa = ciWorkflow.slice(qaStep).replace(/\r\n/g, '\n')
  // The full QA package (round 8): only the NSIS target adds resources\elevate.exe.
  const qaBuild = qa.indexOf('node apps/desktop/scripts/package-win-qa.cjs\n')
  assert.ok(
    qaBuild >= 0 &&
      qaBuild <
        qa.indexOf(
          'node apps/desktop/scripts/test-windows-package.cjs apps/desktop/release-qa/win-unpacked --same-files-as apps/desktop/release/win-unpacked --negative-control'
        )
  )
})

test('only the identity files may differ between the QA and production packages, and only as allowed', () => {
  const allowed = packageCheck.IDENTITY_DIFFERENCES
  assert.deepEqual(Object.keys(allowed).sort(), [
    'app.asar/out/main/index.js',
    'app.asar/package.json'
  ])
  const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value, null, 2))
  const pkg = { name: 'desktop', version: '0.5.0', main: './out/main/index.js' }
  const none = { here: '', there: '' }
  assert.equal(
    allowed['app.asar/package.json'](json({ ...pkg, name: 'desktop-qa' }), json(pkg), none),
    null
  )
  assert.match(
    allowed['app.asar/package.json'](
      json({ ...pkg, name: 'desktop-qa', version: '0.5.1' }),
      json(pkg),
      none
    )!,
    /more than "name"/
  )
  assert.match(
    allowed['app.asar/package.json'](json({ ...pkg, name: 'other' }), json(pkg), none)!,
    /name other/
  )

  const dir = mkdtempSync(join(tmpdir(), 'dn-identity-diff-'))
  try {
    const resources = (name: string, digest: string): string => {
      const at = join(dir, name)
      mkdirSync(join(at, 'engine'), { recursive: true })
      writeFileSync(
        join(at, 'engine', 'dictation-helper.manifest.json'),
        JSON.stringify({ authenticodeSha256: digest })
      )
      return at
    }
    const [qaDigest, prodDigest] = ['a'.repeat(64), 'b'.repeat(64)]
    const dirs = { here: resources('qa', qaDigest), there: resources('prod', prodDigest) }
    const bundle = (identity: string, digest: string, tail = 'start();\n'): Buffer =>
      Buffer.from(
        'const DEFAULTS = {};\n' +
          (identity === 'qa' ? 'const QA_DICTATION_SHORTCUTS = { toggleShortcut: "X" };\n' : '') +
          'function appIdentity(name) {\n  return { name };\n}\n' +
          `const APP_IDENTITY = appIdentity(\n  "${identity}"\n);\n` +
          'function other() {}\n' +
          `var define_DOODLENOTE_HELPER_INTEGRITY_default = { digest: "${digest}", publisherCn: "Onyx Dev Labs LLC", thumbprints: [] };\n` +
          tail
      )
    const main = allowed['app.asar/out/main/index.js']
    assert.equal(main(bundle('qa', qaDigest), bundle('production', prodDigest), dirs), null)
    // Anything else that differs is a failure: code outside the block, ...
    assert.match(
      main(bundle('qa', qaDigest, 'start(1);\n'), bundle('production', prodDigest), dirs)!,
      /outside the identity block and the helper digest/
    )
    // (Round 9: whose digest each bundle pins is no longer the comparison's
    // business; each package's own check below decides it, whatever the other holds.)
    assert.equal(main(bundle('qa', prodDigest), bundle('production', prodDigest), dirs), null)
    // ... or a bundle without the identity block.
    assert.match(
      main(Buffer.from('start();\n'), bundle('production', prodDigest), dirs)!,
      /no identity block/
    )
    // Each package on its own (packageSelfProblems): its bundle is built for its
    // identity and pins its own helper's digest.
    const self = packageCheck.bundleSelfProblem
    const text = (identity: string, digest: string): string => bundle(identity, digest).toString()
    assert.equal(self(text('qa', qaDigest), { key: 'qa' }, qaDigest), null)
    assert.equal(self(text('production', prodDigest), { key: 'production' }, prodDigest), null)
    assert.match(
      self(text('production', prodDigest), { key: 'qa' }, prodDigest)!,
      /built for the production identity, not qa/
    )
    assert.match(
      self(text('qa', prodDigest), { key: 'qa' }, qaDigest)!,
      /helper digest b+ is not this package's helper's \(a+\)/
    )
    assert.match(self(text('qa', qaDigest), { key: 'qa' }, null)!, /is not this package's helper's/)
    assert.match(self('start();\n', { key: 'qa' }, qaDigest)!, /no identity block/)
    assert.match(
      self(
        text('qa', qaDigest).replace(/define_DOODLENOTE_HELPER[^\n]*\n/, ''),
        { key: 'qa' },
        qaDigest
      )!,
      /no helper digest/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the uninstaller records its earliest exits: status is set in the hook electron-builder runs first', () => {
  // electron-builder 26.15.3's own templates: the hook order this relies on.
  const require = createRequire(import.meta.url)
  const builder = require.resolve('electron-builder/package.json')
  const libPackage = createRequire(builder).resolve('app-builder-lib/package.json')
  const lib = JSON.parse(readFileSync(libPackage, 'utf8').replace(/\r\n/g, '\n')) as {
    version: string
  }
  // A new electron-builder must be checked against this test (and the harness) first.
  assert.equal(lib.version, '26.15.3')
  const templates = join(libPackage, '..', 'templates', 'nsis')
  const template = (name: string): string =>
    readFileSync(join(templates, name), 'utf8').replace(/\r\n/g, '\n')
  const uninstaller = template('uninstaller.nsh')
  const unOnInit = uninstaller.slice(
    uninstaller.indexOf('Function un.onInit'),
    uninstaller.indexOf('FunctionEnd', uninstaller.indexOf('Function un.onInit'))
  )
  assert.match(
    uninstaller,
    /Function un\.checkAppRunning\n\s+!insertmacro CHECK_APP_RUNNING\nFunctionEnd/
  )
  const firstCheck = unOnInit.indexOf('call un.checkAppRunning')
  assert.ok(firstCheck > 0)
  assert.ok(firstCheck < unOnInit.indexOf('!insertmacro customUnInit'))
  assert.ok(firstCheck < unOnInit.indexOf('!insertmacro initMultiUser'))
  // The uninstall section (customUnInstall) comes after un.onInit by construction.
  assert.ok(
    uninstaller.indexOf('!insertmacro customUnInstall') >
      uninstaller.indexOf('FunctionEnd', uninstaller.indexOf('Function un.onInit'))
  )
  const check = template('include/allowOnlyOneInstallerInstance.nsh')
  assert.match(
    check,
    /!macro CHECK_APP_RUNNING[^]*?!ifmacrodef customCheckAppRunning\n\s+!insertmacro customCheckAppRunning\n\s+!else/
  )
  // The installer runs customInit (.onInit) before CHECK_APP_RUNNING (the install section).
  assert.match(
    template('installer.nsi'),
    /Function \.onInit[^]*?!insertmacro customInit[^]*?FunctionEnd/
  )
  assert.match(template('installSection.nsh'), /!insertmacro CHECK_APP_RUNNING/)

  // Ours: the status destinations are the first thing customCheckAppRunning sets.
  const installer = readFileSync(
    new URL('../../build/windows-installer.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const hook = installer.slice(
    installer.indexOf('!macro customCheckAppRunning'),
    installer.indexOf('!macroend', installer.indexOf('!macro customCheckAppRunning'))
  )
  assert.match(
    hook,
    /^!macro customCheckAppRunning\n\s+!ifdef DN_PATH_FUNCTIONS\n\s+StrCpy \$dnStatusKey "\$\{DN_STATUS_KEY\}"\n\s+StrCpy \$dnStatusLog "\$\{DN_STATUS_LOG\}"\n\s+!endif\n\s+!insertmacro dnClosePolicy/
  )
  // The hooks harness calls them in the template's order.
  const harness = readFileSync(
    new URL('../../scripts/test-windows-uninstaller-hooks.nsi', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const harnessInit = harness.slice(harness.indexOf('Function un.onInit'))
  assert.ok(
    harnessInit.indexOf('call un.checkAppRunning') <
      harnessInit.indexOf('!insertmacro customUnInit')
  )
  assert.match(
    harness,
    /Function un\.checkAppRunning\n\s+!insertmacro customCheckAppRunning\nFunctionEnd/
  )
  assert.match(harness, /!include "\$\{INSTALLER_NSH\}"/)
  // The test-only "answer Cancel" never reaches an installer: without DN_TEST_ASK_CANCEL the
  // prompt has no silent default (a one-click uninstaller is silent when it asks).
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  assert.match(
    guards,
    /!ifdef DN_TEST_ASK_CANCEL\n\s+Var dnTestAsk\n\s+!define DN_ASK_ANSWER "\/SD IDCANCEL"\n!else\n\s+!define DN_ASK_ANSWER ""\n!endif/
  )
  assert.doesNotMatch(installer, /DN_TEST_ASK_CANCEL|dnTestAsk/)
  assert.doesNotMatch(builderConfig, /DN_TEST_/)
})

/**
 * A minimal x64 PE32+ image importing `imports` (import table) and `delayed`
 * (delay-load table): one section at RVA 0x1000 holding both tables and the names.
 */
function fakePe(imports: string[], delayed: string[] = []): Buffer {
  const headers = Buffer.alloc(0x200)
  headers.write('MZ', 0, 'latin1')
  headers.writeUInt32LE(0x40, 0x3c)
  headers.write('PE\0\0', 0x40, 'latin1')
  headers.writeUInt16LE(0x8664, 0x44)
  headers.writeUInt16LE(1, 0x46)
  headers.writeUInt16LE(240, 0x54)
  const optional = 0x58
  headers.writeUInt16LE(0x20b, optional)
  headers.writeBigUInt64LE(0x180000000n, optional + 24)
  headers.writeUInt32LE(16, optional + 108)
  const rva = 0x1000
  const importsSize = (imports.length + 1) * 20
  const delayedAt = importsSize
  const delayedSize = (delayed.length + 1) * 32
  let names = delayedAt + delayedSize
  const body = Buffer.alloc(
    names + [...imports, ...delayed].reduce((n, d) => n + d.length + 1, 0) + 16
  )
  imports.forEach((dll, i) => {
    body.writeUInt32LE(rva + names, i * 20 + 12)
    body.writeUInt32LE(1, i * 20) // OriginalFirstThunk, any nonzero
    body.write(`${dll}\0`, names, 'latin1')
    names += dll.length + 1
  })
  delayed.forEach((dll, i) => {
    body.writeUInt32LE(1, delayedAt + i * 32) // attributes: RVAs
    body.writeUInt32LE(rva + names, delayedAt + i * 32 + 4)
    body.write(`${dll}\0`, names, 'latin1')
    names += dll.length + 1
  })
  const directories = optional + 112
  if (imports.length) {
    headers.writeUInt32LE(rva, directories + 8)
    headers.writeUInt32LE(importsSize, directories + 12)
  }
  if (delayed.length) {
    headers.writeUInt32LE(rva + delayedAt, directories + 13 * 8)
    headers.writeUInt32LE(delayedSize, directories + 13 * 8 + 4)
  }
  const section = optional + 240
  headers.write('.idata', section, 'latin1')
  headers.writeUInt32LE(body.length, section + 8)
  headers.writeUInt32LE(rva, section + 12)
  headers.writeUInt32LE(body.length, section + 16)
  headers.writeUInt32LE(0x200, section + 20)
  return Buffer.concat([headers, body])
}

test("the package check requires every bundled DLL a binary imports, and ggml's backends", () => {
  const dir = mkdtempSync(join(tmpdir(), 'dn-closure-'))
  try {
    const put = (rel: string, data: Buffer): void => {
      mkdirSync(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true })
      writeFileSync(join(dir, ...rel.split('/')), data)
    }
    const bins = 'resources/app.asar.unpacked/node_modules/@node-llama-cpp/win-x64/bins/win-x64'
    put(
      'DoodleNote.exe',
      fakePe(['KERNEL32.dll', 'ffmpeg.dll'], ['winspool.drv', 'api-ms-win-core-synch-l1-2-0.dll'])
    )
    put('ffmpeg.dll', fakePe(['kernel32.dll']))
    put(
      `${bins}/llama-addon.node`,
      fakePe(
        ['node.exe', 'llama-common.dll', 'ggml-base.dll', 'llama.b9842.dll'],
        ['vcruntime140.dll']
      )
    )
    put(`${bins}/llama-common.dll`, fakePe(['ggml-base.dll', 'MSVCP140.dll']))
    put(`${bins}/llama.b9842.dll`, fakePe(['ggml.b9842.dll', 'ggml-base.dll']))
    put(`${bins}/ggml.b9842.dll`, fakePe(['ggml-base.dll']))
    put(`${bins}/ggml-base.dll`, fakePe(['kernel32.dll']))
    put(`${bins}/ggml-cpu-x64.dll`, fakePe(['ggml-base.dll']))
    put(`${bins}/ggml-cpu-haswell.dll`, fakePe(['ggml-base.dll']))
    const vulkan =
      'resources/app.asar.unpacked/node_modules/@node-llama-cpp/win-x64-vulkan/bins/win-x64-vulkan'
    put(`${vulkan}/ggml-base.dll`, fakePe(['kernel32.dll']))
    put(`${vulkan}/ggml-cpu-x64.dll`, fakePe(['ggml-base.dll']))
    put(`${vulkan}/ggml-cpu-haswell.dll`, fakePe(['ggml-base.dll']))
    put(`${vulkan}/ggml-vulkan.dll`, fakePe(['ggml-base.dll', 'vulkan-1.dll']))
    // Both tables are read, names lower-cased.
    assert.deepEqual(packageCheck.peImports(join(dir, 'DoodleNote.exe')), [
      'kernel32.dll',
      'ffmpeg.dll',
      'winspool.drv',
      'api-ms-win-core-synch-l1-2-0.dll'
    ])
    assert.deepEqual(packageCheck.peImports(join(dir, ...`${bins}/ggml-base.dll`.split('/'))), [
      'kernel32.dll'
    ])
    for (const name of [
      'kernel32.dll',
      'api-ms-win-crt-heap-l1-1-0.dll',
      'vcruntime140_1.dll',
      'vulkan-1.dll',
      'node.exe',
      'winspool.drv'
    ])
      assert.ok(packageCheck.isSystemDll(name), name)
    // Never Windows', whatever System32 holds: the bundled runtimes.
    for (const name of [
      'onnxruntime.dll',
      'ggml-base.dll',
      'llama-common.dll',
      'sherpa-onnx-c-api.dll',
      'ffmpeg.dll'
    ])
      assert.ok(!packageCheck.isSystemDll(name), name)
    const whole = packageCheck.dependencyClosure(dir)
    assert.deepEqual(whole.missing, [])
    assert.equal(whole.binaries, 13)
    assert.deepEqual(packageCheck.ggmlBackendProblems(dir), [])
    // ggml-base.dll gone: every binary that imports it is reported, the negative control passes.
    const base = `${bins}/ggml-base.dll`
    const without = packageCheck.dependencyClosure(dir, [base])
    assert.deepEqual(without.missing.map((m) => m.binary.split('/').pop()).sort(), [
      'ggml-cpu-haswell.dll',
      'ggml-cpu-x64.dll',
      'ggml.b9842.dll',
      'llama-addon.node',
      'llama-common.dll',
      'llama.b9842.dll'
    ])
    assert.ok(without.missing.every((m) => m.dll === 'ggml-base.dll'))
    assert.deepEqual(packageCheck.closureNegativeControl(dir, base), [])
    // A DLL only in another folder does not count (the loader looks beside the binary and the exe).
    assert.deepEqual(packageCheck.dependencyClosure(dir, [`${bins}/llama-common.dll`]).missing, [
      { binary: `${bins}/llama-addon.node`, dll: 'llama-common.dll' }
    ])
    // The eight-file presence list alone would pass this: the llama DLLs gone, the addon there.
    assert.ok(
      packageCheck.dependencyClosure(dir, [`${bins}/llama.b9842.dll`, `${bins}/ggml.b9842.dll`])
        .missing.length >= 1
    )
    // An Electron DLL beside the exe counts; gone, the exe reports it.
    assert.deepEqual(packageCheck.dependencyClosure(dir, ['ffmpeg.dll']).missing, [
      { binary: 'DoodleNote.exe', dll: 'ffmpeg.dll' }
    ])
    // Run-time backends: the baseline, the same variants in every copy, Vulkan's own.
    assert.deepEqual(packageCheck.ggmlBackendProblems(dir, [`${bins}/ggml-cpu-x64.dll`]), [
      `${bins}/ggml-cpu-x64.dll: ggml CPU backend missing`
    ])
    assert.deepEqual(packageCheck.ggmlBackendProblems(dir, [`${vulkan}/ggml-cpu-haswell.dll`]), [
      `${vulkan}/ggml-cpu-haswell.dll: ggml CPU backend missing`
    ])
    assert.deepEqual(packageCheck.ggmlBackendProblems(dir, [`${vulkan}/ggml-vulkan.dll`]), [
      `${vulkan}/ggml-vulkan.dll: ggml Vulkan backend missing`
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the writes a later run depends on are flushed to disk', () => {
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  assert.match(
    guards,
    /!macro dnFlushRegistry\n\s+System::Call 'advapi32::RegFlushKey\(i 0x80000001\)'\n!macroend/
  )
  const after = (write: string): void => {
    const at = guards.indexOf(write)
    assert.ok(at > 0, write)
    const next = guards.slice(at + write.length, at + write.length + 400)
    assert.match(next, /^[^]*?!insertmacro dnFlushRegistry/, write)
    // Flushed before anything else is written.
    assert.ok(
      next.indexOf('!insertmacro dnFlushRegistry') < (next.indexOf('WriteRegStr') + 1 || Infinity),
      write
    )
  }
  after('WriteRegStr HKCU $dnJournalKey "Identity" "${DN_MIGRATION_IDENTITY}"')
  after('WriteRegStr HKCU $dnStateKey "MigrationRecord" $2\n    ReadRegStr')
  after('WriteRegStr HKCU $dnRecoveryKey "RecoveryFor" "${DN_MIGRATION_IDENTITY}"')
  after('WriteRegStr HKCU $dnStateKey "MigrationRecord" $dnSavedRecord')
  const deleted = guards.indexOf('!insertmacro dnTestStep "recover-deleted"')
  assert.ok(
    guards.lastIndexOf('!insertmacro dnFlushRegistry', deleted) >
      guards.lastIndexOf('dnMatchValue', deleted)
  )
  assert.equal([...guards.matchAll(/^\s+!insertmacro dnFlushRegistry$/gm)].length, 5)
})

/** A VS_VERSIONINFO block (wLength, wValueLength, wType, key, value, children), 4-aligned. */
function versionBlock(key: string, value: Buffer | string | null, children: Buffer[] = []): Buffer {
  const pad = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)])
  const text = typeof value === 'string'
  const valueBytes =
    value === null ? Buffer.alloc(0) : text ? Buffer.from(`${value}\0`, 'utf16le') : value
  const head = Buffer.alloc(6)
  head.writeUInt16LE(text ? valueBytes.length / 2 : valueBytes.length, 2)
  head.writeUInt16LE(text ? 1 : 0, 4)
  const body = Buffer.concat([
    pad(Buffer.concat([head, Buffer.from(`${key}\0`, 'utf16le')])),
    pad(valueBytes),
    ...children.map(pad)
  ])
  body.writeUInt16LE(body.length, 0)
  return body
}

test('round 8 parity: version resources, byte ranges and GUIDs are read exactly', () => {
  const fixed = Buffer.alloc(52, 7)
  const info = versionBlock('VS_VERSION_INFO', fixed, [
    versionBlock('StringFileInfo', null, [
      versionBlock('040904b0', null, [
        versionBlock('CompanyName', 'Onyx Dev Labs'),
        versionBlock('ProductName', 'DoodleNote QA'),
        versionBlock('OriginalFilename', '')
      ])
    ]),
    versionBlock('VarFileInfo', null, [versionBlock('Translation', Buffer.from([9, 4, 0xb0, 4]))])
  ])
  assert.deepEqual(packageCheck.versionEntries(info), [
    ['VS_VERSION_INFO', fixed.toString('hex')],
    ['VS_VERSION_INFO/StringFileInfo', ''],
    ['VS_VERSION_INFO/StringFileInfo/040904b0', ''],
    ['VS_VERSION_INFO/StringFileInfo/040904b0/CompanyName', 'Onyx Dev Labs'],
    ['VS_VERSION_INFO/StringFileInfo/040904b0/ProductName', 'DoodleNote QA'],
    ['VS_VERSION_INFO/StringFileInfo/040904b0/OriginalFilename', ''],
    ['VS_VERSION_INFO/VarFileInfo', ''],
    ['VS_VERSION_INFO/VarFileInfo/Translation', '0904b004']
  ])

  const a = Buffer.from('0123456789abcdef')
  const b = Buffer.from(a)
  b[3] = 0
  b[10] = 0
  assert.ok(
    packageCheck.equalExcept(a, b, 0, 16, [
      [3, 4],
      [10, 11]
    ])
  )
  assert.ok(
    packageCheck.equalExcept(a, b, 0, 16, [
      [10, 11],
      [2, 5]
    ])
  )
  assert.ok(!packageCheck.equalExcept(a, b, 0, 16, [[3, 4]]))
  assert.ok(!packageCheck.equalExcept(a, b, 0, 16, [[4, 11]]))
  assert.ok(!packageCheck.equalExcept(a, b, 0, 16))

  // A helper build's #GUID heap and the class name csc.exe derived from it.
  assert.equal(
    packageCheck.guidText(Buffer.from('e67a91aba8330b43b2f2bd19dbdcc1e1', 'hex')),
    'AB917AE6-33A8-430B-B2F2-BD19DBDCC1E1'
  )
  assert.deepEqual(Object.keys(packageCheck.PACKAGE_DIFFERENCES).sort(), [
    '<productName>.exe',
    'resources/engine/dictation-helper.exe',
    'resources/engine/dictation-helper.manifest.json'
  ])
})

test('round 8: the installer end-to-end job and its kill-step include stay test-only', () => {
  const ci = ciWorkflow.replace(/\r\n/g, '\n')
  const job = ci.slice(ci.indexOf('  windows-installer-e2e:'))
  assert.ok(ci.indexOf('  windows-installer-e2e:') > 0)
  assert.match(job, /^ {4}runs-on: windows-latest\n {4}timeout-minutes: 45\n/m)
  assert.match(job, /node apps\/desktop\/scripts\/package-win-qa\.cjs\n/)
  assert.match(job, /-c\.nsis\.include=build\/windows-installer-test-steps\.nsh/)
  assert.match(job, /test-windows-installer-e2e\.cjs --legacy/)
  assert.doesNotMatch(job, /secrets\.|DOODLENOTE_WINDOWS_UPDATES|ARTIFACT_SIGNING/)
  // No release build includes the kill-step file; the installer itself has no test hook.
  const qaConfig = readFileSync(new URL('../../electron-builder.qa.cjs', import.meta.url), 'utf8')
  for (const text of [
    builderConfig,
    qaConfig,
    desktopPackage,
    publishScript,
    windowsBetaPublishScript
  ])
    assert.doesNotMatch(text, /windows-installer-test-steps/)
  const steps = readFileSync(
    new URL('../../build/windows-installer-test-steps.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
  assert.match(
    steps,
    /^!ifndef BUILD_UNINSTALLER\n {2}!define DN_TEST_STEPS\n!endif\n!include "\$\{__FILEDIR__\}\\windows-installer\.nsh"\n/m
  )
  // The kill point: electron-builder's last hook before customInstall (right after the
  // stock "uninstall old version", the file copy and the uninstall entry), unused by
  // this app otherwise; the stop name is read only there.
  assert.match(
    steps,
    /!macro registerFileAssociations\n\s+ReadEnvStr \$dnTestStopAt DN_TEST_STOP_AT\n\s+!insertmacro dnTestStep "after-stock-uninstall"\n!macroend/
  )
  assert.doesNotMatch(builderConfig + qaConfig, /fileAssociations/)
  const require = createRequire(import.meta.url)
  const builder = join(require.resolve('electron-builder/package.json'), '..')
  const lib = join(require.resolve('app-builder-lib/package.json', { paths: [builder] }), '..')
  const installSection = readFileSync(
    join(lib, 'templates', 'nsis', 'installSection.nsh'),
    'utf8'
  ).replace(/\r\n/g, '\n')
  const order = [
    '!insertmacro uninstallOldVersion SHELL_CONTEXT',
    '!insertmacro installApplicationFiles',
    '!insertmacro registryAddInstallInfo',
    '!insertmacro registerFileAssociations',
    '!insertmacro customInstall'
  ].map((line) => installSection.indexOf(line))
  assert.ok(
    order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])),
    String(order)
  )
  const e2e = readFileSync(
    new URL('../../scripts/test-windows-installer-e2e.cjs', import.meta.url),
    'utf8'
  )
  assert.match(
    e2e,
    /if \(!process\.env\.CI && process\.env\.DOODLENOTE_E2E_THROWAWAY_MACHINE !== '1'\)/
  )
})
