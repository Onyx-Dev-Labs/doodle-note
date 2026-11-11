/**
 * Windows: Bark records the microphone in a hidden window of its own, so dictation
 * works with the main window closed to the tray and never touches meeting capture.
 * These are the channels between that window and the main process. PCM frames and
 * capture acknowledgements use the engine's own channels (ENGINE_AUDIO_CHANNEL,
 * ENGINE_CAPTURE_STATUS_CHANNEL), so the engine host treats both captures alike.
 */
import type { EngineCaptureControl, EngineInputDevice } from './engine-events'

/** main → capture window: start / stop / switch-input for a dictation session. */
export const DICTATION_CAPTURE_CONTROL_CHANNEL = 'dictation-capture:control'
/** main → capture window: list the microphones ({ requestId }). */
export const DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL = 'dictation-capture:devices-request'
/** capture window → main: { requestId, devices }. */
export const DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL = 'dictation-capture:devices-reply'
/** capture window → main: its listeners are installed. */
export const DICTATION_CAPTURE_READY_CHANNEL = 'dictation-capture:ready'
/** Passed to the capture window only in unpackaged test runs (DOODLENOTE_BARK_TEST_HOOKS=1). */
export const DICTATION_CAPTURE_TEST_HOOKS_ARG = '--bark-capture-test-hooks'

/** Dictation frames: 1024 samples (64 ms at 16 kHz), so the pill's meter moves smoothly. */
export const DICTATION_FRAME_SAMPLES = 1024

export interface DictationCaptureBridge {
  onControl(cb: (control: EngineCaptureControl) => void): () => void
  onDevicesRequest(cb: (requestId: string) => void): () => void
  replyDevices(requestId: string, devices: EngineInputDevice[]): void
  ready(): void
  /**
   * True only in an unpackaged test run: the page then plays a fixture set on
   * window.__barkTestFixture (base64 WAV) instead of opening the microphone.
   */
  readonly testHooks: boolean
}
