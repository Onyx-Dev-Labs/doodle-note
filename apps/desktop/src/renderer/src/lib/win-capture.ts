import type { EngineInputDevice } from '../../../shared/engine-events'
import { mapWindowsInputDevices } from '../../../shared/win-audio-utils'

/**
 * Windows audio capture lives in the renderer so Chromium can provide the
 * microphone and WASAPI loopback streams. Every asynchronous operation is
 * scoped to a main-process session id. That keeps a late permission result or
 * microphone switch from reviving an old capture after Stop.
 */

interface ChannelCapture {
  channel: string
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  mute: GainNode
}

let captures: ChannelCapture[] = []
let pendingStreams: MediaStream[] = []
let activeInputDevice: string | undefined
let activeSessionId: number | null = null
let sessionGeneration = 0
let switchGeneration = 0

function microphoneConstraints(inputDevice?: string): MediaTrackConstraints {
  return {
    ...(inputDevice && inputDevice !== 'default' ? { deviceId: { exact: inputDevice } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
}

function current(sessionId: number, generation: number): boolean {
  return activeSessionId === sessionId && sessionGeneration === generation
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

export async function startWinCapture(
  sessionId: number,
  channels: string[],
  inputDevice?: string
): Promise<void> {
  cancelCapture()
  const generation = ++sessionGeneration
  activeSessionId = sessionId
  activeInputDevice = inputDevice
  const acquired: Array<{ channel: string; stream: MediaStream }> = []
  const prepared: ChannelCapture[] = []

  try {
    if (channels.includes('mic')) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: microphoneConstraints(inputDevice)
      })
      if (!current(sessionId, generation)) {
        stopStream(mic)
        return
      }
      pendingStreams.push(mic)
      acquired.push({ channel: 'mic', stream: mic })
    }

    if (channels.includes('system')) {
      // Main's display-media handler answers this with audio: 'loopback'.
      const display = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 2, height: 2, frameRate: 1 }
      })
      if (!current(sessionId, generation)) {
        stopStream(display)
        return
      }
      pendingStreams.push(display)
      for (const track of display.getVideoTracks()) {
        track.stop()
        display.removeTrack(track)
      }
      if (display.getAudioTracks().length === 0) {
        throw new Error('System audio loopback is unavailable on this machine')
      }
      acquired.push({ channel: 'system', stream: display })
    }

    if (!current(sessionId, generation)) return
    for (const { channel, stream } of acquired) {
      prepared.push(pump(stream, channel, sessionId, generation))
    }
    captures = prepared
    pendingStreams = []
    window.engine.reportCaptureStatus({ type: 'ready', sessionId })
  } catch (error) {
    if (!current(sessionId, generation)) return
    for (const capture of prepared) stopCapture(capture)
    pendingStreams = pendingStreams.filter(
      (stream) => !prepared.some((capture) => capture.stream === stream)
    )
    cancelCapture()
    window.engine.reportCaptureStatus({
      type: 'error',
      sessionId,
      message: error instanceof Error ? error.message : 'Audio capture failed to start'
    })
  }
}

/** Wire a stream into a 16 kHz AudioContext and ship PCM frames to main. */
function pump(
  stream: MediaStream,
  channel: string,
  sessionId: number,
  generation: number
): ChannelCapture {
  const context = new AudioContext({ sampleRate: 16000 })
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  processor.onaudioprocess = (event) => {
    if (!current(sessionId, generation)) return
    // The buffer is reused by the audio thread — copy before shipping.
    window.engine.sendAudio(
      sessionId,
      channel,
      new Float32Array(event.inputBuffer.getChannelData(0))
    )
  }
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination)
  return { channel, stream, context, source, processor, mute }
}

export async function listWinInputDevices(): Promise<EngineInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return mapWindowsInputDevices(devices)
}

/** Replace only the microphone stream; system loopback keeps flowing. */
export async function switchWinInputDevice(sessionId: number, inputDevice?: string): Promise<void> {
  const currentCapture = captures.find((capture) => capture.channel === 'mic')
  if (activeSessionId !== sessionId || !currentCapture) return
  if (inputDevice === activeInputDevice) {
    window.engine.reportCaptureStatus({ type: 'switch-complete', sessionId })
    return
  }
  const generation = sessionGeneration
  const attempt = ++switchGeneration
  try {
    const replacement = await navigator.mediaDevices.getUserMedia({
      audio: microphoneConstraints(inputDevice)
    })
    if (
      !current(sessionId, generation) ||
      switchGeneration !== attempt ||
      !captures.includes(currentCapture)
    ) {
      stopStream(replacement)
      return
    }
    const next = pump(replacement, 'mic', sessionId, generation)
    stopCapture(currentCapture)
    captures = captures.map((capture) => (capture === currentCapture ? next : capture))
    activeInputDevice = inputDevice
    window.engine.reportCaptureStatus({ type: 'switch-complete', sessionId })
  } catch (error) {
    if (!current(sessionId, generation) || switchGeneration !== attempt) return
    window.engine.reportCaptureStatus({
      type: 'switch-error',
      sessionId,
      message: error instanceof Error ? error.message : 'Could not switch microphones'
    })
  }
}

function stopCapture(capture: ChannelCapture): void {
  capture.processor.onaudioprocess = null
  capture.source.disconnect()
  capture.processor.disconnect()
  capture.mute.disconnect()
  stopStream(capture.stream)
  void capture.context.close().catch(() => {})
}

function cancelCapture(): void {
  sessionGeneration++
  switchGeneration++
  for (const capture of captures) stopCapture(capture)
  for (const stream of pendingStreams) stopStream(stream)
  captures = []
  pendingStreams = []
  activeInputDevice = undefined
  activeSessionId = null
}

export function stopWinCapture(sessionId: number): void {
  if (activeSessionId === sessionId) cancelCapture()
  // IPC messages from one renderer arrive at main in send order. Once this
  // acknowledgement arrives, all PCM sent before disconnection has arrived.
  window.engine.reportCaptureStatus({ type: 'drained', sessionId })
}
