import type { EngineStatusEvent } from '../../../shared/engine-events'

interface CaptureStatusState {
  captureId?: string
  savedAudioFailures?: import('@repo/meetings-store/types').SavedAudioFailures
  phase: 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'
  statusText: string
  transcribing: boolean
  /** Windows only: the engine is behind real time; set and cleared by status events. */
  captionsDelayed?: boolean
  /** Windows only: this capture uses the previous speech model (new one downloading). */
  legacyModel?: boolean
}

/** Windows recorder notices for the live session, in display order. */
export function captureNotices(state: {
  phase: CaptureStatusState['phase']
  captionsDelayed?: boolean
  legacyModel?: boolean
}): string[] {
  const live = state.phase === 'recording' || state.phase === 'starting'
  const notices: string[] = []
  if (live && state.legacyModel) {
    notices.push(
      'Transcribing with the previous speech model while the new one downloads. This recording keeps that transcript; Re-transcribe it later for the new model.'
    )
  }
  if (live && state.captionsDelayed) {
    notices.push(
      'Live captions are running behind on this PC. Everything is still being transcribed and will appear shortly.'
    )
  }
  return notices
}

/** Only deliberate lifecycle copy belongs in the recorder, never raw engine diagnostics. */
export function applyCaptureStatus<T extends CaptureStatusState>(
  state: T,
  ev: EngineStatusEvent
): T {
  if (state.phase === 'idle' || state.phase === 'ended') return state
  if (ev.captureId && ev.captureId !== state.captureId) return state
  switch (ev.stage) {
    case 'audio_save_failed':
      return ev.channel === 'mic' || ev.channel === 'system'
        ? { ...state, savedAudioFailures: { ...state.savedAudioFailures, [ev.channel]: true } }
        : state
    case 'requesting_permission': {
      if (state.phase !== 'starting') return state
      const permission =
        ev.permission === 'microphone'
          ? 'microphone'
          : ev.permission === 'system_audio' || ev.permission === 'screen_system_audio'
            ? 'system audio'
            : 'recording'
      return { ...state, statusText: `Allow ${permission} access to start recording…` }
    }
    case 'permission_granted': // Compatibility with older sidecars; authorization is not readiness.
    case 'starting_capture':
      return state.phase === 'starting' ? { ...state, statusText: 'Starting…' } : state
    case 'loading_models':
    case 'serve_loading_models':
    case 'extracting_model':
      return state.phase === 'starting'
        ? { ...state, statusText: 'Preparing transcription…' }
        : state
    case 'downloading_model':
      return state.phase === 'starting'
        ? { ...state, statusText: 'Downloading transcription model…' }
        : state
    case 'transcribing':
      return {
        ...state,
        transcribing: true,
        statusText: state.phase === 'starting' ? 'Starting…' : state.statusText
      }
    case 'finishing':
    case 'saving_audio':
      return { ...state, phase: 'finishing', statusText: 'Finishing up…' }
    case 'captions_delayed':
      // Windows only: this PC is decoding slower than real time. Every word is
      // still transcribed; captions just lag until it catches up.
      return { ...state, captionsDelayed: true }
    case 'captions_caught_up':
      return { ...state, captionsDelayed: false }
    case 'legacy_model':
      return { ...state, legacyModel: true }
    default:
      return state
  }
}
