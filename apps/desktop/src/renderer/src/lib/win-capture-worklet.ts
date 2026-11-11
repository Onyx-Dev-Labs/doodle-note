/**
 * Windows capture pump, running on the audio rendering thread. It collects
 * 128-frame render quanta into 4096-sample (256 ms at 16 kHz) frames and posts
 * each one to the page, which forwards it to the speech engine. Unlike the
 * former ScriptProcessorNode, a busy renderer main thread cannot make the
 * audio thread drop input: frames queue on the port instead.
 *
 * Protocol: posts {type:'pcm', samples} frames. On {type:'flush'} it posts the
 * final partial frame, then {type:'flushed'}, and stops processing.
 */
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(
  name: string,
  processor: new (options?: {
    processorOptions?: { frameSamples?: number }
  }) => AudioWorkletProcessor & {
    process(inputs: Float32Array[][]): boolean
  }
): void

const FRAME_SAMPLES = 4096

class CapturePump extends AudioWorkletProcessor {
  /** Meetings use 4096; dictation asks for smaller frames (processorOptions.frameSamples). */
  private readonly size: number
  private frame: Float32Array
  private length = 0
  private active = true

  constructor(options?: { processorOptions?: { frameSamples?: number } }) {
    super()
    const wanted = options?.processorOptions?.frameSamples
    this.size =
      typeof wanted === 'number' && wanted >= 128 && wanted <= FRAME_SAMPLES
        ? wanted
        : FRAME_SAMPLES
    this.frame = new Float32Array(this.size)
    this.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== 'flush' || !this.active) return
      this.active = false
      if (this.length > 0) this.post(this.frame.slice(0, this.length))
      this.length = 0
      this.port.postMessage({ type: 'flushed' })
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.active) return false
    const input = inputs[0]?.[0]
    if (!input) return true
    let offset = 0
    while (offset < input.length) {
      const take = Math.min(this.size - this.length, input.length - offset)
      this.frame.set(input.subarray(offset, offset + take), this.length)
      this.length += take
      offset += take
      if (this.length === this.size) {
        this.post(this.frame)
        this.frame = new Float32Array(this.size)
        this.length = 0
      }
    }
    return true
  }

  private post(samples: Float32Array): void {
    this.port.postMessage({ type: 'pcm', samples }, [samples.buffer])
  }
}

registerProcessor('doodlenote-capture-pump', CapturePump)

export {}
