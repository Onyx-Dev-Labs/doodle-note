import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const desktop = resolve(__dirname, '..', '..')
const read = (file: string): string => readFileSync(resolve(desktop, file), 'utf8')
const dev = read('electron-builder.dev.yml')
const prod = read('electron-builder.yml')
const live = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

test('the dev build has its own bundle id, name and output folder', () => {
  const config = live(dev)
  assert.match(config, /^appId: com\.doodlenote\.desktop\.dev$/m)
  assert.match(config, /^productName: DoodleNote Dev$/m)
  assert.match(config, /^\s+output: release-dev$/m)
  assert.match(prod, /^appId: com\.doodlenote\.desktop$/m)
  assert.doesNotMatch(config, /^appId: com\.doodlenote\.desktop$/m)
})

test('the dev build has no update feed, publish target, notarization or distribution identity', () => {
  const config = live(dev)
  assert.doesNotMatch(config, /^publish:/m)
  assert.doesNotMatch(config, /doodlenote\.ai/)
  assert.doesNotMatch(config, /notarize: true/)
  assert.match(config, /notarize: false/)
  assert.doesNotMatch(config, /SEAN INMAN|Developer ID/i)
  assert.match(config, /target: dir/)
  assert.doesNotMatch(config, /target: (zip|dmg)/)
})

test('the dev build ships the engine and the dictation helper', () => {
  const config = live(dev)
  assert.match(config, /engine\/\.build\/release\/dictation-helper/)
  assert.match(config, /to: engine\/dictation-helper/)
  assert.match(config, /engine\/\.build\/release\/engine/)
})

test('the packaging script never calls the release or publish scripts', () => {
  const script = live(read('scripts/package-dev.sh'))
  assert.doesNotMatch(script, /publish-release|publish-mac|publish-windows|stapler|notary/i)
  assert.match(script, /--publish never/)
  assert.match(script, /DOODLENOTE_CHANNEL=dev/)
  assert.match(script, /DOODLENOTE_DEV_IDENTITY/)
  assert.doesNotMatch(script, /find-identity/, 'never auto-picks a certificate')
})

test('dev packaging refuses distribution and unrecognized signing identities before building', () => {
  for (const identity of [
    'Developer ID Application: Example',
    'Apple Distribution: Example',
    'Unknown'
  ]) {
    const result = spawnSync('bash', [resolve(desktop, 'scripts/package-dev.sh')], {
      env: { ...process.env, DOODLENOTE_DEV_IDENTITY: identity },
      encoding: 'utf8'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Use an Apple Development certificate/)
    assert.equal(result.stdout, '', 'rejected before starting the build')
  }
})

test('the channel is baked at build time, not read from the environment at runtime', () => {
  const vite = read('electron.vite.config.ts')
  assert.match(vite, /__DOODLENOTE_CHANNEL__/)
  const channel = read('src/shared/app-channel.ts')
  assert.doesNotMatch(channel, /process\.env/)
})
