import type { EngineInputDevice } from '../../../shared/engine-events'
import { mapWindowsInputDevices } from '../../../shared/win-audio-utils'

/**
 * Windows audio capture, in the renderer where Chromium does the heavy
 * lifting: microphone via getUserMedia (with Chromium's AEC scrubbing the
 * far side out of the "You" channel) and system audio via getDisplayMedia,
 * which main grants as WASAPI loopback (setDisplayMediaRequestHandler).
 * Frames leave as 16kHz mono Float32 chunks over window.engine.sendAudio —
 * the main process forwards them to the sherpa-onnx engine.
 *
 * Driven by ENGINE_CAPTURE_CONTROL messages from WinEngineHost; never runs
 * on macOS (the Swift engine owns capture there).
 */

interface ChannelCapture {
  channel: string
  stream: MediaStream
  context: AudioContext
}

let captures: ChannelCapture[] = []
let activeInputDevice: string | undefined

export async function startWinCapture(channels: string[], inputDevice?: string): Promise<void> {
  stopWinCapture()
  activeInputDevice = inputDevice
  try {
    if (channels.includes('mic')) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(inputDevice && inputDevice !== 'default' ? { deviceId: { exact: inputDevice } } : {}),
          channelCount: 1,
          echoCancellation: true, // scrubs speaker bleed out of "You"
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      captures.push(pump(mic, 'mic'))
    }
    if (channels.includes('system')) {
      // Main's display-media handler answers this with audio: 'loopback'.
      const display = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 2, height: 2, frameRate: 1 }
      })
      // Only the loopback audio is wanted; drop the video track immediately.
      for (const track of display.getVideoTracks()) {
        track.stop()
        display.removeTrack(track)
      }
      if (display.getAudioTracks().length === 0) {
        throw new Error('System audio loopback is unavailable on this machine')
      }
      captures.push(pump(display, 'system'))
    }
  } catch (err) {
    stopWinCapture()
    window.engine.reportCaptureError(
      err instanceof Error ? err.message : 'Audio capture failed to start'
    )
  }
}

/** Wire a stream into a 16k AudioContext and ship PCM frames to main. */
function pump(stream: MediaStream, channel: string): ChannelCapture {
  // Chromium resamples to the context rate — 16k mono lands here for free.
  const context = new AudioContext({ sampleRate: 16000 })
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (event) => {
    // The buffer is reused by the audio thread — copy before shipping.
    window.engine.sendAudio(channel, new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination) // ScriptProcessor only runs when routed
  return { channel, stream, context }
}

export async function listWinInputDevices(): Promise<EngineInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return mapWindowsInputDevices(devices)
}

/** Replace only the microphone stream; system loopback keeps flowing. */
export async function switchWinInputDevice(inputDevice?: string): Promise<void> {
  const current = captures.find((capture) => capture.channel === 'mic')
  if (!current || inputDevice === activeInputDevice) return
  try {
    const replacement = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(inputDevice && inputDevice !== 'default' ? { deviceId: { exact: inputDevice } } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    const next = pump(replacement, 'mic')
    stopCapture(current)
    captures = captures.map((capture) => (capture === current ? next : capture))
    activeInputDevice = inputDevice
  } catch (error) {
    console.error('[win-capture] could not switch microphones:', error)
  }
}

function stopCapture(capture: ChannelCapture): void {
  for (const track of capture.stream.getTracks()) track.stop()
  void capture.context.close().catch(() => {})
}

export function stopWinCapture(): void {
  for (const capture of captures) stopCapture(capture)
  captures = []
  activeInputDevice = undefined
}
