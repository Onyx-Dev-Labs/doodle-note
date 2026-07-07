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
  stream: MediaStream
  context: AudioContext
}

let captures: ChannelCapture[] = []

export async function startWinCapture(channels: string[]): Promise<void> {
  stopWinCapture()
  try {
    if (channels.includes('mic')) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
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
  return { stream, context }
}

export function stopWinCapture(): void {
  for (const capture of captures) {
    for (const track of capture.stream.getTracks()) track.stop()
    void capture.context.close().catch(() => {})
  }
  captures = []
}
