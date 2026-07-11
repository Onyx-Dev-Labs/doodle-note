import { spawn } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { ipcMain, protocol } from 'electron'
import {
  AUDIO_CLEAR_ALL_CHANNEL,
  AUDIO_DELETE_CHANNEL,
  AUDIO_LIST_CHANNEL,
  AUDIO_USAGE_CHANNEL,
  type AudioPart,
  type AudioUsage
} from '../shared/audio-api'
import type { EngineAudioEvent } from '../shared/engine-events'
import { parseByteRange } from './audio-range'
import { isWinCheckpointDir, mergeWinSession } from './win-audio-recorder'

/** Merged session audio: m4a from the Swift engine, wav from the Windows tee. */
const AUDIO_FILES = ['audio.m4a', 'audio.wav'] as const
const AUDIO_MIME: Record<string, string> = {
  'audio.m4a': 'audio/mp4',
  'audio.wav': 'audio/wav'
}

/** The merged audio file present in a session dir, if any. */
function audioFileIn(dir: string): string | null {
  for (const name of AUDIO_FILES) {
    if (existsSync(join(dir, name))) return name
  }
  return null
}

/** Meeting ids are desktop-minted UUIDs; session dirs are epoch-ms stamps. */
const SAFE_MEETING_ID = /^[A-Za-z0-9-]+$/
const SAFE_SESSION_DIR = /^\d+$/

/**
 * Owns saved meeting audio: userData/audio/<meetingId>/<sessionEpochMs>/audio.m4a.
 *
 * The engine writes crash-safe checkpoint chunks into the session directory
 * while recording and merges them into audio.m4a on a clean stop. This service
 * hands out session directories, records part metadata when the engine reports
 * a merge, recovers orphaned checkpoint directories after a crash (same merge,
 * run via `engine merge-audio`), serves files to the renderer over the
 * doodle-audio:// protocol (with Range support — <audio> seeking needs it),
 * and deletes recordings with their meeting.
 *
 * Everything here is local-only: no path under baseDir is ever synced.
 */
export class AudioService {
  /** Session dir handed to the engine for the active capture, if any. */
  private activeSessionDir: string | null = null

  constructor(
    private readonly baseDir: string,
    private readonly engineBinary: string
  ) {}

  registerIpc(): void {
    ipcMain.handle(AUDIO_LIST_CHANNEL, (_event, meetingId: unknown) =>
      this.list(String(meetingId ?? ''))
    )
    ipcMain.handle(AUDIO_DELETE_CHANNEL, (_event, meetingId: unknown) =>
      this.deleteFor(String(meetingId ?? ''))
    )
    ipcMain.handle(AUDIO_CLEAR_ALL_CHANNEL, () => this.clearAll())
    ipcMain.handle(AUDIO_USAGE_CHANNEL, () => this.usage())
  }

