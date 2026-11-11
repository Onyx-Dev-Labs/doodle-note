import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { QUIT_FINISH_RECORDING_TIMEOUT_MS, finishRecordingBeforeQuit } from './engine-quit'

/** A host shaped like WinEngineHost: stop() drains, then the session emits exit. */
function fakeEngine(running: boolean): {
  engine: Parameters<typeof finishRecordingBeforeQuit>[0]
  stops: number
  listeners: number
  exit(): void
} {
  const listeners = new Set<(event: { event: string }) => void>()
  const state = {
    running,
    stops: 0,
    engine: {
      get running() {
        return state.running
      },
      stop() {
        state.stops++
      },
      onEvent(listener: (event: { event: string }) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    get listeners() {
      return listeners.size
    },
    exit() {
      state.running = false
      for (const listener of [...listeners]) listener({ event: 'done' })
      for (const listener of [...listeners]) listener({ event: 'exit' })
    }
  }
  return state
}

function fakeTimers(): {
  timers: Parameters<typeof finishRecordingBeforeQuit>[2]
  fire(): void
  delays: number[]
  cleared: number
} {
  let pending: (() => void) | null = null
  const result = {
    delays: [] as number[],
    cleared: 0,
    timers: {
      setTimeout: (callback: () => void, ms: number) => {
        pending = callback
        result.delays.push(ms)
        return 1
      },
      clearTimeout: () => {
        result.cleared++
        pending = null
      }
    },
    fire: () => pending?.()
  }
  return result
}

test('quit with no recording does not stop or wait', async () => {
  const fake = fakeEngine(false)
  assert.equal(await finishRecordingBeforeQuit(fake.engine), 'idle')
  assert.equal(fake.stops, 0)
  assert.equal(fake.listeners, 0)
})

test('quit during a recording stops it and waits for the session to finish', async () => {
  const fake = fakeEngine(true)
  const clock = fakeTimers()
  let settled = false
  const result = finishRecordingBeforeQuit(fake.engine, 5_000, clock.timers).then((value) => {
    settled = true
    return value
  })
  await Promise.resolve()
  assert.equal(fake.stops, 1)
  assert.deepEqual(clock.delays, [5_000])
  assert.equal(settled, false, 'quit waits while the recording finishes')
  fake.exit()
  assert.equal(await result, 'finished')
  assert.equal(fake.listeners, 0)
  assert.equal(clock.cleared, 1)
})

test('a recording that cannot finish in time no longer blocks quit', async () => {
  const fake = fakeEngine(true)
  const clock = fakeTimers()
  const result = finishRecordingBeforeQuit(fake.engine, 5_000, clock.timers)
  clock.fire()
  assert.equal(await result, 'timeout')
  assert.equal(fake.listeners, 0)
  // A late exit after the deadline is ignored.
  fake.exit()
  assert.equal(QUIT_FINISH_RECORDING_TIMEOUT_MS, 30_000)
})

test('only Windows quits wait for the recording; macOS keeps its engine-owned shutdown', () => {
  const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const cleanup = /cleanup: async \(\) => \{([\s\S]*?)\n {6}\},/.exec(index)?.[1] ?? ''
  // macOS: the tray goes first and the engine owns the finishing wait, as before.
  assert.match(
    cleanup,
    /quitting = true\n\s+\/\/[^\n]*\n\s+if \(process\.platform !== 'win32'\) recordingTray\?\.dispose\(\)\n\s+calendarService\?\.dispose\(\)/
  )
  // Windows: keep the tray saying "Saving recording…" until the bounded wait ends.
  assert.match(
    cleanup,
    /if \(process\.platform === 'win32'\) \{\n\s+if \(engine\.running\) recordingTray\?\.showSavingBeforeQuit\(\)\n\s+await finishRecordingBeforeQuit\(\n\s+engine,\n\s+sessionEnding \? SESSION_END_FINISH_TIMEOUT_MS : undefined\n\s+\)\n\s+recordingTray\?\.dispose\(\)\n\s+\}\n\s+const results = await Promise\.allSettled\(\[engine\.dispose\(\), micWatcher\.dispose\(\)\]\)/
  )
  assert.equal(cleanup.match(/finishRecordingBeforeQuit/g)?.length, 1)
  // The tray's Quit item runs app.quit(), which reaches this before-quit cleanup:
  // macOS menu, Windows menu and the Windows "finishing notes" menu.
  const tray = readFileSync(new URL('./recording-tray.ts', import.meta.url), 'utf8')
  assert.equal(
    // The label names the build identity (DoodleNote, or DoodleNote QA).
    tray.match(/\{ label: `Quit \$\{APP_NAME\}`, click: \(\) => app\.quit\(\) \}/g)?.length,
    3
  )
})
