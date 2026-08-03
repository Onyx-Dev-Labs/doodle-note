import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  assert.match(brandScript, /sips -z 256 256 -s format ico/)
})

test('macOS builds a DMG for website installs while retaining the ZIP updater', () => {
  assert.match(builderConfig, /target:\s*zip[\s\S]*target:\s*dmg/)
  assert.match(
    builderConfig,
    /artifactName:\s*\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/
  )
  assert.match(builderConfig, /path:\s*\/Applications/)
  assert.match(publishScript, /name\.endsWith\('\.dmg'\)/)
  assert.match(publishScript, /flags\.includes\('--dmg-only'\)/)
})

test('Windows builds an x64 NSIS updater with the Windows icon and native engines', () => {
  assert.match(builderConfig, /win:\s+[\s\S]*target:\s*nsis[\s\S]*arch:\s+- x64/)
  assert.match(builderConfig, /win:\s+[\s\S]*icon:\s*resources\/icon\.ico/)
  assert.match(builderConfig, /asarUnpack:[\s\S]*sherpa-onnx-win-x64/)
  assert.match(builderConfig, /artifactName:\s*\$\{productName\}-\$\{version\}-setup\.\$\{ext\}/)
  assert.match(publishScript, /name === 'latest\.yml'/)
  assert.match(publishScript, /name\.endsWith\('\.exe\.blockmap'\)/)
})

test('CI builds and retains a real Windows installer', () => {
  assert.match(ciWorkflow, /windows-package:[\s\S]*runs-on:\s*windows-latest/)
  assert.match(ciWorkflow, /pnpm --filter desktop package:win/)
  assert.match(ciWorkflow, /Smoke packaged Windows native modules/)
  assert.match(ciWorkflow, /sherpa and llama native modules loaded successfully/)
  assert.match(ciWorkflow, /Get-AuthenticodeSignature/)
  assert.match(ciWorkflow, /actions\/upload-artifact@v4/)
  assert.match(desktopPackage, /release:win[\s\S]*verify-windows-signature\.ps1/)
})

test('Windows website betas cannot replace the production updater feed', () => {
  assert.match(desktopPackage, /publish:win-beta[\s\S]*publish-windows-beta\.mjs/)
  assert.match(windowsBetaPublishScript, /-beta-setup\.exe/)
  assert.match(windowsBetaPublishScript, /put\('updates\/latest-beta\.yml'/)
  assert.doesNotMatch(windowsBetaPublishScript, /put\('updates\/latest\.yml'/)
})

test('macOS-only settings are gated out of the Windows UI', () => {
  assert.match(
    modelsView,
    /detect\?\.platform === 'darwin'[\s\S]*Show upcoming meetings in menu bar/
  )
  assert.match(
    modelsView,
    /detect\?\.platform === 'darwin'[\s\S]*Capture without screen permission/
  )
})
