/**
 * Windows transcription engine — the counterpart of the Swift sidecar,
 * running as an Electron utilityProcess (plain Node). On-device ASR via
 * sherpa-onnx on the CPU: Silero VAD utterances decoded by NVIDIA Parakeet
 * 0.6b (int8) — Unified for live captions and TDT v2/v3 for imports, the same
 * models the Mac uses for each. Audio arrives as 16 kHz
 * mono Float32 frames from the renderer's capture (WASAPI loopback + mic via
 * Chromium), and events go back to the host shaped exactly like the Swift
 * engine's NDJSON — channel_start / partial / timings / final / done — so the
 * segmenter, renderer, and sync pipeline need zero changes.
 *
 * Protocol (parentPort messages):
 *   in:  {t:'init', modelsDir, quality?, parakeetModel?} — download/load models once
 *        {t:'start', channels:[...]}      — begin a session
 *        {t:'audio', channel, samples}    — 16k mono Float32Array frame
 *        {t:'stop'}                       — finish session (emit finals+done)
 *   out: {t:'event', event:{...}}         — engine event object
 */
import { join } from 'node:path'
import {
  PARAKEET_UNIFIED,
  SILERO_VAD,
  ensureWindowsAsrModels,
  parakeetSpec,
  windowsAsrModelMissing
} from './windows-asr-models'
import {
  BATCH_DECODE_THREADS,
  LIVE_DECODE_THREADS,
  ensureSessionOptions,
  loadSherpa,
  parakeetRecognizerConfig,
  sileroVadConfig,
  vadBufferSeconds,
  type SherpaModule
} from './windows-asr-recognizers'
import {
  BATCH_VAD,
  DecodeLoadMonitor,
  LIVE_VAD,
  UtteranceTranscriber,
  type OfflineRecognizerLike,
  type OfflineStreamLike
} from './windows-asr-pipeline'
import { calibrationSignal, liveCaptionMode, type LiveCaptionMode } from './windows-asr-guard'

interface AudioMessage {
  t: 'audio'
  sessionId?: number
  channel: string
  samples: Float32Array
  /** Batch imports use an acknowledgement for IPC backpressure. */
  sequence?: number
  /** Live: Date.now() when the host forwarded the frame (lag measurement). */
  sentAt?: number
}

type InMessage =
  | { t: 'init'; modelsDir: string; quality?: 'live' | 'final'; parakeetModel?: 'v2' | 'v3' }
  | { t: 'start'; channels: string[]; sessionId?: number }
  | AudioMessage
  | { t: 'stop'; sessionId?: number }

const port = process.parentPort

function emit(event: Record<string, unknown>): void {
  port.postMessage({ t: 'event', event })
}

/** Lag (seconds behind capture) after which the recorder says captions are delayed. */
const DELAYED_LAG_SEC = 5

let sherpa: SherpaModule | null = null
let recognizer: OfflineRecognizerLike<OfflineStreamLike> | null = null
let vadModel = ''
let quality: 'live' | 'final' = 'live'
let captionMode: LiveCaptionMode = 'interim'
let pipelines = new Map<string, UtteranceTranscriber>()
let sessionActive = false
let activeSessionId: number | null = null
let delayedNotified = false

