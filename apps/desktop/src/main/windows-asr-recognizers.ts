import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadWindowsAsrRuntime } from './windows-asr-runtime'
import type {
  OfflineRecognizerLike,
  OfflineStreamLike,
  VadLike,
  VadSettings
} from './windows-asr-pipeline'
import { ASR_SAMPLE_RATE, VAD_WINDOW_SAMPLES } from './windows-asr-pipeline'

/** The subset of sherpa-onnx-node the Windows engine uses. */
export interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => OfflineRecognizerLike<OfflineStreamLike>
  Vad: new (config: unknown, bufferSizeInSeconds: number) => VadLike
}

/**
 * Thread budget per recognizer, chosen from the Dev04 benchmark: two intra-op
 * threads keep two-channel live decoding well under real time while leaving
 * the remaining cores to capture, the UI and notes generation.
 */
export const LIVE_DECODE_THREADS = 2
export const BATCH_DECODE_THREADS = 4

export function loadSherpa(): SherpaModule {
  loadWindowsAsrRuntime()
  // Deferred require: the native addon must not load before the runtime is pinned.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('sherpa-onnx-node') as SherpaModule
}

/**
 * ONNX Runtime session options for the speech models, read by sherpa-onnx from
 * a `cpu:<file>` provider string. Without the CPU arena and memory patterns,
 * the live worker's peak memory over the Dev04 two-channel benchmark fell from
 * 2.39 GB to 1.71 GB for about 6% more decode time.
 */
export const SESSION_OPTIONS = 'EnableCpuMemArena=0\nEnableMemPattern=0\n'

/** Write (once) the session options file; each worker kind owns its own file. */
export function ensureSessionOptions(modelsDir: string, kind: 'live' | 'batch'): string {
  const path = join(modelsDir, `sherpa-cpu-session-${kind}.config`)
  if (existsSync(path) && readFileSync(path, 'utf8') === SESSION_OPTIONS) return path
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, SESSION_OPTIONS)
  renameSync(temporary, path)
  return path
}

/** Parakeet (NeMo transducer) offline recognizer configuration. */
export function parakeetRecognizerConfig(
  dir: string,
  numThreads: number,
  sessionOptions?: string
): Record<string, unknown> {
  return {
    featConfig: { sampleRate: ASR_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads,
      provider: sessionOptions ? `cpu:${sessionOptions}` : 'cpu',
      debug: 0,
      modelType: 'nemo_transducer'
    },
    decodingMethod: 'greedy_search'
  }
}

export function sileroVadConfig(model: string, settings: VadSettings): Record<string, unknown> {
  return {
    sileroVad: {
      model,
      threshold: settings.threshold,
      minSilenceDuration: settings.minSilenceSec,
      minSpeechDuration: settings.minSpeechSec,
      maxSpeechDuration: settings.maxSpeechSec,
      windowSize: VAD_WINDOW_SAMPLES
    },
    sampleRate: ASR_SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0
  }
}

/** Silero keeps every sample of an utterance in progress; cover the longest one. */
export function vadBufferSeconds(settings: VadSettings): number {
  return Math.max(60, settings.maxSpeechSec * 3)
}
