import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
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

test('the dev Mac build excludes the Windows-only Koffi DLL loader, like the release build', () => {
  const macFiles = (text: string): string[] => {
    const mac = /^mac:\n((?:[ \t].*\n|\n)*)/m.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? ''
    const files = /^ {2}files:\n((?: {4}.*\n)*)/m.exec(mac)?.[1] ?? ''
    return files
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).replace(/^(['"])(.*)\1$/, '$2'))
  }
  for (const config of [dev, prod]) {
    const patterns = macFiles(config)
    assert.ok(patterns.includes('out/**'), 'the mac files block was found')
    assert.ok(patterns.includes('!**/node_modules/sherpa-onnx-*/**'))
    assert.ok(patterns.includes('!**/node_modules/koffi/**'))
    assert.ok(patterns.includes('!**/node_modules/@koromix/**'))
  }
})

test('the packaging script never calls the release or publish scripts', () => {
  const script = live(read('scripts/package-dev.sh'))
  assert.doesNotMatch(script, /publish-release|publish-mac|publish-windows|stapler|notary/i)
  assert.match(script, /--publish never/)
  assert.match(script, /DOODLENOTE_CHANNEL=dev/)
  assert.match(script, /DOODLENOTE_DEV_IDENTITY/)
  assert.match(script, /Refusing a Developer ID certificate/)
  assert.doesNotMatch(script, /find-identity/, 'never auto-picks a certificate')
})

test('the channel is baked at build time, not read from the environment at runtime', () => {
  const vite = read('electron.vite.config.ts')
  assert.match(vite, /__DOODLENOTE_CHANNEL__/)
  const channel = read('src/shared/app-channel.ts')
  assert.doesNotMatch(channel, /process\.env/)
})
