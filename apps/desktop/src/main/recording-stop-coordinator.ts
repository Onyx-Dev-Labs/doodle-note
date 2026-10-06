import type { EngineEvent } from '../shared/engine-events'
import type { CaptureStopState } from '../shared/detect-api'

export class RecordingStopCoordinator {
  private state: CaptureStopState | null = null
  private retryable = false
  constructor(
    private readonly stop: () => void,
    private readonly changed: () => void
  ) {}
  begin(captureId: string, meetingId?: string): void {
    this.state = { captureId, meetingId, phase: 'active' }
    this.retryable = false
    this.changed()
  }
  request(reason: 'manual' | 'meeting-ended', captureId = this.state?.captureId): boolean {
    if (
      !this.state ||
      this.state.captureId !== captureId ||
      (this.state.phase !== 'active' && !(reason === 'manual' && this.retryable))
    )
      return false
    this.retryable = false
    this.state = { ...this.state, reason, phase: 'requested' }
    this.changed()
    try {
      this.stop()
    } catch {
      this.state.phase = 'failed'
      this.retryable = true
      this.changed()
    }
    return true
  }
  handle(event: EngineEvent): void {
    if (event.event === 'done' || event.event === 'exit' || event.event === 'spawn-error')
      this.retryable = false
    if (!this.state || this.state.phase === 'completed' || this.state.phase === 'failed') return
    if (event.event === 'capture-finalized' && event.captureId !== this.state.captureId) return
    if (event.event === 'capture-finalized' && event.error && this.state.reason)
      this.state.phase = 'failed'
    else if (event.event === 'error' && this.state.reason) this.state.phase = 'failed'
    else if (event.event === 'exit' || event.event === 'spawn-error') this.state.phase = 'failed'
    else if (event.event === 'done') this.state.phase = 'completed'
    else if (
      event.event === 'status' &&
      ['capture_stopped', 'saving_audio'].includes(event.stage ?? '') &&
      this.state.reason
    )
      this.state.phase = 'stopped'
    else return
    this.changed()
  }
  snapshot(): CaptureStopState | null {
    return this.state ? { ...this.state } : null
  }
}
