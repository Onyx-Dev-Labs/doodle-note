import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const builderConfig = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')
const publishScript = readFileSync(
  new URL('../../scripts/publish-release.mjs', import.meta.url),
  'utf8'
)
const brandScript = readFileSync(
  new URL('../../scripts/build-brand-assets.sh', import.meta.url),
  'utf8'
)

function pngMetadata(url: URL): { width: number; height: number; colorType: number } {
  const png = readFileSync(url)
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
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
    new URL(
      '../../../ios/DoodleNote/Assets.xcassets/Mascot.imageset/mascot.png',
      import.meta.url
    ),
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
