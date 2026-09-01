import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import {
  ENGINE_BATCH_CONTROL_CHANNEL,
  ENGINE_BATCH_DATA_CHANNEL,
  ENGINE_BATCH_READ_CHANNEL,
  type EngineBatchMessage,
  type EngineChannel,
  type EngineTokenTiming,
  type TranscriptSegment
} from '../shared/engine-events'
import type { WizardPreflightEvent, WizardPreflightResult } from '../shared/wizard-api'
import type { BatchProgress, BatchTranscription } from './import-logic'
import { SegmentAssembler } from './segmenter'

const TIMEOUT_MS = 30 * 60_000
/** Chromium decodes the complete file in memory; this still covers hours of compressed audio. */
const MAX_DECODE_BYTES = 512 * 1024 * 1024

interface ActiveJob {
  id: string
  filePath: string
  rendererId: number | null
  child: UtilityProcess
  assembler: SegmentAssembler
  segments: TranscriptSegment[]
  audioSeconds: number
  started: boolean
  settled: boolean
  timeout: NodeJS.Timeout
  nextSequence: number
  pendingAck: {
    sequence: number
    resolve: () => void
    reject: (error: Error) => void
  } | null
  onProgress?: (progress: BatchProgress) => void
  resolve: (result: BatchTranscription) => void
  reject: (error: Error) => void
}

/**
 * Windows imported-audio transcription without an extra media binary.
 * Chromium decodes WAV/MP3/M4A/MP4 in the renderer, resamples it to 16 kHz, and
 * streams PCM here. A dedicated sherpa utility process transcribes the file,
 * so importing never interrupts the persistent live-meeting engine.
 */
export class WinBatchTranscriber {
  private active: ActiveJob | null = null

  constructor(
    private readonly ensureEngineReady: (
      onEvent?: (event: WizardPreflightEvent) => void
    ) => Promise<WizardPreflightResult>
  ) {}

  registerIpc(): void {
    ipcMain.handle(ENGINE_BATCH_READ_CHANNEL, (event, jobId: unknown) => {
      const job = this.active
      if (!job || job.id !== String(jobId) || job.rendererId !== event.sender.id) {
        throw new Error('That audio import is no longer active.')
      }
      return readFile(job.filePath)
    })
    ipcMain.handle(ENGINE_BATCH_DATA_CHANNEL, (event, payload: unknown) => {
      const job = this.active
      const message = payload as EngineBatchMessage
      if (!job || message?.jobId !== job.id || job.rendererId !== event.sender.id) {
        throw new Error('That audio import is no longer active.')
      }
      return this.handleRendererMessage(job, message)
    })
  }

  transcribe(
    filePath: string,
    onProgress?: (progress: BatchProgress) => void
  ): Promise<BatchTranscription> {
    if (this.active) return Promise.reject(new Error('Another Windows transcription is running.'))
    return new Promise((resolve, reject) => {
      void this.start(filePath, onProgress, resolve, reject)
    })
  }

  private async start(
    filePath: string,
    onProgress: ((progress: BatchProgress) => void) | undefined,
    resolve: (result: BatchTranscription) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    onProgress?.({ stage: 'starting' })
    try {
      if ((await stat(filePath)).size > MAX_DECODE_BYTES) {
        reject(new Error('Windows can import recordings up to 512 MB.'))
        return
      }
    } catch (error) {
      reject(new Error(`Could not read that audio file: ${String(error)}`))
      return
    }
    const readiness = await this.ensureEngineReady((event) => {
      if (event.stage === 'download') {
        onProgress?.({ stage: 'downloading_model', progress: event.progress })
      }
    })
    if (!readiness.ok) {
      reject(new Error(readiness.error ?? 'The Windows transcription engine is not ready.'))
      return
    }

    let child: UtilityProcess
    try {
      child = utilityProcess.fork(join(__dirname, 'engine-win.js'), [], {
        serviceName: 'doodlenote-import-engine'
      })
    } catch (error) {
      reject(new Error(`Could not start the Windows import engine: ${String(error)}`))
      return
    }

    const job: ActiveJob = {
      id: randomUUID(),
      filePath,
      rendererId: null,
      child,
      assembler: new SegmentAssembler(),
      segments: [],
      audioSeconds: 0,
      started: false,
      settled: false,
      timeout: setTimeout(() => {}, TIMEOUT_MS),
      nextSequence: 0,
      pendingAck: null,
      onProgress,
      resolve,
      reject
    }
    clearTimeout(job.timeout)
    job.timeout = setTimeout(
      () => this.finish(job, new Error('Transcription timed out.')),
      TIMEOUT_MS
    )
    job.timeout.unref()
    this.active = job

    child.on('message', (message: unknown) => {
      if (this.active !== job) return
      const data = message as { t?: string; sequence?: number; event?: Record<string, unknown> }
      const pending = job.pendingAck
      if (data.t === 'ack' && pending && data.sequence === pending.sequence) {
        job.pendingAck = null
        pending.resolve()
        return
      }
      if (data.t === 'event' && data.event) this.handleEngineEvent(job, data.event)
    })
    child.on('exit', () => {
      if (this.active === job && !job.settled) {
        this.finish(job, new Error('The Windows import engine stopped unexpectedly.'))
      }
    })
    child.postMessage({ t: 'init', modelsDir: join(app.getPath('userData'), 'asr-models') })
  }

