import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  VOICE_ENROLL_SECONDS,
  type VoiceEnrollEvent,
  type VoiceEnrollOutcome,
  type VoiceProfile
} from '../shared/dictation-api'
import type { VoiceEnrollProgress, VoiceEnrollRun } from './engine-process'

/** The part of the engine host that records a voice. */
export interface VoiceEngine {
  readonly enrolling: boolean
  enrollVoice(opts: {
    outPath: string
    inputDevice?: string | null
    seconds: number
    onProgress: (progress: VoiceEnrollProgress) => void
  }): VoiceEnrollRun | null
}

/** Read what the page shows about a voiceprint file; null when it is missing or unreadable. */
export function readVoiceProfile(path: string): VoiceProfile | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (!Array.isArray(raw.embedding) || raw.embedding.length === 0) return null
    return {
      createdAt:
        typeof raw.createdAtMs === 'number' && Number.isFinite(raw.createdAtMs)
          ? raw.createdAtMs
          : 0,
      deviceName: typeof raw.deviceName === 'string' && raw.deviceName ? raw.deviceName : null
    }
  } catch {
    return null
  }
}

/**
 * The voice behind "Only my voice": userData/dictation-voiceprint.json, written
 * by the engine. It holds numbers that describe how the voice sounds and how
 * loud it was — no audio and no words — and it never leaves this Mac.
 */
export class DictationVoice {
  private readonly path: string
  private cached: VoiceProfile | null
  private run: VoiceEnrollRun | null = null

  constructor(
    userDataDir: string,
    private readonly engine: VoiceEngine | null
  ) {
    this.path = join(userDataDir, 'dictation-voiceprint.json')
    this.cached = readVoiceProfile(this.path)
  }

  profile(): VoiceProfile | null {
    return this.cached
  }

  /** The file for the engine to filter by; null until a voice has been recorded. */
  voiceprintPath(): string | null {
    return this.cached ? this.path : null
  }

  get enrolling(): boolean {
    return this.run !== null
  }

  async enroll(
    inputDevice: string | null,
    onEvent: (event: VoiceEnrollEvent) => void
  ): Promise<VoiceEnrollOutcome> {
    if (!this.engine) return { ok: false, reason: 'unavailable' }
    if (this.run) return { ok: false, reason: 'busy' }
    const run = this.engine.enrollVoice({
      outPath: this.path,
      inputDevice,
      seconds: VOICE_ENROLL_SECONDS,
      onProgress: (progress) => {
        switch (progress.type) {
          case 'download':
            onEvent({ type: 'preparing', progress: progress.progress })
            break
          case 'recording':
            onEvent({ type: 'recording' })
            break
          case 'level':
            // The same curve as the pill's meter.
            onEvent({ type: 'level', level: Math.min(1, Math.sqrt(progress.peak) * 1.3) })
            break
          case 'analysing':
            onEvent({ type: 'analysing' })
            break
        }
      }
    })
    if (!run) return { ok: false, reason: 'busy' }
    this.run = run
    onEvent({ type: 'preparing' })
    try {
      const result = await run.result
      // A failed attempt leaves the previous voice in place: the engine only
      // replaces the file once it has a new one.
      this.cached = readVoiceProfile(this.path)
      if (!result.ok) return { ok: false, reason: result.reason }
      return this.cached ? { ok: true } : { ok: false, reason: 'failed' }
    } finally {
      this.run = null
    }
  }

  finish(): void {
    this.run?.finish()
  }

  cancel(): void {
    this.run?.cancel()
  }

  remove(): void {
    this.run?.cancel()
    try {
      rmSync(this.path, { force: true })
    } catch {
      // Best-effort; the profile is reported gone either way and re-read on next launch.
    }
    this.cached = null
  }
}
