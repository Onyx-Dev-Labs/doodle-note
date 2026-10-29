import type { AudioApi, AudioPart } from '../../../shared/audio-api'
import type { EngineApi } from '../../../shared/engine-events'

/** Keep a mounted meeting's saved recordings current; stop publishing on teardown. */
export function watchMeetingAudio(
  meetingId: string,
  audio: Pick<AudioApi, 'list' | 'onChanged'>,
  engine: Pick<EngineApi, 'onEvent'>,
  onParts: (parts: AudioPart[]) => void
): () => void {
  let cancelled = false
  let revision = 0
  const refresh = (): void => {
    const request = ++revision
    audio
      .list(meetingId)
      .then((parts) => {
        if (!cancelled && request === revision) onParts(parts)
      })
      .catch(() => {})
  }
  const unsubscribe = engine.onEvent((event) => {
    if (event.event === 'audio') refresh()
  })
  const unsubscribeAudio = audio.onChanged((change) => {
    if (change.meetingId === meetingId) refresh()
  })
  refresh()
  return () => {
    cancelled = true
    unsubscribe()
    unsubscribeAudio()
  }
}
