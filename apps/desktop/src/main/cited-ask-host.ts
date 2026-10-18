import { randomUUID } from 'node:crypto'
import { MainCitedAskService, type CitedAskDependencies } from './cited-ask-service'

/** Narrow main composition dependency. No renderer may supply an owner ID or source binding. */
export interface CitedRenderer {
  id: number
  mainFrame: unknown
  isDestroyed(): boolean
  send(channel: string, value: unknown): void
}
export interface CitedOwnerLease {
  ownerId: string
  signal: AbortSignal
  assertCurrent(): void
}
export class CitedRendererOwners {
  private active?: { renderer: CitedRenderer; abort: AbortController; lease: CitedOwnerLease }
  constructor(private readonly currentRenderer: () => CitedRenderer | null) {}
  capture(event: { sender: CitedRenderer; senderFrame: unknown }): CitedOwnerLease {
    const renderer = this.currentRenderer()
    if (!renderer || renderer !== event.sender || renderer.isDestroyed())
      throw new Error('Only the current main renderer may use cited answers.')
    if (event.senderFrame !== renderer.mainFrame) throw new Error('Only the main frame is allowed.')
    if (this.active?.renderer !== renderer) this.retire()
    if (!this.active) {
      const abort = new AbortController()
      const ownerId = randomUUID()
      const lease: CitedOwnerLease = {
        ownerId,
        signal: abort.signal,
        assertCurrent: () => {
          if (
            abort.signal.aborted ||
            this.active?.lease !== lease ||
            this.currentRenderer() !== renderer ||
            renderer.isDestroyed()
          )
            throw Object.assign(new Error('Renderer ownership changed.'), { code: 'stale' })
        }
      }
      this.active = { renderer, abort, lease }
    }
    return this.active.lease
  }
  retire(renderer?: CitedRenderer): void {
    if (renderer && this.active?.renderer !== renderer) return
    const previous = this.active
    this.active = undefined
    previous?.abort.abort()
  }
  publish(ownerId: string, channel: string, value: unknown): boolean {
    const active = this.active
    if (!active || active.lease.ownerId !== ownerId) return false
    try {
      active.lease.assertCurrent()
    } catch {
      return false
    }
    active.renderer.send(channel, value)
    return true
  }
}

export interface CitedAskHost {
  cited: MainCitedAskService
  owners: CitedRendererOwners
  /** Listener must retire display/cache synchronously. Returned promises are NOT awaited. */
  subscribeInvalidation(listener: () => void | Promise<void>): () => void
  /** Synchronously notifies consumers; resolves after the shared producer drains. */
  invalidate(): Promise<void>
}
/** Construct once in main; Home and the brief installer receive this exact cited instance. */
export function createCitedAskHost(
  deps: CitedAskDependencies,
  currentRenderer: () => CitedRenderer | null
): CitedAskHost {
  const cited = new MainCitedAskService(deps)
  const listeners = new Set<() => void | Promise<void>>()
  let notifying = false
  return {
    cited,
    owners: new CitedRendererOwners(currentRenderer),
    subscribeInvalidation(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    invalidate() {
      // Issue abort BEFORE callbacks: a failed listener cannot bypass producer cleanup.
      const cleanup = cited.invalidate()
      // Reentrant invalidation still joins cleanup but cannot recursively notify.
      if (!notifying) {
        notifying = true
        try {
          for (const listener of [...listeners]) {
            if (!listeners.has(listener)) continue
            try {
              // Runtime isolation also handles an accidentally async listener. Its
              // synchronous body must retire content; asynchronous work is not a gate.
              void Promise.resolve(listener()).catch(() => {})
            } catch {
              /* One consumer cannot prevent the others retiring content. */
            }
          }
        } finally {
          notifying = false
        }
      }
      // Repeated external invalidations notify once each and join the current producer.
      return cleanup
    }
  }
}
