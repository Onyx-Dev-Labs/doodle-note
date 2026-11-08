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
 *        {t:'helper-hold'|'helper-trust'|'helper-confirm'|'helper-release', id, path?}
 *                                         — Bark's helper check (windows-helper-check.ts)
 *   out: {t:'event', event:{...}}         — engine event object
 *        {t:'helper', id, op, ...}        — the helper check's replies
 *
 * An updated install whose Parakeet model is not downloaded yet uses the
 * cached streaming Zipformer from earlier builds for live captions (see
 * windows-asr-legacy.ts) and downloads Parakeet in the background.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PARAKEET_UNIFIED,
  SILERO_VAD,
  ensureWindowsAsrModels,
  modelContentMatches,
  parakeetSpec,
  removeWindowsAsrModel,
  windowsAsrModelMissing,
  type WindowsAsrModelSpec
} from './windows-asr-models'
import {
  BATCH_DECODE_THREADS,
  LIVE_DECODE_THREADS,
  ensureSessionOptions,
  loadSherpa,
  parakeetRecognizerConfig,
  sileroVadConfig,
  vadBufferSeconds,
  windowsFfi,
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
import {
  LEGACY_ZIPFORMER,
  LegacyStreamingChannel,
  legacyRecognizerConfig,
  legacyZipformerInstalled,
  type LegacyRecognizer
} from './windows-asr-legacy'
import { EchoOrderGate } from './windows-asr-echo-gate'
import { HelperChecker, type FfiLike } from './windows-helper-check'

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
  | {
      t: 'init'
      modelsDir: string
      quality?: 'live' | 'final'
      parakeetModel?: 'v2' | 'v3'
      /** A reload after an idle close reuses the first calibration. */
      calibration?: { calibrationRtf: number; captionMode: LiveCaptionMode }
    }
  | { t: 'start'; channels: string[]; sessionId?: number }
  | AudioMessage
  | { t: 'stop'; sessionId?: number }
  | { t: 'helper-hold'; id: number; path: string }
  | { t: 'helper-trust' | 'helper-confirm' | 'helper-release'; id: number }

interface ChannelTranscriber {
  readonly channel: string
  ingest(samples: Float32Array, queuedAt?: number): void
  finish(extra?: Record<string, unknown>): void
  lagSec(): number
  settledThroughSec(): number
}

const port = process.parentPort

function emit(event: Record<string, unknown>): void {
  port.postMessage({ t: 'event', event })
}

/**
 * QA hook (packaged-app smoke only, inert unless set): stall the first decode
 * of each live session for this many milliseconds to force a real backlog.
 */
const TEST_STALL_MS = Number(process.env.DOODLENOTE_ASR_TEST_STALL_MS ?? 0)

function withTestStall(
  model: OfflineRecognizerLike<OfflineStreamLike>
): OfflineRecognizerLike<OfflineStreamLike> {
  if (!(TEST_STALL_MS > 0)) return model
  let stalled = false
  return {
    createStream: () => model.createStream(),
    getResult: (stream) => model.getResult(stream),
    decode: (stream) => {
      if (!stalled) {
        stalled = true
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, TEST_STALL_MS)
      }
      model.decode(stream)
    }
  }
}

/** Frames waiting longer than this make the recorder say captions are late... */
const DELAYED_LAG_SEC = 5
/** ...until every channel has stayed under this for CAUGHT_UP_HOLD_MS... */
const CAUGHT_UP_LAG_SEC = 1
const CAUGHT_UP_HOLD_MS = 5_000
/** ...and the notice has been up at least this long (no flicker). */
const DELAYED_MIN_SHOWN_MS = 10_000

let sherpa: SherpaModule | null = null
let recognizer: OfflineRecognizerLike<OfflineStreamLike> | null = null
let legacy: LegacyRecognizer | null = null
let vadModel = ''
let modelsRoot = ''
let quality: 'live' | 'final' = 'live'
let captionMode: LiveCaptionMode = 'interim'
let pipelines = new Map<string, ChannelTranscriber>()
let gate: EchoOrderGate | null = null
let sessionActive = false
let activeSessionId: number | null = null
let captionsDelayed = false
let delayedAt = 0
let caughtUpSince: number | null = null
/** Parakeet finished downloading during a legacy session; switch after it. */
let knownCalibration: { calibrationRtf: number; captionMode: LiveCaptionMode } | null = null
let pendingUpgrade: { asrDir: string; vadDir: string } | null = null
/** Legacy mode only: the background Parakeet download. */
let upgradeState: 'downloading' | 'failed' | 'done' = 'done'

