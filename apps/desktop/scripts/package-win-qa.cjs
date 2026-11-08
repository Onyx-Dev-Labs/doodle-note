// Builds the QA identity Windows package (electron-builder.qa.cjs). Unsigned and
// unpublished: signing credentials are dropped from the environment.
//
//   node scripts/package-win-qa.cjs [--legacy-layout] [--dir]
//
// --legacy-layout builds the pre-migration layout (Programs\desktop-qa) to start
// the upgrade test from; --dir stops at release-qa*\win-unpacked (no installer).
const { execFileSync, execSync } = require('node:child_process')
const path = require('node:path')

const desktop = path.resolve(__dirname, '..')
const legacyLayout = process.argv.includes('--legacy-layout')
const env = { ...process.env, DOODLENOTE_QA_IDENTITY: '1' }
// apps/desktop has no lock file or packageManager field of its own, so electron-builder
// picks its node_modules collector from the environment. Started with plain `node` (not
// through pnpm) it fell back to npm's, which misses pnpm's platform packages: the QA
// package then shipped without sherpa-onnx-win-x64, Koffi's and reflink's Windows
// binaries. Use the same collector as package:win.
if (!(env.npm_config_user_agent ?? '').includes('pnpm')) env.npm_config_user_agent = 'pnpm'
if (legacyLayout) env.DOODLENOTE_QA_LEGACY_LAYOUT = '1'
else delete env.DOODLENOTE_QA_LEGACY_LAYOUT
delete env.DOODLENOTE_WINDOWS_UPDATES
for (const name of [
  ...require('./sign-windows.cjs').SIGNING_ENV_VARS,
  'CSC_LINK',
  'WIN_CSC_LINK',
  'CSC_KEY_PASSWORD',
  'WIN_CSC_KEY_PASSWORD'
]) {
  delete env[name]
}

const run = (file, args) => execFileSync(file, args, { cwd: desktop, env, stdio: 'inherit' })

execSync('pnpm --filter doodle-note-mcp build', { cwd: desktop, env, stdio: 'inherit' })
run(process.execPath, [path.join(desktop, 'scripts', 'build-dictation-helper-win.cjs')])
// The unsigned helper's integrity expectation, baked in by electron-vite (same order as package:win).
run(process.execPath, [path.join(desktop, 'scripts', 'write-dictation-helper-manifest.cjs')])
const bin = (...parts) => path.join(desktop, 'node_modules', ...parts)
run(process.execPath, [bin('electron-vite', 'bin', 'electron-vite.js'), 'build'])
run(process.execPath, [
  bin('electron-builder', 'cli.js'),
  '--win',
  ...(process.argv.includes('--dir') ? ['dir'] : []),
  '--x64',
  '--config',
  'electron-builder.qa.cjs',
  '--publish',
  'never'
])
