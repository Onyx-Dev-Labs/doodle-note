import { randomUUID } from 'node:crypto'
import { calendarJoinUrl, type CalendarStartMeetingEvent } from '../shared/calendar-api'
import type { EngineEvent } from '../shared/engine-events'
import type { RecordingStartRequest, RecordingState } from '../shared/recording-api'

/** Own the reservation before any asynchronous meeting creation or window load. */
export class RecordingStartCoordinator {
  private state: RecordingState = { phase: 'idle', eligible: false, meetingId: null }
  private pending: RecordingStartRequest | null = null
  private rendererReady = false
  private delivered = false
  private engineClaimed = false
  private joinTarget?: { requestId: string; url: string }

  constructor(
    private readonly deliver: (request: RecordingStartRequest) => void,
    private readonly changed: (state: RecordingState) => void,
    private readonly openExternal: (url: string) => Promise<void> = async () => {
      throw new Error('Meeting link opener unavailable.')
    }
  ) {}

  snapshot(): RecordingState {
    return { ...this.state, ...(this.state.join ? { join: { ...this.state.join } } : {}) }
  }
  get busy(): boolean {
    return this.state.phase !== 'idle'
  }

  ready(eligible: boolean): RecordingState {
    this.rendererReady = eligible
    this.state.eligible = eligible
    this.publish()
    this.flush()
    return this.snapshot()
  }

  rendererGone(): void {
    this.rendererReady = false
    this.delivered = false
    // An undelivered request survives window creation/reload. An attached
    // meeting cannot safely be replayed; the host stops capture on a crash.
    if (this.state.meetingId && !this.engineClaimed) this.reset()
  }

  request(event: CalendarStartMeetingEvent): boolean {
    if (!this.state.eligible || this.busy) return false
    this.pending = { id: randomUUID(), event: { ...event, action: 'start' } }
    this.state.phase = 'requested'
    this.joinTarget = undefined
    delete this.state.join
    const url =
      event.joinRequested && event.eventId && !event.adHoc
        ? calendarJoinUrl(event.joinUrl)
        : undefined
    if (url) {
      this.joinTarget = { requestId: this.pending.id, url }
      this.state.join = { requestId: this.pending.id, subject: event.subject, status: 'opening' }
      void this.launchJoin(this.joinTarget)
    }
    this.publish()
    this.flush()
    return true
  }

  /** Retry only the accepted link. This path cannot reserve or start capture. */
  async retryJoin(requestId: string): Promise<void> {
    if (this.joinTarget?.requestId !== requestId || this.state.join?.status !== 'failed') return
    this.state.join.status = 'opening'
    this.publish()
    await this.launchJoin(this.joinTarget)
  }

  dismissJoin(requestId: string): void {
    if (this.joinTarget?.requestId !== requestId) return
    this.joinTarget = undefined
    delete this.state.join
    this.publish()
  }

  private async launchJoin(target: { requestId: string; url: string }): Promise<void> {
    let status: 'opened' | 'failed' = 'opened'
    try {
      // The host focuses/creates the recording window before handing off to the meeting app.
      await Promise.resolve()
      await this.openExternal(target.url)
    } catch {
      status = 'failed'
    }
    if (this.joinTarget !== target || !this.state.join) return
    this.state.join.status = status
    this.publish()
  }

  attach(requestId: string, meetingId: string): boolean {
    if (this.pending?.id !== requestId || this.state.phase !== 'requested' || !meetingId)
      return false
    this.state.meetingId = meetingId
    this.state.phase = 'starting'
    this.publish()
    return true
  }

  cancel(requestId: string): void {
    if (this.pending?.id === requestId && !this.engineClaimed) this.reset()
  }

  /** Also serialize normal editor Resume and the developer console. */
  beginEngine(meetingId?: string): boolean {
    if (this.engineClaimed) return false
    if (this.busy && !(this.state.phase === 'starting' && this.state.meetingId === meetingId))
      return false
    this.engineClaimed = true
    this.pending = null
    this.state.meetingId = meetingId ?? null
    this.state.phase = 'starting'
    this.publish()
    return true
  }

  stop(): void {
    if (!this.busy) return
    if (!this.engineClaimed) {
      this.reset()
      return
    }
    this.state.phase = 'finishing'
    this.publish()
  }

  handle(event: EngineEvent): void {
    if (!this.engineClaimed) return
    if (event.event === 'exit' || event.event === 'spawn-error') this.reset()
    else if (event.event === 'ready') {
      if (this.state.phase !== 'finishing') this.state.phase = 'recording'
      this.publish()
    } else if (
      event.event === 'status' &&
      ['finishing', 'saving_audio', 'refining_transcript'].includes(event.stage ?? '')
    ) {
      this.state.phase = 'finishing'
      this.publish()
    }
  }

  private flush(): void {
    if (!this.rendererReady || !this.pending || this.delivered) return
    this.delivered = true
    this.deliver(this.pending)
  }
  private reset(): void {
    this.pending = null
    this.delivered = false
    this.engineClaimed = false
    this.state = { ...this.state, phase: 'idle', meetingId: null }
    this.publish()
  }
  private publish(): void {
    this.changed(this.snapshot())
  }
}

export function recordingMenuAction(state: RecordingState): { label: string; enabled: boolean } {
  if (!state.eligible) return { label: 'Complete setup to record', enabled: false }
  const labels = {
    idle: 'Record now',
    requested: 'Starting…',
    starting: 'Starting…',
    recording: 'Recording…',
    finishing: 'Finishing…'
  }
  return { label: labels[state.phase], enabled: state.phase === 'idle' }
}
