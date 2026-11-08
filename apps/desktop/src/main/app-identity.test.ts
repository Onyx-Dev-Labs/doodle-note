import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import identities from '../shared/app-identities.json'
import { APP_IDENTITY, appIdentity, identityMismatch } from './app-identity'
import { BARK_HELPER_IDENTITY, barkHelperIdentity } from './dictation-helper-client'
import { MCP_SERVER_KEY } from './mcp-clients-logic'
import { installStateKey } from './windows-install-record'
import {
  INSTALL_FOLDER,
  LEGACY_INSTALL_FOLDER,
  legacyInstallFor
} from './windows-install-migration'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (relative: string): string =>
  readFileSync(join(desktop, relative), 'utf8').replace(/\r\n/g, '\n')
const require = createRequire(import.meta.url)

/** The electron-builder QA overlay, loaded the way electron-builder loads it. */
function qaOverlay(legacyLayout = false): Record<string, unknown> {
  const file = join(desktop, 'electron-builder.qa.cjs')
  const saved = { ...process.env }
  process.env.DOODLENOTE_QA_IDENTITY = '1'
  if (legacyLayout) process.env.DOODLENOTE_QA_LEGACY_LAYOUT = '1'
  else delete process.env.DOODLENOTE_QA_LEGACY_LAYOUT
  try {
    delete require.cache[require.resolve(file)]
    return require(file) as Record<string, unknown>
  } finally {
    process.env = saved
  }
}

