import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'

/**
 * Windows counterpart of the Swift engine's SessionRecorder (pure Node — no
 * Electron imports, so it's unit-testable anywhere).
 *
 * The renderer captures 16kHz mono Float32 frames and ships them to the main
 * process for transcription; this class tees those frames into rotating ~30s
 * raw-PCM checkpoint files under `<dir>/checkpoints/`, one series per channel,
 * plus a manifest recording each channel's wall-clock start. On a clean stop
 * the checkpoints merge into `<dir>/audio.wav` (16-bit PCM, left = mic "You",
 * right = system "Them", epoch-aligned) and are deleted. A directory holding
 * checkpoints but no merged audio is a crashed session — recoverable later
 * with `mergeWinSession`, the same function a clean stop uses.
 */

const SAMPLE_RATE = 16_000
const CHUNK_FRAMES = 30 * SAMPLE_RATE
/** Mic on the left, system on the right; anything unexpected sorts after. */
const CHANNEL_ORDER = ['mic', 'system']
const SAFE_CHANNEL = /^[a-z]+$/

export interface WinMergedAudio {
  durationMs: number
  startEpochMs: number
}

interface ChannelState {
  fd: number | null
  chunkFrames: number
  chunkIndex: number
  /** Persistence died (disk full etc.) — drop frames, keep transcribing. */
  dead: boolean
}

export class WinSessionRecorder {
  private readonly channels = new Map<string, ChannelState>()
  private readonly epochs: Record<string, number> = {}

  constructor(readonly dir: string) {}

  private get checkpointsDir(): string {
    return join(this.dir, 'checkpoints')
  }

  /** Called with each renderer PCM frame; must never throw into capture. */
  write(channel: string, samples: Float32Array): void {
    if (!SAFE_CHANNEL.test(channel) || samples.length === 0) return
    let state = this.channels.get(channel)
    if (!state) {
      state = { fd: null, chunkFrames: 0, chunkIndex: 0, dead: false }
      this.channels.set(channel, state)
      this.epochs[channel] = Date.now()
      this.writeManifest()
    }
    if (state.dead) return
    try {
      if (state.fd === null) {
        mkdirSync(this.checkpointsDir, { recursive: true })
        state.chunkIndex += 1
        const name = `${channel}-${String(state.chunkIndex).padStart(6, '0')}.f32`
        state.fd = openSync(join(this.checkpointsDir, name), 'w')
        state.chunkFrames = 0
      }
      writeSync(state.fd, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
      state.chunkFrames += samples.length
      if (state.chunkFrames >= CHUNK_FRAMES) {
        closeSync(state.fd)
        state.fd = null // rotate: bounded loss window if the process dies
      }
    } catch (err) {
      console.error(`[win-audio] ${channel} checkpoint write failed — audio saving disabled:`, err)
      if (state.fd !== null) {
        try {
          closeSync(state.fd)
        } catch {
          // already gone
        }
        state.fd = null
      }
      state.dead = true
    }
  }

  /** Close chunk files and merge to audio.wav. Null if nothing was captured. */
  async finish(): Promise<WinMergedAudio | null> {
    this.abort()
    return mergeWinSession(this.dir)
  }

  /** Close chunk files WITHOUT merging (session superseded / app quitting);
   *  the checkpoints stay on disk for next-launch recovery. */
  abort(): void {
    for (const state of this.channels.values()) {
      if (state.fd !== null) {
        try {
          closeSync(state.fd)
        } catch {
          // already gone
        }
        state.fd = null
      }
    }
  }

  private writeManifest(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(
        join(this.dir, 'manifest.json'),
        JSON.stringify({
          version: 1,
          sampleRate: SAMPLE_RATE,
          channels: Object.fromEntries(
            Object.entries(this.epochs).map(([ch, epochMs]) => [ch, { epochMs }])
          )
        })
      )
    } catch {
      // Alignment metadata is best-effort; merge falls back to zero offsets.
    }
  }
}

/**
 * Merge a session directory's raw-PCM checkpoints into audio.wav and delete
 * them. Safe on a directory left behind by a crash. Yields to the event loop
 * between blocks so an hours-long meeting doesn't stall the main process.
 */
