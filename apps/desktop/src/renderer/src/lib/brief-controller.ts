import type { BriefApi, BriefView } from '../../../shared/briefs-api'
export interface BriefControllerState {
  view: BriefView | null
  busy: boolean
  error: string | null
}
/** One mounted panel/session. Push invalidation takes precedence over older invoke responses. */
export class BriefController {
  private state: BriefControllerState = { view: null, busy: false, error: null }
  private version = 0
  private closed = false
  private opening = false
  private latest: BriefView | null = null
  private unsubscribe: () => void
  constructor(
    private api: Pick<BriefApi, 'onState' | 'open' | 'close' | 'cancel'>,
    private changed: (state: BriefControllerState) => void
  ) {
    this.unsubscribe = api.onState((view) => {
      if (this.closed) return
      if (this.opening) this.latest = view
      if (this.state.view?.sessionId !== view.sessionId) return
      this.version++
      this.state.view = view
      this.emit()
    })
  }
  private emit(): void {
    if (!this.closed) this.changed({ ...this.state })
  }
  async open(eventId: string): Promise<void> {
    this.opening = true
    this.state.busy = true
    this.emit()
    try {
      const view = await this.api.open(eventId)
      if (this.closed) {
        await this.api.close(view.sessionId)
        return
      }
      this.state.view = this.latest?.sessionId === view.sessionId ? this.latest : view
    } catch {
      this.state.error = 'Calendar or local history is unavailable. Close and reopen the brief.'
    } finally {
      this.opening = false
      this.latest = null
      this.state.busy = false
      this.emit()
    }
  }
  async command(action: (view: BriefView) => Promise<BriefView>): Promise<void> {
    if (this.closed || this.state.busy || !this.state.view) return
    const version = this.version
    this.state.busy = true
    this.state.error = null
    this.emit()
    try {
      const view = await action(this.state.view)
      if (!this.closed && this.version === version) this.state.view = view
    } catch {
      this.state.error = 'Brief unavailable. Refresh to check the current context.'
    } finally {
      this.state.busy = false
      this.emit()
    }
  }
  async read<T>(action: (view: BriefView) => Promise<T>): Promise<T> {
    if (this.closed || this.state.busy || !this.state.view) throw new Error('Brief is busy.')
    const version = this.version
    this.state.busy = true
    this.state.error = null
    this.emit()
    try {
      const value = await action(this.state.view)
      if (this.closed || this.version !== version) throw new Error('Brief context changed.')
      return value
    } finally {
      this.state.busy = false
      this.emit()
    }
  }
  async cancel(): Promise<void> {
    const view = this.state.view
    if (view?.runId) await this.api.cancel(view.sessionId, view.runId)
  }
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    if (this.state.view) void this.api.close(this.state.view.sessionId).catch(() => {})
  }
}
