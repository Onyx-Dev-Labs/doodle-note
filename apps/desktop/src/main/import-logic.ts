import { spawn } from 'node:child_process'
import type { TranscriptSegment } from '../shared/engine-events'
import type { EngineChannel, EngineTokenTiming } from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'

/** Batch imports use mixed audio unless a saved DoodleNote part proves split origin. */
export interface BatchOptions {
  channels?: 'mixed' | 'split'
  signal?: AbortSignal
}

/** Buffer batch tokens so acoustic echo comparison is independent of event order.
 * Keep all system words: unlike live capture, batch channel events can span hours.
 */
export function assembleBatchTokens(
  tokens: Record<EngineChannel, EngineTokenTiming[]>,
  channels: 'mixed' | 'split'
): TranscriptSegment[] {
  const assembler = new SegmentAssembler({ systemMemorySec: Infinity })
  const segments: TranscriptSegment[] = []
  for (const channel of ['system', 'mic'] as const) {
    segments.push(...assembler.addTimings(channel, tokens[channel]), ...assembler.flush(channel))
  }
  return segments
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment) =>
      channels === 'mixed'
        ? { ...segment, speaker: 'Speaker', speakerId: 'imported-speaker' }
        : segment
    )
}

export interface BatchTranscription {
  /** All assembled segments, echo-flagged ones included, sorted by startMs. */
  segments: TranscriptSegment[]
  audioSeconds: number
}

export interface BatchProgress {
  stage: 'starting' | 'downloading_model' | 'transcribing'
  progress?: number
}

/** Generous ceiling: an hour of audio decodes in ~1 min; model downloads
 *  on first use can take a while on slow connections. */
const TIMEOUT_MS = 30 * 60_000

export function transcribeFileToSegments(
  enginePath: string,
  filePath: string,
  onProgress?: (progress: BatchProgress) => void,
  options: BatchOptions = {}
): Promise<BatchTranscription> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        enginePath,
        ['transcribe', '--file', filePath, '--channels', options.channels ?? 'mixed'],
        {
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
    } catch (err) {
      reject(new Error(`could not start the transcription engine: ${String(err)}`))
      return
    }

    const tokens: Record<EngineChannel, EngineTokenTiming[]> = { mic: [], system: [] }
    let audioSeconds = 0
    let engineError: string | null = null
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (err) reject(err)
      else {
        resolve({
          segments: assembleBatchTokens(tokens, options.channels ?? 'mixed'),
          audioSeconds
        })
      }
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('transcription timed out'))
    }, TIMEOUT_MS)

    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (line.length === 0) continue
        let ev: {
          event?: string
          stage?: string
          progress?: number
          channel?: EngineChannel
          tokens?: EngineTokenTiming[]
          message?: string
          audioSeconds?: number
        }
        try {
          ev = JSON.parse(line)
        } catch {
          continue // CoreML noise on stdout
        }
        switch (ev.event) {
          case 'status':
            if (ev.stage === 'loading_models') onProgress?.({ stage: 'starting' })
            if (ev.stage === 'transcribing') onProgress?.({ stage: 'transcribing' })
            break
          case 'download':
            onProgress?.({ stage: 'downloading_model', progress: ev.progress })
            break
          case 'timings':
            if ((ev.channel === 'mic' || ev.channel === 'system') && Array.isArray(ev.tokens)) {
              tokens[ev.channel].push(...ev.tokens)
            }
            break
          case 'final':
            break
          case 'error':
            engineError = String(ev.message ?? 'transcription failed')
            break
          case 'done':
            if (typeof ev.audioSeconds === 'number') audioSeconds = ev.audioSeconds
            break
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (line.length > 0) console.error(`[import engine] ${line}`)
    })
    child.on('error', (err) => finish(new Error(`engine failed to start: ${err.message}`)))
    child.on('close', (code) => {
      if (engineError) finish(new Error(engineError))
      else if (code !== 0) finish(new Error(`engine exited with code ${code}`))
      else finish()
    })
  })
}