export async function mergeWinSession(dir: string): Promise<WinMergedAudio | null> {
  const checkpointsDir = join(dir, 'checkpoints')
  let names: string[]
  try {
    names = readdirSync(checkpointsDir)
  } catch {
    return null
  }

  const chunksByChannel = new Map<string, string[]>()
  for (const name of names) {
    const match = /^([a-z]+)-\d{6}\.f32$/.exec(name)
    if (!match) continue
    const list = chunksByChannel.get(match[1]!) ?? []
    list.push(join(checkpointsDir, name))
    chunksByChannel.set(match[1]!, list)
  }
  if (chunksByChannel.size === 0) return null

  let epochs: Record<string, number> = {}
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      channels?: Record<string, { epochMs?: number }>
    }
    epochs = Object.fromEntries(
      Object.entries(manifest.channels ?? {}).flatMap(([ch, info]) =>
        typeof info.epochMs === 'number' ? [[ch, info.epochMs]] : []
      )
    )
  } catch {
    // No manifest — merge with zero offsets.
  }
  const baseEpoch = Math.min(...Object.values(epochs), Infinity)
  const startEpochMs = Number.isFinite(baseEpoch) ? baseEpoch : 0

  const channels = [...chunksByChannel.keys()].sort((a, b) => {
    const ia = CHANNEL_ORDER.indexOf(a) === -1 ? CHANNEL_ORDER.length : CHANNEL_ORDER.indexOf(a)
    const ib = CHANNEL_ORDER.indexOf(b) === -1 ? CHANNEL_ORDER.length : CHANNEL_ORDER.indexOf(b)
    return ia === ib ? a.localeCompare(b) : ia - ib
  })
  const readers = channels.map((channel) => {
    const offsetMs = Math.max(0, (epochs[channel] ?? startEpochMs) - startEpochMs)
    return new ChannelChunkReader(
      chunksByChannel.get(channel)!.sort(),
      Math.round((offsetMs * SAMPLE_RATE) / 1000)
    )
  })

  const outChannels = Math.min(readers.length, 2)
  const totalFrames = Math.max(...readers.map((r) => r.totalFrames))
  if (totalFrames === 0) return null

  const outPath = join(dir, 'audio.wav')
  const fd = openSync(outPath, 'w')
  try {
    writeSync(fd, wavHeader(totalFrames, outChannels))
    const blockFrames = 65_536
    const channelBuf = readers.map(() => new Float32Array(blockFrames))
    const pcm = Buffer.alloc(blockFrames * 2 * outChannels)
    for (let frame = 0; frame < totalFrames; frame += blockFrames) {
      const n = Math.min(blockFrames, totalFrames - frame)
      readers.forEach((reader, i) => {
        channelBuf[i]!.fill(0)
        reader.fill(channelBuf[i]!, n)
      })
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < outChannels; c++) {
          // Extra source channels (never expected) fold onto the right.
          const foldExtras = c === outChannels - 1 && readers.length > outChannels
          const v = foldExtras ? mixExtra(channelBuf, outChannels, i) : channelBuf[c]![i]!
          const clamped = Math.max(-1, Math.min(1, v))
          pcm.writeInt16LE(Math.round(clamped * 32_767), (i * outChannels + c) * 2)
        }
      }
      writeSync(fd, pcm, 0, n * 2 * outChannels)
      // Keep the main process responsive during long merges.
      await new Promise((resolve) => setImmediate(resolve))
    }
  } finally {
    closeSync(fd)
  }

  rmSync(checkpointsDir, { recursive: true, force: true })
  rmSync(join(dir, 'manifest.json'), { force: true })
  return {
    durationMs: Math.round((totalFrames * 1000) / SAMPLE_RATE),
    startEpochMs
  }
}

/** Sum of channels beyond the stereo pair for one frame (rare fold-down). */
function mixExtra(channelBuf: Float32Array[], outChannels: number, i: number): number {
  let v = 0
  for (let c = outChannels - 1; c < channelBuf.length; c++) v += channelBuf[c]![i]!
  return v
}

function wavHeader(frames: number, channels: number): Buffer {
  const dataBytes = frames * 2 * channels
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // linear PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2 * channels, 28) // byte rate
  header.writeUInt16LE(2 * channels, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  return header
}

/** Streams one channel's chunks (with alignment silence) as flat frames. */
class ChannelChunkReader {
  readonly totalFrames: number
  private silenceRemaining: number
  private fileIndex = 0
  private fd: number | null = null
  private readonly scratch = Buffer.alloc(65_536 * 4)

  constructor(
    private readonly files: string[],
    silencePrefixFrames: number
  ) {
    this.silenceRemaining = silencePrefixFrames
    let frames = silencePrefixFrames
    for (const file of files) {
      try {
        frames += Math.floor(statSync(file).size / 4)
      } catch {
        // unreadable chunk — skipped at read time too
      }
    }
    this.totalFrames = frames
  }

  /** Fill the first `frames` entries of `target` (already zeroed). */
  fill(target: Float32Array, frames: number): void {
    let produced = 0
    while (produced < frames) {
      if (this.silenceRemaining > 0) {
        const n = Math.min(this.silenceRemaining, frames - produced)
        this.silenceRemaining -= n
        produced += n // target is pre-zeroed
        continue
      }
      if (this.fd === null) {
        if (this.fileIndex >= this.files.length) return
        try {
          this.fd = openSync(this.files[this.fileIndex]!, 'r')
        } catch {
          this.fileIndex += 1
          continue
        }
        this.fileIndex += 1
      }
      const wantBytes = Math.min((frames - produced) * 4, this.scratch.length)
      let got = 0
      try {
        got = readSync(this.fd, this.scratch, 0, wantBytes, null)
      } catch {
        got = 0
      }
      if (got < 4) {
        closeSync(this.fd)
        this.fd = null
        continue
      }
      const gotFrames = Math.floor(got / 4)
      for (let i = 0; i < gotFrames; i++) {
        target[produced + i] = this.scratch.readFloatLE(i * 4)
      }
      produced += gotFrames
    }
  }
}

/** True when a session dir's checkpoints are the Windows raw-PCM format. */
export function isWinCheckpointDir(checkpointsDir: string): boolean {
  if (!existsSync(checkpointsDir)) return false
  try {
    return readdirSync(checkpointsDir).some((name) => name.endsWith('.f32'))
  } catch {
    return false
  }
}
