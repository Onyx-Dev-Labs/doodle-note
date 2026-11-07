/**
 * Bark's hidden capture page (Windows). It runs the same capture code as meetings
 * (lib/win-capture.ts) with dictation's options: the microphone only, raw (no echo
 * cancellation, noise suppression or gain control, like the macOS dictation path),
 * in 64 ms frames. It is never shown and holds no app state.
 */
import type { DictationCaptureBridge } from '../../shared/dictation-capture-api'
import { DICTATION_FRAME_SAMPLES } from '../../shared/dictation-capture-api'
import {
  listWinInputDevices,
  setWinCaptureWorkletUrl,
  startWinCapture,
  stopWinCapture,
  switchWinInputDevice,
  type WinCaptureOptions
} from './lib/win-capture'
import captureWorkletUrl from './lib/win-capture-worklet.ts?worker&url'

declare global {
  interface Window {
    dictationCapture: DictationCaptureBridge
    /** Test runs only: a base64 WAV played instead of the microphone, used once. */
    __barkTestFixture?: string | null
  }
}

setWinCaptureWorkletUrl(captureWorkletUrl)

let fixtureContext: AudioContext | null = null

/**
 * Test runs only (never in a packaged app): play a recorded fixture into the same
 * capture pipeline in real time instead of opening the microphone, so the whole
 * dictation path can be measured without recording anyone.
 */
function fixtureSource(): WinCaptureOptions['acquireMicrophone'] {
  if (!window.dictationCapture.testHooks || !window.__barkTestFixture) return undefined
  const base64 = window.__barkTestFixture
  window.__barkTestFixture = null
  return async () => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    void fixtureContext?.close().catch(() => {})
    const context = new AudioContext({ sampleRate: 16000 })
    fixtureContext = context
    const buffer = await context.decodeAudioData(bytes.buffer)
    const source = context.createBufferSource()
    source.buffer = buffer
    const destination = context.createMediaStreamDestination()
    source.connect(destination)
    source.start()
    return destination.stream
  }
}

/**
 * The real microphone, with Chromium's errors put in words that say it is the
 * microphone (no device, or access turned off), so the pill can say so.
 */
async function microphone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    throw new Error(
      name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'No microphone was found.'
        : name === 'NotAllowedError'
          ? 'Microphone access is turned off for desktop apps.'
          : `The microphone could not be opened (${name || 'unknown error'}).`
    )
  }
}

window.dictationCapture.onControl((control) => {
  if (control.action === 'start') {
    void startWinCapture(control.sessionId, control.channels ?? ['mic'], control.inputDevice, {
      raw: true,
      frameSamples: DICTATION_FRAME_SAMPLES,
      acquireMicrophone: fixtureSource() ?? microphone
    })
  } else if (control.action === 'switch-input') {
    void switchWinInputDevice(control.sessionId, control.inputDevice)
  } else {
    void stopWinCapture(control.sessionId)
  }
})

window.dictationCapture.onDevicesRequest((requestId) => {
  void listWinInputDevices()
    .catch(() => [])
    .then((devices) => window.dictationCapture.replyDevices(requestId, devices))
})

window.dictationCapture.ready()
