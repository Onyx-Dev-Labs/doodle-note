import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineProcess } from './engine-process'
import type { EngineEvent } from '../shared/engine-events'

/**
 * Exercises the dispose/discard kill choreography against a scripted fake
 * engine binary. The engine's contract: on stdin close or SIGTERM it tears
 * its capture taps down and exits on its own — so a session caught in the
 * "finishing" stage must get a grace window before any signal, and SIGTERM
 * must always precede SIGKILL. Each fake appends what it observed to
 * `<script>.log`, which is what the assertions read.
 */

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/** Writes an executable fake engine; returns its path and its log path. */
function fakeEngine(body: string): { binary: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'engine-process-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const binary = join(dir, 'engine')
  const log = `${binary}.log`
  writeFileSync(
    binary,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs')",
      "const log = (m) => fs.appendFileSync(process.argv[1] + '.log', m + '\\n')",
      'const emit = (o) => console.log(JSON.stringify(o))',
      // Never linger past the test run.
      "setTimeout(() => { log('gave-up'); process.exit(3) }, 15000)",
      body
    ].join('\n')
  )
  chmodSync(binary, 0o755)
  return { binary, log }
}

function logLines(log: string): string[] {
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []
}

async function waitFor(cond: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function startLive(
  binary: string,
  finishingGraceMs: number
): {
  engine: EngineProcess
  events: EngineEvent[]
} {
  const engine = new EngineProcess(binary, finishingGraceMs)
  cleanups.push(() => engine.dispose())
  const events: EngineEvent[] = []
  engine.onEvent((event) => events.push(event))
  engine.start('live')
  return { engine, events }
}

const sawFinishing = (events: EngineEvent[]): boolean =>
  events.some((e) => e.event === 'status' && e.stage === 'finishing')

describe('EngineProcess dispose', { skip: process.platform === 'win32' }, () => {
  it('lets a finishing session exit cleanly without any signal', async () => {
    const { binary, log } = fakeEngine(
      [
        "emit({ event: 'ready', mode: 'live' })",
        "emit({ event: 'status', stage: 'finishing' })",
        "process.on('SIGTERM', () => { log('SIGTERM'); process.exit(7) })",
        // The clean path: host closes stdin, engine finishes and exits itself.
        "process.stdin.on('end', () => { log('clean-exit'); emit({ event: 'done' }); process.exit(0) })",
        'process.stdin.resume()'
      ].join('\n')
    )
    const { engine, events } = startLive(binary, 2_000)
    await waitFor(() => sawFinishing(events), 'finishing status')

    engine.dispose()
    await waitFor(() => logLines(log).includes('clean-exit'), 'clean exit')
    assert.ok(!logLines(log).includes('SIGTERM'), 'a finishing engine must not be signalled')
  })

  it('escalates to SIGTERM only after the grace window when finishing wedges', async () => {
    const graceMs = 500
    const { binary, log } = fakeEngine(
      [
        "emit({ event: 'ready', mode: 'live' })",
        "emit({ event: 'status', stage: 'finishing' })",
        "process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0) })",
        // Wedged: ignores stdin close, only a signal gets it out.
        'process.stdin.resume()'
      ].join('\n')
    )
    const { engine, events } = startLive(binary, graceMs)
    await waitFor(() => sawFinishing(events), 'finishing status')

    const disposedAt = Date.now()
    engine.dispose()
    await waitFor(() => logLines(log).includes('SIGTERM'), 'SIGTERM after grace')
    assert.ok(
      Date.now() - disposedAt >= graceMs - 10,
      'SIGTERM must not fire before the grace window elapses'
    )
  })

  it('signals immediately when no session is finishing', async () => {
    const { binary, log } = fakeEngine(
      [
        "emit({ event: 'ready', mode: 'live' })",
        "process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0) })",
        'process.stdin.resume()'
      ].join('\n')
    )
    // A huge grace proves the grace path is not taken while recording.
    const { engine, events } = startLive(binary, 60_000)
    await waitFor(() => events.some((e) => e.event === 'ready'), 'ready event')

    engine.dispose()
    await waitFor(() => logLines(log).includes('SIGTERM'), 'immediate SIGTERM', 2_000)
  })

  it('clears the finishing state once the session reports done', async () => {
    const { binary, log } = fakeEngine(
      [
        "emit({ event: 'ready', mode: 'live' })",
        "emit({ event: 'status', stage: 'finishing' })",
        "emit({ event: 'done' })",
        "process.on('SIGTERM', () => { log('SIGTERM'); process.exit(0) })",
        'process.stdin.resume()'
      ].join('\n')
    )
    const { engine, events } = startLive(binary, 60_000)
    await waitFor(() => events.some((e) => e.event === 'done'), 'done event')

    engine.dispose()
    await waitFor(() => logLines(log).includes('SIGTERM'), 'immediate SIGTERM', 2_000)
  })
})
