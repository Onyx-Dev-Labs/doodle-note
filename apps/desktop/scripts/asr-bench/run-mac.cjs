#!/usr/bin/env node
// Mac counterpart of run-windows.ts: scores the Swift engine CLI on the same
// prepared fixtures with the same normalization (scoring.cjs).
//
//   node scripts/asr-bench/run-mac.cjs --engine engine/.build/release/engine \
//     --fixtures <cache>/prepared --mode stream|transcribe [--model v2|v3] \
//     [--sets read,meeting] [--realtime] [--out results.jsonl]
//
// `stream` is the live path (Parakeet Unified, `engine stream --file`);
// `transcribe` is Imports/Re-transcribe (Parakeet TDT, `engine transcribe`).
// Each fixture runs in a fresh engine process under /usr/bin/time -l, so peak
// memory is the process maximum resident set size. Model load is excluded from
// RTF by timing from the engine's `ready` event. Prepare fixtures first with
// prepare-fixtures.py. Status: written for the owner to run; not yet run.
const { spawn } = require('node:child_process')
const { appendFileSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { NORMALIZATION, score, aggregate } = require('./scoring.cjs')

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : fallback
}
const engine = resolve(arg('engine', 'engine/.build/release/engine'))
const fixturesDir = resolve(arg('fixtures'))
const mode = arg('mode', 'stream')
const model = arg('model', 'v2')
const sets = arg('sets', 'read,meeting').split(',')
const realtime = process.argv.includes('--realtime')
const out = arg('out')
const limit = Number(arg('limit', '100000'))

function write(row) {
  const line = JSON.stringify(row)
  console.log(line)
  if (out) appendFileSync(out, line + '\n')
}

function runEngine(file) {
  const args =
    mode === 'stream'
      ? ['stream', '--file', file, ...(realtime ? ['--realtime'] : [])]
      : ['transcribe', '--file', file, '--model', model, '--timings']
  return new Promise((resolvePromise, reject) => {
    const started = process.hrtime.bigint()
    const ms = () => Number(process.hrtime.bigint() - started) / 1e6
    const child = spawn('/usr/bin/time', ['-l', engine, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    let stderr = ''
    const state = { readyAt: null, firstPartialAt: null, finalAt: null, text: '', final: null, partials: 0 }
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue // CoreML occasionally prints non-JSON noise on stdout
        }
        if (event.event === 'ready') state.readyAt ??= ms()
        if (event.event === 'partial' && event.text) {
          state.partials++
          state.firstPartialAt ??= ms()
        }
        if (event.event === 'final') {
          state.finalAt = ms()
          state.text = event.text ?? ''
          state.final = event
        }
        if (event.event === 'error') stderr += `\n${event.message}`
      }
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-20000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const rss = /(\d+)\s+maximum resident set size/.exec(stderr)
      if (code !== 0) return reject(new Error(`engine exited ${code}: ${stderr.slice(-800)}`))
      resolvePromise({ ...state, wallMs: ms(), peakRssMb: rss ? Math.round(Number(rss[1]) / 1048576) : null })
    })
  })
}

async function main() {
  const index = JSON.parse(readFileSync(join(fixturesDir, 'index.json'), 'utf8'))
  const fixtures = index.fixtures.filter((f) => sets.includes(f.set)).slice(0, limit)
  const rows = []
  for (const fixture of fixtures) {
    const result = await runEngine(join(fixturesDir, `${fixture.id}.wav`))
    const processingMs =
      mode === 'transcribe' && typeof result.final?.processingSeconds === 'number'
        ? result.final.processingSeconds * 1000
        : result.finalAt - (result.readyAt ?? 0)
    const row = {
      config: mode === 'stream' ? 'mac-stream:unified' : `mac-transcribe:tdt-${model}`,
      fixture: fixture.id,
      set: fixture.set,
      seconds: fixture.seconds,
      ...score(fixture.reference, result.text),
      rtf: processingMs / 1000 / fixture.seconds,
      processingMs: Math.round(processingMs),
      // Wall time from `ready` to the first non-empty partial (stream mode).
      firstPartialMs:
        result.firstPartialAt !== null && result.readyAt !== null
          ? Math.round(result.firstPartialAt - result.readyAt)
          : null,
      finalizeMs: typeof result.final?.finishMs === 'number' ? result.final.finishMs : null,
      peakRssMb: result.peakRssMb,
      partials: result.partials,
      hypothesis: fixture.set.startsWith('long') ? result.text.slice(0, 400) : result.text
    }
    rows.push(row)
    write(row)
  }
  const summary = {}
  for (const set of new Set(rows.map((r) => r.set))) {
    const subset = rows.filter((r) => r.set === set)
    const audio = subset.reduce((sum, r) => sum + r.seconds, 0)
    summary[set] = {
      ...aggregate(subset),
      audioSec: Math.round(audio * 10) / 10,
      rtf: subset.reduce((sum, r) => sum + r.processingMs, 0) / 1000 / audio,
      peakRssMb: Math.max(...subset.map((r) => r.peakRssMb ?? 0))
    }
  }
  write({ summary, mode, model, realtime, normalization: NORMALIZATION, engine })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
