/** Host seam: no Electron or native addon imports are needed to test ordering. */
export function createBeforeQuitHandler(host: {
  acquire(): (() => void) | null
  cleanup(): void | Promise<void>
  isUpdate(): boolean
  quit(): void
  hardExit(): void
  failed(error: unknown): void
}): (event: { preventDefault(): void }) => void {
  let cleanup: Promise<void> | undefined
  let complete = false
  return (event) => {
    if (complete) return // the resumed updater quit must flow through Electron
    event.preventDefault()
    if (cleanup) return
    const release = host.acquire()
    if (!release) return
    cleanup = Promise.resolve().then(() => host.cleanup())
    void cleanup.then(
      () => {
        complete = true
        if (host.isUpdate()) host.quit()
        else host.hardExit()
      },
      (error: unknown) => {
        // Keep the host alive, but allow a new attempt after failure. Retain
        // the reservation on success through the reentrant updater quit.
        release()
        cleanup = undefined
        host.failed(error)
      }
    )
  }
}

/** Upper bound for finishing a Windows recording during quit (normally a few seconds). */
export const QUIT_FINISH_RECORDING_TIMEOUT_MS = 30_000

/**
 * Windows quit stops an active recording the way the macOS engine does on
 * quit: request a normal Stop, then wait (bounded) for the session to finish
 * so its transcript and audio are saved, before the engine is disposed.
 * Without a running session this resolves at once. On timeout the caller
 * disposes as before, which leaves audio checkpoints for next-launch recovery.
 */
export function finishRecordingBeforeQuit(
  engine: {
    readonly running: boolean
    stop(): void
    onEvent(listener: (event: { event: string }) => void): () => void
  },
  timeoutMs = QUIT_FINISH_RECORDING_TIMEOUT_MS,
  timers: {
    setTimeout(callback: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
  } = {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): Promise<'idle' | 'finished' | 'timeout'> {
  if (!engine.running) return Promise.resolve('idle')
  return new Promise((resolve) => {
    let settled = false
    let off: () => void = () => {}
    const settle = (result: 'finished' | 'timeout'): void => {
      if (settled) return
      settled = true
      timers.clearTimeout(timer)
      off()
      resolve(result)
    }
    off = engine.onEvent((event) => {
      if (event.event === 'exit') settle('finished')
    })
    const timer = timers.setTimeout(() => settle('timeout'), timeoutMs)
    engine.stop()
    // A session that ended synchronously inside stop() emitted before we looked.
    if (!engine.running) settle('finished')
  })
}
