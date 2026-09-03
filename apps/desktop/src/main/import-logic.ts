import { spawn } from 'node:child_process'
import type { TranscriptSegment } from '../shared/engine-events'
import type { EngineChannel, EngineTokenTiming } from '../shared/engine-events'
import { SegmentAssembler } from './segmenter'

/**
 * Batch-transcribe an audio file into transcript segments — the pipeline
 * behind import and re-transcription. Electron-free so it can be integration-
 * tested under node against the real engine binary.
 *
 * Runs `engine transcribe --channels split`: stereo meeting recordings decode
 * per channel (L = mic "You", R = system "Them"), mono imports land on the
 * mic channel. The engine emits the live protocol's timings/final events, so
 * the exact same SegmentAssembler (pause-cutting, echo suppression) shapes
 * the result.
 */

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

/** v2 is the engine's default English model; v3 recognizes 25 European languages. */
export type BatchAsrModel = 'v2' | 'v3'

export function batchTranscribeArgs(filePath: string, model?: BatchAsrModel): string[] {
  const args = ['transcribe', '--file', filePath, '--channels', 'split']
  if (model === 'v3') args.push('--model', 'v3')
  return args
}

export function transcribeFileToSegments(
  enginePath: string,
  filePath: string,
  onProgress?: (progress: BatchProgress) => void,
  model?: BatchAsrModel
): Promise<BatchTranscription> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(enginePath, batchTranscribeArgs(filePath, model), {
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      reject(new Error(`could not start the transcription engine: ${String(err)}`))
      return
    }

    const assembler = new SegmentAssembler()
    const segments: TranscriptSegment[] = []
    let audioSeconds = 0
    let engineError: string | null = null
    let settled = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (err) reject(err)
      else {
        segments.push(...assembler.flush())
        segments.sort((a, b) => a.startMs - b.startMs)
        resolve({ segments, audioSeconds })
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
            if (ev.channel && Array.isArray(ev.tokens)) {
              segments.push(...assembler.addTimings(ev.channel, ev.tokens))
            }
            break
          case 'final':
            if (ev.channel) segments.push(...assembler.flush(ev.channel))
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
