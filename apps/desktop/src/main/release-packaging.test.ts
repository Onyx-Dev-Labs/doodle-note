import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
