import type { EngineChannel } from '../../../shared/engine-events'

const activeDecoders = new Map<string, AbortController>()
export function cancelWinBatchAudio(jobId: string): void {
  activeDecoders.get(jobId)?.abort()
}

const TARGET_SAMPLE_RATE = 16_000
const CHUNK_SAMPLES = TARGET_SAMPLE_RATE * 2

/** Decode an imported file with Chromium and stream 16 kHz PCM back to main. */
export async function decodeWinBatchAudio(jobId: string): Promise<void> {
  const controller = new AbortController()
  activeDecoders.set(jobId, controller)
  let context: AudioContext | null = null
  const check = (): void => {
    controller.signal.throwIfAborted()
  }
  const close = (): void => {
    if (context) void context.close().catch(() => {})
  }
  controller.signal.addEventListener('abort', close, { once: true })
  try {
    const encoded = await window.engine.readBatchAudio(jobId)
    check()
    context = new AudioContext()
    const decoded = await context.decodeAudioData(encoded.slice(0))
    check()
    const channelCount = Math.min(2, Math.max(1, decoded.numberOfChannels))
    const channels: EngineChannel[] = channelCount > 1 ? ['mic', 'system'] : ['mic']

    const sourceBuffer = context.createBuffer(channelCount, decoded.length, decoded.sampleRate)
    for (let channel = 0; channel < channelCount; channel += 1) {
      sourceBuffer.copyToChannel(decoded.getChannelData(channel), channel)
    }
    const outputLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
    const offline = new OfflineAudioContext(channelCount, outputLength, TARGET_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = sourceBuffer
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()

    check()
    await window.engine.sendBatchMessage({
      type: 'begin',
      jobId,
      channels,
      audioSeconds: decoded.duration
    })
    for (let offset = 0; offset < rendered.length; offset += CHUNK_SAMPLES) {
      check()
      const end = Math.min(rendered.length, offset + CHUNK_SAMPLES)
      for (let channel = 0; channel < channels.length; channel += 1) {
        await window.engine.sendBatchMessage({
          type: 'audio',
          jobId,
          channel: channels[channel]!,
          samples: rendered.getChannelData(channel).slice(offset, end)
        })
      }
      if (offset > 0 && offset % (CHUNK_SAMPLES * 8) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    await window.engine.sendBatchMessage({ type: 'end', jobId })
  } catch (error) {
    if (controller.signal.aborted) return
    const detail = error instanceof Error && error.message.trim() ? ` ${error.message}` : ''
    await window.engine
      .sendBatchMessage({
        type: 'error',
        jobId,
        message:
          'Could not decode an audio track from that file. It may have no audio or use an unsupported codec.' +
          detail
      })
      .catch(() => {})
  } finally {
    activeDecoders.delete(jobId)
    controller.signal.removeEventListener('abort', close)
    close()
  }
}
