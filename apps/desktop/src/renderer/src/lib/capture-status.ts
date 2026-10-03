import type { EngineStatusEvent } from '../../../shared/engine-events'

interface CaptureStatusState {
  phase: 'idle' | 'starting' | 'recording' | 'finishing' | 'ended'
  statusText: string
  transcribing: boolean
}

/** Only deliberate lifecycle copy belongs in the recorder, never raw engine diagnostics. */
export function applyCaptureStatus<T extends CaptureStatusState>(
  state: T,
  ev: EngineStatusEvent
): T {
  if (state.phase === 'idle' || state.phase === 'ended') return state
  switch (ev.stage) {
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
    case 'refining_transcript':
      return { ...state, phase: 'finishing', statusText: 'Improving transcript locally…' }
    default:
      return state
  }
}
