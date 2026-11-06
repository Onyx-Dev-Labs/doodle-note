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

/** What the engine writes and will accept; anything else it refuses to filter by. */
const VOICEPRINT_VERSION = 1
const VOICEPRINT_MODEL = 'wespeaker-v2'
const VOICEPRINT_SIZE = 256

/**
 * Read what the page shows about a voiceprint file. Null when it is missing,
 * unreadable, or not something the engine would filter by: the switch must
 * never read "on" for a file that silently filters nothing.
 */
export function readVoiceProfile(path: string): VoiceProfile | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (raw.version !== VOICEPRINT_VERSION || raw.model !== VOICEPRINT_MODEL) return null
    if (!Array.isArray(raw.embedding) || raw.embedding.length !== VOICEPRINT_SIZE) return null
    if (!raw.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return null
    }
    // A real embedding is unit length; the engine refuses anything far from it.
    const norm = Math.hypot(...(raw.embedding as number[]))
    if (!(norm > 0.5 && norm < 2)) return null
    if (typeof raw.levelDb !== 'number' || !(raw.levelDb >= -120 && raw.levelDb <= 20)) return null
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

  async remove(): Promise<void> {
    // A recording that is running could still save a voice after the file is
    // deleted: stop it and wait for it to be gone first.
    const run = this.run
    if (run) {
      run.cancel()
      await run.result.catch(() => undefined)
    }
    for (const path of [this.path, `${this.path}.tmp`]) {
      try {
        rmSync(path, { force: true })
      } catch {
        // Best-effort; the profile is reported gone either way and re-read on next launch.
      }
    }
    this.cached = null
  }
}