  /** Call after app ready (protocol.handle requires it). */
  registerProtocol(): void {
    protocol.handle('doodle-audio', (request) => {
      // doodle-audio://<meetingId>/<sessionEpochMs>/<audio.m4a|audio.wav>
      const url = new URL(request.url)
      const meetingId = url.host
      const [, session, file] = url.pathname.split('/')
      if (
        !SAFE_MEETING_ID.test(meetingId) ||
        !SAFE_SESSION_DIR.test(session ?? '') ||
        !file ||
        !(AUDIO_FILES as readonly string[]).includes(file)
      ) {
        return new Response('bad audio path', { status: 400 })
      }
      const path = join(this.baseDir, meetingId, session as string, file)
      let size: number
      try {
        size = statSync(path).size
      } catch {
        return new Response('not found', { status: 404 })
      }

      const headers: Record<string, string> = {
        'Content-Type': AUDIO_MIME[file] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes'
      }
      // Seeking: Chromium asks for byte ranges once it knows the file length.
      const range = parseByteRange(request.headers.get('range'), size)
      if (range === 'unsatisfiable') {
        return new Response('bad range', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` }
        })
      }
      if (range) {
        const { start, end } = range
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
        headers['Content-Length'] = String(end - start + 1)
        return new Response(
          Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream,
          { status: 206, headers }
        )
      }
      headers['Content-Length'] = String(size)
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers })
    })
  }

  /**
   * A fresh session directory for a live capture into this meeting; the
   * engine creates it (and its checkpoints/) on first write.
   */
  beginSession(meetingId: string): string | null {
    if (!SAFE_MEETING_ID.test(meetingId)) return null
    const dir = join(this.baseDir, meetingId, String(Date.now()))
    this.activeSessionDir = dir
    return dir
  }

  /**
   * The engine merged the active session's audio — persist the part metadata
   * next to the file so list() can report timing without probing the audio.
   */
  onAudioSaved(event: EngineAudioEvent): void {
    const dir = this.activeSessionDir
    this.activeSessionDir = null
    if (!dir || audioFileIn(dir) === null) return
    this.writePartMeta(dir, event.startEpochMs ?? 0, event.durationMs)
  }

  list(meetingId: string): AudioPart[] {
    if (!SAFE_MEETING_ID.test(meetingId)) return []
    const meetingDir = join(this.baseDir, meetingId)
    let sessions: string[]
    try {
      sessions = readdirSync(meetingDir).filter((name) => SAFE_SESSION_DIR.test(name))
    } catch {
      return []
    }
    const parts: AudioPart[] = []
    for (const session of sessions.sort()) {
      const dir = join(meetingDir, session)
      const file = audioFileIn(dir)
      if (file === null) continue
      let startEpochMs = Number(session)
      let durationMs = 0
      try {
        const meta = JSON.parse(readFileSync(join(dir, 'part.json'), 'utf8')) as {
          startEpochMs?: number
          durationMs?: number
        }
        // The engine's epoch (first captured frame) beats the dir stamp
        // (session start request) — it's what transcript times align to.
        if (typeof meta.startEpochMs === 'number' && meta.startEpochMs > 0) {
          startEpochMs = meta.startEpochMs
        }
        if (typeof meta.durationMs === 'number') durationMs = meta.durationMs
      } catch {
        // part.json is best-effort; the dir stamp is close enough to seek by.
      }
      parts.push({
        url: `doodle-audio://${meetingId}/${session}/${file}`,
        startEpochMs,
        durationMs
      })
    }
    return parts
  }

  deleteFor(meetingId: string): void {
    if (!SAFE_MEETING_ID.test(meetingId)) return
    rmSync(join(this.baseDir, meetingId), { recursive: true, force: true })
  }

  clearAll(): void {
    rmSync(this.baseDir, { recursive: true, force: true })
  }

  usage(): AudioUsage {
    let totalBytes = 0
    let meetingCount = 0
    let meetings: string[]
    try {
      meetings = readdirSync(this.baseDir)
    } catch {
      return { totalBytes: 0, meetingCount: 0 }
    }
    for (const meeting of meetings) {
      const parts = this.list(meeting)
      if (parts.length === 0) continue
      meetingCount += 1
      for (const session of readdirSync(join(this.baseDir, meeting))) {
        const file = audioFileIn(join(this.baseDir, meeting, session))
        if (file === null) continue // orphan — counted by recovery, not usage
        try {
          totalBytes += statSync(join(this.baseDir, meeting, session, file)).size
        } catch {
          // vanished between scan and stat
        }
      }
    }
    return { totalBytes, meetingCount }
  }

  /**
   * Post-crash recovery: any session directory still holding checkpoints but
   * no merged audio.m4a belongs to a session that never finished. Run the
   * engine's merge on each — the same code path a clean stop uses. Sequential
   * and off the critical launch path; failures leave the checkpoints in place
   * for the next launch to retry.
   */
  async recoverOrphans(): Promise<void> {
    const orphans: string[] = []
    let meetings: string[]
    try {
      meetings = readdirSync(this.baseDir)
    } catch {
      return // no audio dir yet
    }
    for (const meeting of meetings) {
      if (!SAFE_MEETING_ID.test(meeting)) continue
      let sessions: string[]
      try {
        sessions = readdirSync(join(this.baseDir, meeting))
      } catch {
        continue
      }
      for (const session of sessions) {
        if (!SAFE_SESSION_DIR.test(session)) continue
        const dir = join(this.baseDir, meeting, session)
        if (audioFileIn(dir) !== null) continue
        if (!existsSync(join(dir, 'checkpoints'))) {
          // Neither merged audio nor checkpoints: a session that never
          // captured a frame (e.g. permissions denied). Just tidy up.
          rmSync(dir, { recursive: true, force: true })
          continue
        }
        orphans.push(dir)
      }
    }
    for (const dir of orphans) {
      console.log('[audio] recovering crashed session:', dir)
      // Windows sessions checkpoint raw PCM (merged in-process); macOS
      // sessions checkpoint CAF (merged by the Swift engine binary).
      const saved = isWinCheckpointDir(join(dir, 'checkpoints'))
        ? await mergeWinSession(dir).catch(() => null)
        : existsSync(this.engineBinary)
          ? await this.mergeWithEngine(dir)
          : null
      if (saved) {
        this.writePartMeta(dir, saved.startEpochMs ?? 0, saved.durationMs)
        console.log('[audio] recovered', `${Math.round(saved.durationMs / 1000)}s`, 'of audio')
      }
    }
  }

  /** Run `engine merge-audio --dir <dir>` and parse its audio event. */
  private mergeWithEngine(
    dir: string
  ): Promise<{ durationMs: number; startEpochMs?: number } | null> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.engineBinary, ['merge-audio', '--dir', dir], {
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch {
        resolve(null)
        return
      }
      let out = ''
      let settled = false
      const finish = (result: EngineAudioEvent | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }
      // Merges run at disk speed; even hours-long sessions finish well inside this.
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        finish(null)
      }, 120_000)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        out += chunk
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        const line = chunk.trim()
        if (line.length > 0) console.error(`[audio recover] ${line}`)
      })
      child.on('error', () => finish(null))
      child.on('close', () => {
        for (const line of out.split('\n')) {
          try {
            const parsed = JSON.parse(line) as EngineAudioEvent
            if (parsed.event === 'audio' && typeof parsed.durationMs === 'number') {
              finish(parsed)
              return
            }
          } catch {
            // not the audio line
          }
        }
        finish(null)
      })
    })
  }

  private writePartMeta(dir: string, startEpochMs: number, durationMs: number): void {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'part.json'), JSON.stringify({ startEpochMs, durationMs }))
    } catch (err) {
      console.error('[audio] failed to write part metadata:', err)
    }
  }
}