/** electron-builder's APP_GUID for an appId (the uninstall key and migration journal). */
function nsisGuid(appId: string): string {
  const builder = dirname(require.resolve('electron-builder/package.json', { paths: [desktop] }))
  const runtime = require(require.resolve('builder-util-runtime', { paths: [builder] })) as {
    UUID: { v5(name: string, namespace: unknown): string; parse(uuid: string): unknown }
  }
  // NsisTarget's ELECTRON_BUILDER_NS_UUID.
  return runtime.UUID.v5(appId, runtime.UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'))
}

test('tests and production builds run as the production identity', () => {
  assert.equal(APP_IDENTITY.name, 'production')
  assert.deepEqual(APP_IDENTITY, appIdentity('production'))
})

test('the production identity is exactly what electron-builder.yml and package.json ship', () => {
  const production = appIdentity('production')
  const config = read('electron-builder.yml')
  const lines = config.split('\n')
  assert.ok(lines.includes(`appId: ${production.appId}`))
  assert.ok(lines.includes(`productName: ${production.productName}`))
  assert.equal(JSON.parse(read('package.json')).name, production.packageName)
  // Unchanged from before the identity existed: the shipped uninstall key, login
  // item, MCP entry and folders must not move.
  assert.equal(production.appId, 'com.doodlenote.desktop')
  assert.equal(production.mcpServerKey, 'doodle-note')
  assert.equal(production.installFolder, 'DoodleNote')
  assert.equal(production.legacyInstallFolder, 'desktop')
  assert.equal(production.isolatesAgentAccess, false)
  assert.equal(production.updatesAllowed, true)
})

test('every identity-bearing name derives from the one identity entry', () => {
  for (const name of Object.keys(identities) as (keyof typeof identities)[]) {
    const identity = appIdentity(name)
    const entry = identities[name]
    assert.equal(identity.appId, entry.appId)
    assert.equal(identity.productName, entry.productName)
    assert.equal(identity.packageName, entry.packageName)
    assert.equal(identity.mcpServerKey, entry.mcpServerKey)
    // Electron reads the Run value named after the AppUserModelID; writing it
    // under the same name keeps "Open at login" readable.
    assert.equal(identity.appUserModelId, entry.appId)
    assert.equal(identity.loginItemName, identity.appUserModelId)
    // electron-builder: PRODUCT_FILENAME and APP_FILENAME (sanitized package name).
    assert.equal(identity.installFolder, entry.productName)
    assert.equal(identity.legacyInstallFolder, entry.packageName)
  }
  // The modules that use them read the build's identity, not literals.
  assert.equal(MCP_SERVER_KEY, APP_IDENTITY.mcpServerKey)
  assert.equal(INSTALL_FOLDER, APP_IDENTITY.installFolder)
  assert.equal(LEGACY_INSTALL_FOLDER, APP_IDENTITY.legacyInstallFolder)
})

test('the QA identity shares no identity-bearing name with production', () => {
  const production = appIdentity('production')
  const qa = appIdentity('qa')
  for (const key of [
    'appId',
    'productName',
    'packageName',
    'appUserModelId',
    'loginItemName',
    'installFolder',
    'legacyInstallFolder',
    'mcpServerKey'
  ] as const) {
    assert.notEqual(qa[key], production[key], key)
  }
  assert.equal(qa.isolatesAgentAccess, true)
  assert.equal(qa.updatesAllowed, false)
  // The NSIS uninstall key and the migration journal both hang off APP_GUID
  // (production's, as compiled by electron-builder on Dev04).
  assert.equal(nsisGuid(production.appId), 'f85f8dcf-6782-5a3e-a989-3eae169d6efb')
  assert.notEqual(nsisGuid(qa.appId), nsisGuid(production.appId))
  assert.match(read('build/windows-installer.nsh'), /"Software\\\$\{APP_GUID\}"/)
  assert.match(read('build/windows-installer.nsh'), /"\$\{DN_STATE_KEY\}\\InstallMigration"/)
  // A QA exe migrates its own folders, and only on its own installer's record.
  const programs = 'C:\\Users\\Pat\\AppData\\Local\\Programs'
  const record = {
    from: `${programs}\\desktop-qa`,
    to: `${programs}\\DoodleNote QA`,
    at: '2026-11-08T00:00:00Z'
  }
  assert.deepEqual(legacyInstallFor(record, `${programs}\\DoodleNote QA\\DoodleNote QA.exe`, qa), {
    dir: `${programs}\\desktop-qa`,
    exe: `${programs}\\desktop-qa\\DoodleNote QA.exe`
  })
  assert.ok(
    'reason' in
      legacyInstallFor(record, `${programs}\\DoodleNote QA\\DoodleNote QA.exe`, production)
  )
  assert.ok('reason' in legacyInstallFor(record, `${programs}\\DoodleNote\\DoodleNote.exe`, qa))
  // Each identity reads its own record key.
  assert.equal(installStateKey(qa.appId), `HKEY_CURRENT_USER\\Software\\${nsisGuid(qa.appId)}`)
})

test('the electron-builder QA overlay takes its names from the QA identity entry', () => {
  const qa = appIdentity('qa')
  const overlay = qaOverlay()
  assert.equal(overlay.extends, 'electron-builder.yml')
  assert.equal(overlay.appId, qa.appId)
  assert.equal(overlay.productName, qa.productName)
  assert.deepEqual(overlay.extraMetadata, { name: qa.packageName })
  // No feed, its own output folder, and the migration include (the legacy layout has none).
  assert.equal(overlay.publish, null)
  assert.deepEqual(overlay.directories, { output: 'release-qa' })
  assert.deepEqual(overlay.nsis, { include: 'build/windows-installer.nsh' })
  const legacy = qaOverlay(true)
  assert.deepEqual(legacy.nsis, { include: null })
  assert.deepEqual(legacy.directories, { output: 'release-qa-legacy' })
  // It refuses to build without the QA app code switch.
  const saved = process.env.DOODLENOTE_QA_IDENTITY
  delete process.env.DOODLENOTE_QA_IDENTITY
  try {
    const file = join(desktop, 'electron-builder.qa.cjs')
    delete require.cache[require.resolve(file)]
    assert.throws(() => require(file), /DOODLENOTE_QA_IDENTITY=1/)
  } finally {
    if (saved !== undefined) process.env.DOODLENOTE_QA_IDENTITY = saved
  }
  const vite = read('electron.vite.config.ts')
  assert.match(
    vite,
    /__DOODLENOTE_IDENTITY__: JSON\.stringify\(\s*process\.env\.DOODLENOTE_QA_IDENTITY === '1' \? 'qa' : 'production'\s*\)/
  )
  assert.match(read('scripts/package-win-qa.cjs'), /DOODLENOTE_QA_IDENTITY: '1'/)
  assert.match(read('scripts/package-win-qa.cjs'), /'--config',\s+'electron-builder\.qa\.cjs'/)
  assert.equal(
    JSON.parse(read('package.json')).scripts['package:win:qa'],
    'node scripts/package-win-qa.cjs'
  )
})

test('the app uses the identity for its AUMID, login item, agent access and updates', () => {
  const index = read('src/main/index.ts')
  assert.match(index, /electronApp\.setAppUserModelId\(APP_IDENTITY\.appUserModelId\)/)
  // Every login item write names the identity's Run value.
  const writes = index.match(/app\.setLoginItemSettings\(\{[^}]*\}\)/g) ?? []
  assert.ok(writes.length >= 2)
  for (const write of writes) assert.match(write, /name: APP_IDENTITY\.loginItemName/)
  assert.match(
    index,
    /APP_CHANNEL === 'dev' \|\| APP_IDENTITY\.isolatesAgentAccess\s+\? \{\s+home: join\(app\.getPath\('userData'\), 'agent-access-home'\),\s+identity: APP_CHANNEL === 'dev' \? 'dev' : APP_IDENTITY\.name\s+\}/
  )
  // The client roots and the opt-in file come only from agentAccessRoots.
  assert.match(index, /new AgentAccessService\(\s+\(\) => join\(libraryRoot\(\), 'meetings'\),\s+resolveMcpServerSpec\(\),\s+(?:\/\/[^\n]*\n\s+)*agentAccessRoots\(/)
  assert.doesNotMatch(read('src/main/agent-access-service.ts'), /process\.env\.APPDATA|process\.env\.DOODLE_NOTE_MCP_CONFIG/)
  assert.match(index, /enabled: profile\.updatesEnabled && APP_IDENTITY\.updatesAllowed/)
  assert.match(index, /identityMismatch\(app\.getName\(\)\)/)
  // No identity literal is left in the main process besides the identity file.
  const main = join(desktop, 'src', 'main')
  for (const file of readdirSync(main)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    let source = readFileSync(join(main, file), 'utf8')
    // win/bark's client default; a QA build overrides it (tested below).
    if (file === 'dictation-helper-client.ts')
      source = source.replace("export const BARK_HELPER_IDENTITY = 'com.doodlenote.desktop'", '')
    assert.doesNotMatch(source, /'com\.doodlenote\.desktop'/, file)
    assert.doesNotMatch(source, /'doodle-note'/, file)
  }
})

test('a package whose name does not match the code identity is refused', () => {
  assert.equal(identityMismatch('desktop'), null)
  assert.match(
    identityMismatch('desktop-qa') ?? '',
    /production identity .* packaged as desktop-qa/
  )
  assert.equal(identityMismatch('desktop-qa', appIdentity('qa')), null)
  assert.match(identityMismatch('desktop', appIdentity('qa')) ?? '', /qa identity/)
})

test("Bark's Windows helper names its state after the build identity", () => {
  // win/bark: DICTATION_HELPER_IDENTITY from barkHelperIdentity(channel, override)
  // (mute-recovery mutex and file); index.ts passes the QA identity as the override.
  const host = read('src/main/dictation-host.ts')
  assert.match(host, /identity: barkHelperIdentity\(options\.channel, options\.helperIdentity\)/)
  const index = read('src/main/index.ts')
  assert.match(
    index,
    /helperIdentity: APP_IDENTITY\.name === 'production' \? null : APP_IDENTITY\.appId,/
  )
  // Production keeps the client's default (the production identity); QA its own.
  assert.equal(BARK_HELPER_IDENTITY, appIdentity('production').appId)
  assert.equal(barkHelperIdentity('release', null), appIdentity('production').appId)
  assert.equal(barkHelperIdentity('release', appIdentity('qa').appId), appIdentity('qa').appId)
  assert.notEqual(appIdentity('qa').appId, BARK_HELPER_IDENTITY)
})
