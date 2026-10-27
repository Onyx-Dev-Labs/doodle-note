// Static subprocess fixture. Test payloads and paths are JSON data, never source.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

if (process.argv[2] === '--idle') {
  setInterval(() => {}, 1000)
} else {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'))
  if (config.kind === 'responses') {
    const n = fs.existsSync(config.calls)
      ? fs.readFileSync(config.calls, 'utf8').trim().split('\n').length
      : 0
    fs.appendFileSync(config.calls, JSON.stringify(process.argv.slice(2)) + '\n')
    const response = config.responses[n] || { code: 99 }
    process.stdout.write(response.output || '', () => process.exit(response.code))
  } else if (config.kind === 'same-group') {
    const child = spawn(process.execPath, [__filename, '--idle'], { stdio: 'inherit' })
    fs.writeFileSync(config.pidFile, String(child.pid))
    process.stdout.write(config.output)
    if (config.mode === 'signal') setTimeout(() => process.kill(process.pid, 'SIGTERM'), 30)
    else setInterval(() => {}, 1000)
  } else if (config.kind === 'escaped') {
    fs.appendFileSync(config.calls, JSON.stringify(process.argv.slice(2)) + '\n')
    const escaped = spawn(process.execPath, [__filename, '--idle'], {
      detached: true,
      stdio: ['ignore', process.stdout, process.stderr]
    })
    fs.writeFileSync(config.pidFile, String(escaped.pid))
    escaped.unref()
    if (config.mode === 'transient-exit') {
      process.stdout.write(config.output, () => process.exit(68))
    } else if (config.mode === 'exit-zero') {
      process.exit(0)
    } else {
      setInterval(() => {}, 1000)
    }
  } else {
    throw new Error('Unknown subprocess fixture kind')
  }
}
