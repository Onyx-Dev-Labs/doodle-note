import type { EngineEvent } from '../shared/engine-events'

/** Host process guards run first; accepted events belong to this main-owned capture. */
export function captureEventForSession(event: EngineEvent, captureId?: string): EngineEvent | null {
  if (event.captureId && event.captureId !== captureId) return null
  if (event.event === 'status' && event.stage === 'audio_save_failed') {
    if (event.channel !== 'mic' && event.channel !== 'system') return null
    // Never forward a writer's raw reason, filesystem path, or future diagnostics.
    return { event: 'status', stage: event.stage, channel: event.channel, captureId }
  }
  return { ...event, captureId }
}