function loadingMarker(spec: WindowsAsrModelSpec): string {
  return join(modelsRoot, `.${spec.name}.loading`)
}

/**
 * Load a model, repairing a damaged copy. A load that threw, or a previous
 * load that never finished (the worker died inside the native loader), makes
 * the engine hash the files; a mismatch deletes the folder and downloads it
 * again. Size checks alone cannot see a corrupt file of the right length.
 */
async function loadWithRepair<T>(
  spec: WindowsAsrModelSpec,
  ensure: () => Promise<string>,
  build: (dir: string) => T
): Promise<T> {
  const marker = loadingMarker(spec)
  let dir = await ensure()
  if (existsSync(marker) && !(await modelContentMatches(dir, spec))) {
    console.error(`[win-asr] ${spec.name} failed verification after an interrupted load; repairing`)
    removeWindowsAsrModel(modelsRoot, spec)
    dir = await ensure()
  }
  writeFileSync(marker, '')
  try {
    const built = build(dir)
    rmSync(marker, { force: true })
    return built
  } catch (error) {
    if (await modelContentMatches(dir, spec)) {
      rmSync(marker, { force: true })
      throw error
    }
    console.error(`[win-asr] ${spec.name} is damaged; downloading it again`)
    removeWindowsAsrModel(modelsRoot, spec)
    dir = await ensure()
    const built = build(dir)
    rmSync(marker, { force: true })
    return built
  }
}

function calibrate(model: OfflineRecognizerLike<OfflineStreamLike>): number {
  // Measure this machine once: the decode cost decides whether live captions
  // can afford interim updates (see windows-asr-guard.ts).
  const signal = calibrationSignal()
  const began = performance.now()
  const stream = model.createStream()
  stream.acceptWaveform({ samples: signal, sampleRate: 16_000 })
  model.decode(stream)
  model.getResult(stream)
  return (performance.now() - began) / 1000 / (signal.length / 16_000)
}

async function loadParakeet(
  asr: WindowsAsrModelSpec,
  ensureAsr: () => Promise<string>,
  vadDir: string
): Promise<{ calibrationRtf?: number }> {
  vadModel = join(vadDir, 'silero_vad.onnx')
  sherpa ??= loadSherpa()
  const threads = quality === 'live' ? LIVE_DECODE_THREADS : BATCH_DECODE_THREADS
  const options = ensureSessionOptions(modelsRoot, quality === 'live' ? 'live' : 'batch')
  recognizer = await loadWithRepair(
    asr,
    ensureAsr,
    (dir) => new sherpa!.OfflineRecognizer(parakeetRecognizerConfig(dir, threads, options))
  )
  legacy = null
  if (quality !== 'live') return {}
  if (knownCalibration) {
    // Calibrating again while a recording waits on this reload would measure
    // a busy machine and delay the first decode.
    captionMode = knownCalibration.captionMode
    return { calibrationRtf: knownCalibration.calibrationRtf }
  }
  const calibrationRtf = calibrate(recognizer)
  captionMode = liveCaptionMode(calibrationRtf)
  return { calibrationRtf: Math.round(calibrationRtf * 1000) / 1000 }
}

function initError(err: unknown): void {
  console.error('[win-asr] init failed:', err)
  emit({
    event: 'error',
    message:
      err instanceof Error &&
      /verification|download|incomplete|unpacked|stalled|HTTP|ENOTFOUND|ECONN|EAI_AGAIN/i.test(
        err.message
      )
        ? `The speech model could not be downloaded. ${err.message} Check your connection, then try again.`
        : `The speech model could not be prepared: ${String(err)}`
  })
}

