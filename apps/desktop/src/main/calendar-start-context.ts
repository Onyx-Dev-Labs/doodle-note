import { randomUUID } from 'node:crypto'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import type { CalendarEvent } from '../shared/calendar-api'
import type { RecordingStartRequest } from '../shared/recording-api'
import type { RecordingStartObserver } from './recording-start-coordinator'
import type { ContextControl } from './calendar-context-store'

export interface TrustedCalendarObservation {
  event: CalendarEvent
  lastSyncIso: string | null
  assertCurrent(): void
}
export interface CalendarLinkedOriginal {
  meetingId: string
  calendarEventId: string | undefined
  scope: SourceScope
  rawSha256: string
  projectedRevisionId: string
  trashed: boolean
}
export interface AcceptedCalendarStart {
  event: CalendarEvent
  lastSyncIso: string | null
  original: CalendarLinkedOriginal
  existedAtAttach: boolean
  captureId: string
}
interface Pending {
  requestId: string
  observation: TrustedCalendarObservation
  controller: AbortController
  meetingId?: string
  existedAtAttach?: boolean
  attempt?: string
  saving?: boolean
}
const warning = "Calendar context wasn't saved; history may need linking."

/** Optional capture metadata. No participant writes, renderer roster, audio control, or source engine. */
export class CalendarStartContext {
  private pending?: Pending
  constructor(
    private readonly dependencies: {
      resolve(eventId: string): TrustedCalendarObservation | null
      originalExists(meetingId: string): boolean
      readOriginal(meetingId: string): Promise<CalendarLinkedOriginal | null>
      assertOriginalCurrent(original: CalendarLinkedOriginal): void
      persist(start: AcceptedCalendarStart, control: ContextControl): Promise<void>
      warn(message: string): void
    }
  ) {}
  get pendingAttempt(): string | undefined {
    return this.pending?.attempt
  }
  private warn(): void {
    try {
      this.dependencies.warn(warning)
    } catch {
      /* Optional UI cannot affect capture. */
    }
  }
  private check(pending: Pending): void {
    pending.controller.signal.throwIfAborted()
    if (this.pending !== pending) throw new Error('Calendar start superseded.')
    pending.observation.assertCurrent()
  }
  private guard(action: () => void): void {
    try {
      action()
    } catch {
      this.reset()
      this.warn()
    }
  }
  private reset(): void {
    this.pending?.controller.abort()
    this.pending = undefined
  }
  readonly observer: RecordingStartObserver = {
    accepted: (request: RecordingStartRequest) =>
      this.guard(() => {
        this.reset()
        if (!request.event.eventId || request.event.adHoc) return
        const observation = this.dependencies.resolve(request.event.eventId)
        if (!observation || observation.event.id !== request.event.eventId)
          throw new Error('Calendar observation unavailable.')
        observation.assertCurrent()
        this.pending = {
          requestId: request.id,
          observation: { ...observation, event: structuredClone(observation.event) },
          controller: new AbortController()
        }
      }),
    attached: (requestId, meetingId) =>
      this.guard(() => {
        const pending = this.pending
        if (!pending || pending.requestId !== requestId) return
        this.check(pending)
        pending.meetingId = meetingId
        pending.existedAtAttach = this.dependencies.originalExists(meetingId)
      }),
    engineBegin: (requestId, meetingId) =>
      this.guard(() => {
        const pending = this.pending
        if (!pending || pending.requestId !== requestId || pending.meetingId !== meetingId) {
          this.reset()
          return
        }
        this.check(pending)
        pending.attempt = randomUUID()
      }),
    reset: () => this.reset()
  }
  /** Host passes its accepted engine-attempt token plus the actual started capture ID. */
  async started(attempt: string, captureId: string, meetingId: string): Promise<void> {
    const pending = this.pending
    if (
      !pending ||
      pending.attempt !== attempt ||
      pending.meetingId !== meetingId ||
      pending.saving ||
      !captureId
    )
      return
    pending.saving = true
    try {
      this.check(pending)
      const original = await this.dependencies.readOriginal(meetingId)
      this.check(pending)
      if (
        !original ||
        original.meetingId !== meetingId ||
        original.trashed ||
        original.calendarEventId !== pending.observation.event.id ||
        original.scope.accountId !== null ||
        original.scope.workspaceId !== null
      )
        throw new Error('Calendar original is unavailable.')
      const assertCurrent = (): void => {
        this.check(pending)
        this.dependencies.assertOriginalCurrent(original)
      }
      assertCurrent()
      await this.dependencies.persist(
        {
          event: pending.observation.event,
          lastSyncIso: pending.observation.lastSyncIso,
          original,
          existedAtAttach: pending.existedAtAttach === true,
          captureId
        },
        { signal: pending.controller.signal, assertCurrent }
      )
      assertCurrent()
    } catch {
      // Cancellation is not a disk failure, and cannot clear another attempt's ownership.
      if (!pending.controller.signal.aborted && this.pending === pending) this.warn()
    } finally {
      if (this.pending === pending) this.pending = undefined
    }
  }
}
