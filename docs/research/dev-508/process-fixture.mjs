// Synthetic subprocess only: generated PCM/checksums, no native capture or recognition.
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { atomicJSON } from './capture-model.mjs'

const [mode, path, pauseAt] = process.argv.slice(2)
if (mode === 'asr') {
  process.on('message', message => {
    if (message.hang) return
    const bytes = readFileSync(message.record.path)
    process.send({ ...message, text: createHash('sha256').update(bytes).digest('hex').slice(0, 16) })
  })
  process.on('disconnect', () => process.exit(0))
  process.send({ ready: true })
} else if (mode === 'writer') {
  atomicJSON(path, { rows: { synthetic: { id: 'synthetic' } } }, stage => {
    if (stage === pauseAt) {
      // Marker written before an actual SIGKILL from the test parent; no voluntary exit.
      writeFileSync(`${path}.boundary`, stage)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    }
  })
} else if (mode === 'capture') {
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  function stop(reason) {
    clearInterval(timer)
    atomicJSON(path, { reason, ticks, stoppedAt: Date.now() })
    process.exit(0)
  }
  createInterface({ input: process.stdin }).on('line', line => {
    if (line === 'stop') stop('independent-stop')
  }).on('close', () => stop('host-eof'))
  process.send({ ready: true, pid: process.pid })
} else if (mode === 'host') {
  const child = fork(fileURLToPath(import.meta.url), ['capture', path], {
    stdio: ['pipe', 'ignore', 'ignore', 'ipc']
  })
  child.on('message', message => process.send(message))
  process.on('message', message => { if (message === 'stop') child.stdin.write('stop\n') })
  child.on('exit', () => process.exit(0))
}