async function init(
  modelsDir: string,
  requestedQuality: 'live' | 'final' = 'live',
  parakeetModel: 'v2' | 'v3' = 'v2'
): Promise<void> {
  modelsRoot = modelsDir
  quality = requestedQuality
  // Live: the Mac's live model (Parakeet Unified). Batch: the Mac's batch
  // setting (Parakeet TDT v2 English or v3 multilingual).
  const asr = quality === 'live' ? PARAKEET_UNIFIED : parakeetSpec(parakeetModel)
  const partialTag = quality === 'live' ? 'live' : 'batch'
  const missing = [asr, SILERO_VAD].filter((spec) => windowsAsrModelMissing(modelsDir, spec))

  if (quality === 'live' && missing.includes(asr) && legacyZipformerInstalled(modelsDir)) {
    // An updated install: record now with the cached model, upgrade later.
    try {
      sherpa ??= loadSherpa()
      legacy = new (sherpa.OnlineRecognizer as new (c: unknown) => LegacyRecognizer)(
        legacyRecognizerConfig(modelsDir)
      )
      captionMode = 'interim'
      emit({
        event: 'status',
        stage: 'serve_ready',
        model: LEGACY_ZIPFORMER.name,
        captionMode: 'legacy'
      })
    } catch (err) {
      initError(err)
      return
    }
    void upgradeInBackground(asr, partialTag)
    return
  }

  try {
    if (missing.length > 0) {
      emit({
        event: 'status',
        stage: 'downloading_model',
        model: asr.name,
        bytes: missing.reduce((sum, spec) => sum + spec.bytes, 0)
      })
    }
    const [, vadDir] = await ensureWindowsAsrModels(
      modelsDir,
      [asr, SILERO_VAD],
      (progress) => emit({ event: 'download', progress: Math.floor(progress * 100) / 100 }),
      { partialTag }
    )
    emit({ event: 'status', stage: 'serve_loading_models', model: asr.name })
    const ensureAsr = async (): Promise<string> =>
      (
        await ensureWindowsAsrModels(
          modelsDir,
          [asr],
          (progress) => emit({ event: 'download', progress: Math.floor(progress * 100) / 100 }),
          { partialTag }
        )
      )[0]!
    const loadStarted = performance.now()
    const { calibrationRtf } = await loadParakeet(asr, ensureAsr, vadDir!)
    emit({
      event: 'status',
      stage: 'serve_ready',
      model: asr.name,
      loadMs: Math.round(performance.now() - loadStarted),
      ...(calibrationRtf !== undefined ? { calibrationRtf, captionMode } : {})
    })
  } catch (err) {
    initError(err)
  }
}

/** Legacy mode: fetch Parakeet without blocking recording; switch between sessions. */
async function upgradeInBackground(asr: WindowsAsrModelSpec, partialTag: string): Promise<void> {
  upgradeState = 'downloading'
  // The host keeps a downloading worker alive (no idle unload) until it ends.
  emit({ event: 'status', stage: 'model_download', model: asr.name, progress: 0 })
  try {
    let last = -1
    const [asrDir, vadDir] = await ensureWindowsAsrModels(
      modelsRoot,
      [asr, SILERO_VAD],
      (progress) => {
        const percent = Math.floor(progress * 100)
        if (percent === last) return
        last = percent
        emit({ event: 'status', stage: 'model_download', model: asr.name, progress: percent / 100 })
      },
      { partialTag }
    )
    pendingUpgrade = { asrDir: asrDir!, vadDir: vadDir! }
    upgradeState = 'done'
    if (!sessionActive) await activateUpgrade()
  } catch (err) {
    // Stay on the cached model; the next app start tries again (and resumes).
    console.error('[win-asr] background model download failed:', err)
    upgradeState = 'failed'
    emit({ event: 'status', stage: 'model_download_failed', model: asr.name })
  }
}

async function activateUpgrade(): Promise<void> {
  const upgrade = pendingUpgrade
  if (!upgrade) return
  pendingUpgrade = null
  try {
    const { calibrationRtf } = await loadParakeet(
      PARAKEET_UNIFIED,
      async () => upgrade.asrDir,
      upgrade.vadDir
    )
    emit({
      event: 'status',
      stage: 'model_upgraded',
      model: PARAKEET_UNIFIED.name,
      calibrationRtf,
      captionMode
    })
  } catch (err) {
    console.error('[win-asr] could not switch to the new speech model:', err)
  }
}

