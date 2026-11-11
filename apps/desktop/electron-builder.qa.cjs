// QA identity overlay for electron-builder.yml: a Windows build that can be
// installed, upgraded and migrated in a real account without touching the
// production install, profile, login item, MCP client configs or migration
// journal (docs/WINDOWS-RELEASE-QA.md "Install folder"). Build it with
// `pnpm package:win:qa`, which also builds the app code with the QA identity
// (src/main/app-identity.ts); the packaged app refuses to start if the two differ.
//
// DOODLENOTE_QA_LEGACY_LAYOUT=1 builds the pre-migration layout instead (no
// nsis.include: installs to Programs\<packageName>, like builds before the
// folder rename), the starting point of the upgrade test.
// CommonJS: electron-builder loads this file with require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const identities = require('./src/shared/app-identities.json')

if (process.env.DOODLENOTE_QA_IDENTITY !== '1') {
  throw new Error('electron-builder.qa.cjs needs DOODLENOTE_QA_IDENTITY=1; use pnpm package:win:qa')
}
const qa = identities.qa
const legacyLayout = process.env.DOODLENOTE_QA_LEGACY_LAYOUT === '1'

module.exports = {
  extends: 'electron-builder.yml',
  appId: qa.appId,
  productName: qa.productName,
  // The packaged app name, so the profile is %APPDATA%\desktop-qa and the
  // one-click install folder (APP_FILENAME) is desktop-qa.
  extraMetadata: { name: qa.packageName },
  directories: { output: legacyLayout ? 'release-qa-legacy' : 'release-qa' },
  // No feed: no app-update.yml is written and nothing can be published.
  publish: null,
  nsis: { include: legacyLayout ? null : 'build/windows-installer.nsh' }
}
