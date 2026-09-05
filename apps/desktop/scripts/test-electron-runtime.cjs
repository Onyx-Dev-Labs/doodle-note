// Run filesystem regressions with the runtime users receive. Host Node and
// Electron do not always have identical Windows file deletion behavior.
const { spawnSync } = require('node:child_process')
const { resolve } = require('node:path')
const executable = process.argv[2] ? resolve(process.argv[2]) : require('electron')
const result = spawnSync(
  executable,
  ['--import', 'tsx', '--test', 'src/main/win-audio-recorder.test.ts'],
  {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000
  }
)
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) console.error(result.error.message)
if (result.status !== 0 || result.error) process.exit(1)
console.log('Electron recorder regression checks passed')
