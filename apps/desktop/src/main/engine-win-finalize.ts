export const WINDOWS_ASR_SAMPLE_RATE = 16_000
export const WINDOWS_ASR_TAIL_SECONDS = 0.5

interface FinishableStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}

interface StreamingRecognizer<TStream> {
  isReady(stream: TStream): boolean
  decode(stream: TStream): void
}

/**
 * Flush a streaming recognizer using the tail silence recommended by Sherpa's
 * online API examples. The silence is recognizer-only and is never persisted.
 */
export function finishOnlineStream<TStream extends FinishableStream>(
  stream: TStream,
  recognizer: StreamingRecognizer<TStream>
): void {
  stream.acceptWaveform({
    samples: new Float32Array(WINDOWS_ASR_SAMPLE_RATE * WINDOWS_ASR_TAIL_SECONDS),
    sampleRate: WINDOWS_ASR_SAMPLE_RATE
  })
  stream.inputFinished()
  while (recognizer.isReady(stream)) recognizer.decode(stream)
}

export function boundedTokenWindow(
  startSec: number,
  endSec: number,
  realAudioSeconds: number
): { startSec: number; endSec: number } | null {
  if (startSec > realAudioSeconds) return null
  const start = Math.max(0, Math.min(startSec, realAudioSeconds))
  return {
    startSec: start,
    endSec: Math.max(start, Math.min(endSec, realAudioSeconds))
  }
}
