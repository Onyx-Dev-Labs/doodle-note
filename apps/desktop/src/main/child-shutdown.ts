import type { ChildProcess } from 'node:child_process'

/** Exact-child termination shared only by the recorder and microphone monitor. */
export class ChildShutdown {
  private readonly owned = new Map<ChildProcess, { exited: Promise<void>; done: boolean }>()
  private readonly terminating = new WeakMap<ChildProcess, Promise<void>>()
  private readonly termSent = new WeakSet<ChildProcess>()

  constructor(
    private readonly terminationGraceMs: number,
    private readonly exitObservationMs: number
  ) {}

  get children(): IterableIterator<ChildProcess> {
    return this.owned.keys()
  }

  markTermSent(child: ChildProcess): void {
    this.termSent.add(child)
  }

  /** Own each exact handle before exposing events that could trigger shutdown. */
  own(child: ChildProcess): void {
    let resolveExit!: () => void
    const state = {
      exited: new Promise<void>((resolve) => {
        resolveExit = resolve
      }),
      done: false
    }
    this.owned.set(child, state)
    const exited = (): void => {
      state.done = true
      this.owned.delete(child)
      resolveExit()
    }
    let observedExit = false
    child.once('exit', () => {
      observedExit = true
    })
    child.once('close', () => {
      // Drain final stdout before resolving. Failed spawns have no OS process
      // and emit close without exit; a signal request alone never gets here.
      if (observedExit || !child.pid) exited()
    })
    // Broken stdin is an unsuccessful graceful request, never proof of exit.
    child.stdin?.on('error', (error) => console.error('[engine stdin]', error.message))
  }

  /** Resolves only on observed exit (or a spawn failure with no process). */
  terminate(child: ChildProcess, graceMs = 0): Promise<void> {
    const state = this.owned.get(child)
    if (!state) return Promise.resolve() // already observed, including after a failed attempt
    const existing = this.terminating.get(child)
    if (existing) return existing
    const wait = async (ms: number): Promise<boolean> => {
      if (state.done) return true
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          state.exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, ms)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
      return state.done
    }
    const signalErrors: string[] = []
    const signal = (name: NodeJS.Signals): void => {
      if (state.done || (name === 'SIGTERM' && this.termSent.has(child))) return
      try {
        if (!child.kill(name)) throw new Error('signal not delivered')
        if (name === 'SIGTERM') this.termSent.add(child)
      } catch (error) {
        const message = `engine PID ${child.pid ?? 'unspawned'} ${name}: ${String(error)}`
        signalErrors.push(message)
        console.error(message)
      }
    }
    const termination = Promise.resolve().then(async (): Promise<void> => {
      if (graceMs > 0) {
        try {
          child.stdin?.end()
        } catch (error) {
          console.error('[engine stdin close]', error)
        }
        if (await wait(graceMs)) return
      }
      signal('SIGTERM')
      if (await wait(this.terminationGraceMs)) return
      signal('SIGKILL')
      if (await wait(this.exitObservationMs)) return
      throw new Error(
        `Engine PID ${child.pid ?? 'unspawned'} exit not observed after SIGKILL deadline${signalErrors.length ? `: ${signalErrors.join('; ')}` : ''}`
      )
    })
    this.terminating.set(child, termination)
    // Failed attempts are retryable; concurrent callers still share one attempt.
    void termination.catch(() => this.terminating.delete(child))
    return termination
  }
}
