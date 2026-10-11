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
    // The live-caption language model downloads in the background on its first
    // session; captions run in English meanwhile.
    case 'downloading_live_model':
      return {
        ...state,
        statusText: `English captions for now — downloading the language model (${Math.round((ev.progress ?? 0) * 100)}%)`
      }
    case 'live_model_ready':
      return { ...state, statusText: 'Language model ready — your next recording uses it' }
    case 'live_model_download_failed':
      return { ...state, statusText: 'Language model download failed — captions stay English' }
    case 'live_model_load_failed':
      return { ...state, statusText: 'Language model failed to load — captions stay English' }
    default:
      return state
  }
}