function startSession(channels: string[], sessionId = 0): void {
  if ((!recognizer && !legacy) || !sherpa) {
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
  captionsDelayed = false
  const live = quality === 'live'
  const settings = live ? LIVE_VAD : BATCH_VAD
  const load = new DecodeLoadMonitor()
  const both = channels.includes('mic') && channels.includes('system')
  const sessionRecognizer = recognizer ? withTestStall(recognizer) : recognizer!
  // Live echo checks need system text committed before the mic copy of it.
  gate =
    live && both
      ? new EchoOrderGate(emit, () => pipelines.get('system')?.settledThroughSec() ?? 0)
      : null
  const route = gate ? (event: Record<string, unknown>) => gate!.push(event) : emit
  pipelines = new Map(
    channels.map((channel): [string, ChannelTranscriber] => [
      channel,
      legacy
        ? new LegacyStreamingChannel(channel, legacy, route)
        : new UtteranceTranscriber(
            live ? sessionRecognizer : recognizer!,
            new sherpa!.Vad(sileroVadConfig(vadModel, settings), vadBufferSeconds(settings)),
            {
              channel,
              interim: live && captionMode === 'interim',
              vadSettings: settings,
              load,
              realtime: live,
              now: () => Date.now(),
              emit: route
            }
          )
    ])
  )
  emit({ event: 'ready', mode: quality, channels })
  emit({ event: 'status', stage: 'transcribing' })
  if (legacy) {
    emit({
      event: 'status',
      stage: 'legacy_model',
      model: LEGACY_ZIPFORMER.name,
      download: upgradeState === 'failed' ? 'failed' : 'in_progress'
    })
  }
}

function stopSession(sessionId = 0): void {
  if (!sessionActive || activeSessionId !== sessionId) return
  sessionActive = false
  emit({ event: 'status', stage: 'finishing' })
  // The system channel first, so held mic timings can still be echo-checked.
  const ordered = [...pipelines.values()].sort((a, b) =>
    a.channel === 'system' ? -1 : b.channel === 'system' ? 1 : 0
  )
  for (const pipeline of ordered) {
    try {
      if (pipeline instanceof UtteranceTranscriber && quality === 'final') {
        pipeline.finish({ audioSeconds: pipeline.stats.audioSeconds })
      } else {
        if (pipeline.channel === 'mic') gate?.release(true)
        pipeline.finish()
      }
    } catch (err) {
      emit({ event: 'error', channel: pipeline.channel, message: `finish failed: ${String(err)}` })
    }
  }
  gate?.release(true)
  gate = null
  pipelines = new Map()
  activeSessionId = null
  emit({ event: 'done' })
  if (pendingUpgrade) void activateUpgrade()
  // A failed background download (offline, stalled) is retried, resuming its
  // partial file, after each recording on the previous model.
  else if (legacy && upgradeState === 'failed') void upgradeInBackground(PARAKEET_UNIFIED, 'live')
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
  // Every frame (either channel) re-checks the hold, including its time bound.
  gate?.release()
  if (quality !== 'live') return
  // Never fall behind silently: the recorder says captions are late while any
  // channel's frames wait more than 5 s, and clears it once all catch up.
  const lag = Math.max(...[...pipelines.values()].map((p) => p.lagSec()))
  const now = Date.now()
  if (!captionsDelayed && lag > DELAYED_LAG_SEC) {
    captionsDelayed = true
    delayedAt = now
    caughtUpSince = null
    emit({ event: 'status', stage: 'captions_delayed', channel: data.channel })
  } else if (captionsDelayed) {
    if (lag >= CAUGHT_UP_LAG_SEC) caughtUpSince = null
    else caughtUpSince ??= now
    if (
      caughtUpSince !== null &&
      now - caughtUpSince >= CAUGHT_UP_HOLD_MS &&
      now - delayedAt >= DELAYED_MIN_SHOWN_MS
    ) {
      captionsDelayed = false
      caughtUpSince = null
      emit({ event: 'status', stage: 'captions_caught_up' })
    }
  }
}

/** Bark's helper check: holds and verifies the helper file for the app (see windows-helper-check.ts). */
const helperChecker = new HelperChecker(() => windowsFfi() as unknown as FfiLike)

port.on('message', (message: Electron.MessageEvent) => {
  const data = message.data as InMessage
  switch (data.t) {
    case 'helper-hold':
      port.postMessage({
        t: 'helper',
        id: data.id,
        op: 'hold',
        ...helperChecker.hold(data.id, data.path)
      })
      break
    case 'helper-trust':
      void helperChecker.trust(data.id).then((reply) => {
        port.postMessage({ t: 'helper', id: data.id, op: 'trust', ...reply })
      })
      break
    case 'helper-confirm':
      port.postMessage({
        t: 'helper',
        id: data.id,
        op: 'confirm',
        held: helperChecker.held(data.id)
      })
      break
    case 'helper-release':
      helperChecker.release(data.id)
      break
    case 'init':
      knownCalibration = data.calibration ?? null
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
