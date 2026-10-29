// Static F1 harness: argv carries test data without JavaScript construction.
const fs = require('node:fs')
const { performance } = require('node:perf_hooks')
const { runStapler } = require('../stapler.cjs')
const [mode, pidFile, diagnosticsDir, executable, resultFile] = process.argv.slice(2)
const start = performance.now()
let cancellation
if (mode === 'cancelled') {
  cancellation = setInterval(() => {
    if (fs.existsSync(pidFile)) {
      clearInterval(cancellation)
      process.kill(process.pid, 'SIGTERM')
    }
  }, 5)
}
runStapler(
  { action: 'validate', role: 'dmg', artifact: '/same.dmg', diagnosticsDir },
  {
    executable,
    timeoutMs: ['timeout', 'timeout-before-total'].includes(mode) ? 800 : 5000,
    totalMs: mode === 'total-timeout' ? 800 : mode === 'timeout-before-total' ? 850 : 6000,
    cleanupMs: 150,
    delaysMs: [1, 1],
    log() {}
  }
).then((result) => {
  clearInterval(cancellation)
  fs.writeFileSync(resultFile, JSON.stringify({ result, elapsedMs: performance.now() - start }))
})