async function init(
  modelsDir: string,
  requestedQuality: 'live' | 'final' = 'live',
  parakeetModel: 'v2' | 'v3' = 'v2'
): Promise<void> {
  try {
    quality = requestedQuality
    // Live: the Mac's live model (Parakeet Unified). Batch: the Mac's batch
    // setting (Parakeet TDT v2 English or v3 multilingual).
    const asr = quality === 'live' ? PARAKEET_UNIFIED : parakeetSpec(parakeetModel)
    const specs = [asr, SILERO_VAD]
    const missing = specs.filter((spec) => windowsAsrModelMissing(modelsDir, spec))
    if (missing.length > 0) {
      emit({
        event: 'status',
        stage: 'downloading_model',
        model: asr.name,
        bytes: missing.reduce((sum, spec) => sum + spec.bytes, 0)
      })
    }
    const [asrDir, vadDir] = await ensureWindowsAsrModels(modelsDir, specs, (progress) =>
      emit({ event: 'download', progress: Math.floor(progress * 100) / 100 })
    )
    vadModel = join(vadDir!, 'silero_vad.onnx')
    emit({ event: 'status', stage: 'serve_loading_models', model: asr.name })
    sherpa = loadSherpa()
    recognizer = new sherpa.OfflineRecognizer(
      parakeetRecognizerConfig(
        asrDir!,
        quality === 'live' ? LIVE_DECODE_THREADS : BATCH_DECODE_THREADS,
        ensureSessionOptions(modelsDir, quality === 'live' ? 'live' : 'batch')
      )
    )
    let calibrationRtf: number | undefined
    if (quality === 'live') {
      // Measure this machine once: the decode cost decides whether live
      // captions can afford interim updates (see windows-asr-guard.ts).
      const signal = calibrationSignal()
      const began = performance.now()
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: signal, sampleRate: 16_000 })
      recognizer.decode(stream)
      recognizer.getResult(stream)
      calibrationRtf = (performance.now() - began) / 1000 / (signal.length / 16_000)
      captionMode = liveCaptionMode(calibrationRtf)
    }
    emit({
      event: 'status',
      stage: 'serve_ready',
      model: asr.name,
      ...(calibrationRtf !== undefined
        ? { calibrationRtf: Math.round(calibrationRtf * 1000) / 1000, captionMode }
        : {})
    })
  } catch (err) {
    console.error('[win-asr] init failed:', err)
    emit({
      event: 'error',
      message:
        err instanceof Error &&
        /verification|download|incomplete|unpacked|stalled|HTTP/i.test(err.message)
          ? `${err.message} Check your connection, then try again.`
          : `The speech model could not be prepared: ${String(err)}`
    })
  }
}

function startSession(channels: string[], sessionId = 0): void {
  if (!recognizer || !sherpa) {
    emit({ event: 'error', message: 'engine is not ready yet' })
    emit({ event: 'done' })
    return
  }
  if (sessionActive) {
    emit({ event: 'error', message: 'a session is already active' })
    return
  }
  sessionActive = true
  activeSessionId = sessionId
  delayedNotified = false
  const live = quality === 'live'
  const settings = live ? LIVE_VAD : BATCH_VAD
  const load = new DecodeLoadMonitor()
  pipelines = new Map(
    channels.map((channel) => [
      channel,
      new UtteranceTranscriber(
        recognizer!,
        new sherpa!.Vad(sileroVadConfig(vadModel, settings), vadBufferSeconds(settings)),
        {
          channel,
          interim: live && captionMode === 'interim',
          vadSettings: settings,
          load,
          realtime: live,
          now: () => Date.now(),
          emit
        }
      )
    ])
  )
  emit({ event: 'ready', mode: quality, channels })
  emit({ event: 'status', stage: 'transcribing' })
}

function stopSession(sessionId = 0): void {
  if (!sessionActive || activeSessionId !== sessionId) return
  sessionActive = false
  emit({ event: 'status', stage: 'finishing' })
  for (const pipeline of pipelines.values()) {
    try {
      pipeline.finish(quality === 'final' ? { audioSeconds: pipeline.stats.audioSeconds } : {})
    } catch (err) {
      emit({ event: 'error', channel: pipeline.channel, message: `finish failed: ${String(err)}` })
    }
  }
  pipelines = new Map()
  activeSessionId = null
  emit({ event: 'done' })
}

function ingest(data: AudioMessage): void {
  const pipeline = pipelines.get(data.channel)
  if (!pipeline) return
  try {
    pipeline.ingest(data.samples, typeof data.sentAt === 'number' ? data.sentAt : undefined)
  } catch (err) {
    emit({ event: 'error', channel: data.channel, message: `transcription failed: ${String(err)}` })
    return
  }
  if (quality === 'live' && !delayedNotified && pipeline.lagSec() > DELAYED_LAG_SEC) {
    // Never fall behind silently: the recorder tells the person captions are
    // late. All audio is still transcribed and saved.
    delayedNotified = true
    emit({ event: 'status', stage: 'captions_delayed', channel: data.channel })
  }
}

port.on('message', (message: Electron.MessageEvent) => {
  const data = message.data as InMessage
  switch (data.t) {
    case 'init':
      void init(data.modelsDir, data.quality, data.parakeetModel)
      break
    case 'start':
      startSession(data.channels, data.sessionId)
      break
    case 'audio': {
      if (sessionActive && activeSessionId === (data.sessionId ?? 0)) {
        if (data.samples instanceof Float32Array && data.samples.length > 0) ingest(data)
      }
      if (typeof data.sequence === 'number') {
        port.postMessage({ t: 'ack', sequence: data.sequence })
      }
      break
    }
    case 'stop':
      stopSession(data.sessionId)
      break
  }
})
