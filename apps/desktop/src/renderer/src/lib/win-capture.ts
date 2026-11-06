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
  pump: AudioWorkletNode
  mute: GainNode
  /** False once torn down: no further frames reach the engine. */
  forwarding: boolean
  /** Resolves when the pump has posted its last partial frame. */
  flushed?: () => void
}

const PUMP_PROCESSOR = 'doodlenote-capture-pump'
/** Stop waits at most this long for the audio thread's last partial frame. */
const FLUSH_TIMEOUT_MS = 250
let workletUrl: string | null = null

/** The bundled worklet module URL (set once by the app; tests use a stub). */
export function setWinCaptureWorkletUrl(url: string): void {
  workletUrl = url
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
      prepared.push(await pump(stream, channel, sessionId))
      if (!current(sessionId, generation)) {
        for (const capture of prepared) stopCapture(capture)
        return
      }
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

/**
 * Wire a stream into a 16 kHz AudioContext whose AudioWorklet pump ships PCM
 * frames to main. The mono down-mix matches the former ScriptProcessorNode
 * (one explicit input channel, speaker interpretation).
 */
async function pump(
  stream: MediaStream,
  channel: string,
  sessionId: number
): Promise<ChannelCapture> {
  if (!workletUrl) throw new Error('Audio capture is not initialized')
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    await context.audioWorklet.addModule(workletUrl)
  } catch (error) {
    void context.close().catch(() => {})
    throw error
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, PUMP_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers'
  })
  const mute = context.createGain()
  mute.gain.value = 0
  const capture: ChannelCapture = {
    channel,
    stream,
    context,
    source,
    pump: node,
    mute,
    forwarding: true
  }
  node.port.onmessage = (event: MessageEvent<{ type?: string; samples?: Float32Array }>) => {
    if (event.data?.type === 'flushed') {
      capture.flushed?.()
      return
    }
    if (!capture.forwarding || !(event.data?.samples instanceof Float32Array)) return
    window.engine.sendAudio(sessionId, channel, event.data.samples)
  }
  source.connect(node)
  node.connect(mute)
  mute.connect(context.destination)
  return capture
}

/** Collect the pump's final partial frame, then tear the capture down. */
async function drainCapture(capture: ChannelCapture): Promise<void> {
  if (capture.forwarding) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS)
      capture.flushed = () => {
        clearTimeout(timer)
        resolve()
      }
      capture.pump.port.postMessage({ type: 'flush' })
    })
  }
  stopCapture(capture)
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
    const next = await pump(replacement, 'mic', sessionId)
    if (!current(sessionId, generation) || !captures.includes(currentCapture)) {
      stopCapture(next)
      return
    }
    captures = captures.map((capture) => (capture === currentCapture ? next : capture))
    void drainCapture(currentCapture)
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
  capture.forwarding = false
  capture.pump.port.onmessage = null
  capture.source.disconnect()
  capture.pump.disconnect()
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

export async function stopWinCapture(sessionId: number): Promise<void> {
  const draining = activeSessionId === sessionId ? captures : []
  if (activeSessionId === sessionId) {
    // Detach the session first so late permission results and switches stop,
    // but let the running pumps hand over their last partial frames.
    captures = []
    cancelCapture()
  }
  await Promise.all(draining.map(drainCapture))
  // IPC messages from one renderer arrive at main in send order. Once this
  // acknowledgement arrives, all PCM sent before disconnection has arrived.
  window.engine.reportCaptureStatus({ type: 'drained', sessionId })
}
