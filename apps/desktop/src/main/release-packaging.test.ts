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
  )
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
  ).replace(/\r\n/g, '\n')
  const install = installer.slice(installer.indexOf('!macro customInstall'))
  assert.equal(installer.match(/Call dnRemoveLegacyDir/g), null)
  assert.equal(installer.match(/Call dnFinishMigration/g)?.length, 1)
  assert.ok(
    install.indexOf('FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"') <
      install.indexOf('Call dnFinishMigration')
  )
  const finish = guards.slice(guards.indexOf('Function dnFinishMigration'))
  assert.equal(guards.match(/^\s+Call dnRemoveLegacyDir$/gm)?.length, 1)
  assert.ok(finish.indexOf('Call dnCheckLegacyDir') < finish.indexOf('Call dnRemoveLegacyDir'))
  // The record the app needs before it repoints anything is written only after a real move.
  const removed = finish.indexOf('${if} $3 == "removed"')
  for (const value of ['MigratedFrom', 'MigratedTo', 'MigratedAt']) {
    assert.equal(`${installer}\n${guards}`.split(`$dnStateKey "${value}"`).length, 2, value)
    assert.ok(finish.indexOf(`WriteRegStr HKCU $dnStateKey "${value}"`) > removed, value)
  }
  assert.ok(removed > finish.indexOf('Call dnRemoveLegacyDir'))
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
  for (const value of ['Identity', 'SourceDir', 'DestDir', 'LegacyUninstallString']) {
    assert.match(installer, new RegExp(`WriteRegStr HKCU "\\$\\{DN_MIGRATION_KEY\\}" "${value}"`))
  }
  const init = installer.slice(
    installer.indexOf('!macro customInit'),
    installer.indexOf('!macroend', installer.indexOf('!macro customInit'))
  )
  // Identity, destination and source are all checked (dnTrustedJournal) before
  // anything recorded is used.
  const restore = init.indexOf('WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"')
  assert.ok(restore > 0)
  for (const check of ['Call dnTrustedJournal', '${if} $R6 != ""', '${if} $R7 == $R9']) {
    const at = init.indexOf(check)
    assert.ok(at > 0 && at < restore, check)
  }
  const guards = readFileSync(
    new URL('../../build/windows-install-guards.nsh', import.meta.url),
    'utf8'
  ).replace(/\r\n/g, '\n')
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
  // Only the old folder's own uninstaller, reconstructed, is ever put back or parked.
  assert.match(installer, /StrCpy \$\{OUT\} '"\$\{DIR\}\\\$\{UNINSTALL_FILENAME\}" \/currentuser'/)
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
  ).replace(/\r\n/g, '\n')
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
  const remove = guards.slice(guards.indexOf('Function dnRemoveLegacyDir'))
  assert.ok(remove.indexOf('Call dnRemoveTree') < remove.indexOf('Delete "$0\\${DN_APP_EXE}"'))
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
  // Nothing is closed without consent: silent installs nobody asked for never close.
  assert.match(guards, /\$\{elseif\} \$\{Silent\}\n\s+StrCpy \$\{OUT\} "never"/)
  assert.match(
    ciWorkflow.replace(/\r\n/g, '\n'),
    /node apps\/desktop\/scripts\/test-windows-installer-guards\.cjs/
  )
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
