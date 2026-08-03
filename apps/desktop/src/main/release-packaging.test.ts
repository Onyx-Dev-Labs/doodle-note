import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const builderConfig = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8')

test('macOS packages the corrected icon under a cache-busting resource name', () => {
  assert.match(builderConfig, /from:\s*resources\/icon\.icns\s+to:\s*doodlenote-full-bleed\.icns/)
  assert.match(builderConfig, /CFBundleIconFile:\s*doodlenote-full-bleed\.icns/)
})
