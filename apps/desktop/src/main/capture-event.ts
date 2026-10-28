import type { EngineEvent } from '../shared/engine-events'

/** Host guards run first; capture events are stamped, attempt failures keep their identity. */
export function captureEventForSession(event: EngineEvent, captureId?: string): EngineEvent | null {
  if (event.captureId && event.captureId !== captureId) return null
  // A host can reject a new attempt before `started` (for example, a Windows
  // worker still restarting). It has no capture identity yet: attributing that
  // failure to the previous capture makes a fresh meeting reject its own error.
  // Preserve explicit identities after the stale check above; untagged errors
  // still rely on the host's existing superseded-process callback guards.
  if (event.event === 'spawn-error') return event
  if (event.event === 'status' && event.stage === 'audio_save_failed') {
    if (event.channel !== 'mic' && event.channel !== 'system') return null
    // Never forward a writer's raw reason, filesystem path, or future diagnostics.
    return { event: 'status', stage: event.stage, channel: event.channel, captureId }
  }
  return { ...event, captureId }
}