  private handleEngineEvent(job: ActiveJob, event: Record<string, unknown>): void {
    if (event.event === 'status' && event.stage === 'serve_ready') {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!window || window.isDestroyed()) {
        this.finish(job, new Error('Open DoodleNote to import an audio file.'))
        return
      }
      job.rendererId = window.webContents.id
      window.webContents.send(ENGINE_BATCH_CONTROL_CHANNEL, { action: 'decode', jobId: job.id })
      return
    }
    if (event.event === 'status' && event.stage === 'transcribing') {
      job.onProgress?.({ stage: 'transcribing' })
      return
    }
    if (
      event.event === 'timings' &&
      typeof event.channel === 'string' &&
      Array.isArray(event.tokens)
    ) {
      job.segments.push(
        ...job.assembler.addTimings(
          event.channel as EngineChannel,
          event.tokens as EngineTokenTiming[]
        )
      )
      return
    }
    if (event.event === 'final' && typeof event.channel === 'string') {
      job.segments.push(...job.assembler.flush(event.channel as EngineChannel))
      return
    }
    if (event.event === 'error') {
      this.finish(job, new Error(String(event.message ?? 'Windows transcription failed.')))
      return
    }
    if (event.event === 'done') this.finish(job)
  }

  private async handleRendererMessage(job: ActiveJob, message: EngineBatchMessage): Promise<void> {
    switch (message.type) {
      case 'begin': {
        const channels = message.channels.filter(
          (channel): channel is EngineChannel => channel === 'mic' || channel === 'system'
        )
        if (channels.length === 0) {
          this.finish(job, new Error('No decodable audio channels were found.'))
          return
        }
        job.audioSeconds = Math.max(0, message.audioSeconds)
        job.started = true
        job.child.postMessage({ t: 'start', channels })
        break
      }
      case 'audio':
        if (job.started && message.samples instanceof Float32Array && message.samples.length > 0) {
          if (job.pendingAck) throw new Error('The Windows import decoder sent audio too quickly.')
          const sequence = job.nextSequence++
          await new Promise<void>((resolve, reject) => {
            job.pendingAck = { sequence, resolve, reject }
            job.child.postMessage({
              t: 'audio',
              channel: message.channel,
              samples: message.samples,
              sequence
            })
          })
        }
        break
      case 'end':
        if (job.started) job.child.postMessage({ t: 'stop' })
        break
      case 'error':
        this.finish(job, new Error(message.message))
        break
    }
  }

  private finish(job: ActiveJob, error?: Error): void {
    if (job.settled) return
    job.settled = true
    clearTimeout(job.timeout)
    job.pendingAck?.reject(error ?? new Error('The Windows import engine stopped.'))
    job.pendingAck = null
    job.child.kill()
    if (this.active === job) this.active = null
    if (error) {
      job.reject(error)
      return
    }
    job.segments.push(...job.assembler.flush())
    job.segments.sort((a, b) => a.startMs - b.startMs)
    job.resolve({ segments: job.segments, audioSeconds: job.audioSeconds })
  }

  dispose(): void {
    const job = this.active
    if (!job) return
    this.finish(job, new Error('DoodleNote closed before the import completed.'))
  }
}
