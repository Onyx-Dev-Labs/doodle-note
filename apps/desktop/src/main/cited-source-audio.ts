import { createHash, randomUUID } from 'node:crypto'
import { constants, realpath as realpathCallback } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { localSourceScope, projectSources, sameScope } from '@repo/meetings-store/sources'
import { isRecord } from '@repo/meetings-store/evidence'
import type { CitedAnswerSnapshot, CitationView, CitedAudioPlayback } from '../shared/cited-ask-api'
import { AUDIO_FILES, playbackMime } from './import-media'

// Match the manifest's realpathSync semantics. Promise realpath uses native
// canonicalization, which can change filesystem case/Windows short-path spelling.
const realpath = promisify(realpathCallback)

type Availability = Extract<CitationView, { status: 'resolved' }>['audio']
interface Mapping {
  key: string
  path: string
  stamp: string
  mime: string
  seekSeconds: number
}
const hash = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')
const unavailable = (): Error =>
  new Error('Recording playback is unavailable. Reopen the original and retry.')
const stamp = (s: { ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string =>
  `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`

/** Main-only playback capabilities. Consumer MUST validate its current request before/after play. */
export class CitedSourceAudio {
  private readonly tokens = new Map<string, { mapping: Mapping; expires: number }>()
  constructor(
    private readonly roots: () => { meetingsDir: string; audioDir: string },
    private readonly assertAvailable: () => void,
    private readonly now: () => number = Date.now
  ) {}
  invalidate(): void {
    this.tokens.clear()
  }
  private prune(): void {
    for (const [token, entry] of this.tokens)
      if (entry.expires <= this.now()) this.tokens.delete(token)
    while (this.tokens.size >= 128) this.tokens.delete(this.tokens.keys().next().value!)
  }
  async available(snapshot: CitedAnswerSnapshot, evidenceId: string): Promise<Availability> {
    try {
      const result = await this.map(snapshot, evidenceId)
      if (typeof result === 'string') return { status: result }
      this.prune()
      for (const [token, entry] of this.tokens) {
        if (entry.mapping.key === result.key) return { status: 'available', token }
      }
      const token = randomUUID()
      this.tokens.set(token, { mapping: result, expires: this.now() + 300_000 })
      return { status: 'available', token }
    } catch {
      return { status: 'unavailable' }
    }
  }
  async play(
    token: unknown,
    snapshot: CitedAnswerSnapshot,
    evidenceId: string
  ): Promise<CitedAudioPlayback> {
    if (typeof token !== 'string') throw unavailable()
    const entry = this.tokens.get(token)
    if (!entry || entry.expires <= this.now()) {
      this.tokens.delete(token)
      throw unavailable()
    }
    const current = await this.map(snapshot, evidenceId)
    if (typeof current === 'string' || current.key !== entry.mapping.key) throw unavailable()
    const bytes = await this.read(current.path, 256 * 1024 * 1024, current.stamp)
    const after = await this.map(snapshot, evidenceId)
    if (
      typeof after === 'string' ||
      after.key !== current.key ||
      this.tokens.get(token) !== entry ||
      entry.expires <= this.now()
    )
      throw unavailable()
    return { bytes, mime: current.mime, seekSeconds: current.seekSeconds }
  }
  private async read(path: string, limit: number, expected?: string): Promise<Buffer> {
    if ((await realpath(path)) !== path) throw unavailable()
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat({ bigint: true })
      if (
        !before.isFile() ||
        before.size > BigInt(limit) ||
        (expected && stamp(before) !== expected)
      )
        throw unavailable()
      const bytes = await file.readFile()
      if (
        (await realpath(path)) !== path ||
        stamp(await file.stat({ bigint: true })) !== stamp(before)
      )
        throw unavailable()
      return bytes
    } finally {
      await file.close()
    }
  }
  private async directory(path: string): Promise<void> {
    const s = await lstat(path)
    if (!s.isDirectory() || s.isSymbolicLink()) throw unavailable()
  }
  private async map(
    snapshot: CitedAnswerSnapshot,
    evidenceId: string
  ): Promise<Mapping | 'unavailable' | 'ambiguous'> {
    this.assertAvailable()
    const range = snapshot.prompt?.ranges.find((r) => r.id === evidenceId)
    if (
      !range ||
      range.anchor.kind !== 'transcript' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(range.anchor.meetingId)
    )
      return 'unavailable'
    const requested = this.roots()
    const meetingsDir = await realpath(requested.meetingsDir)
    const audioDir = await realpath(requested.audioDir)
    const manifest = snapshot.evidence.manifest
    if (
      hash(meetingsDir) !== manifest.pathBindingSha256 ||
      !sameScope(localSourceScope(meetingsDir), range.anchor) ||
      !sameScope(manifest.scope, range.anchor)
    )
      return 'unavailable'
    const file = join(meetingsDir, range.anchor.meetingId + '.json')
    const bytes = await this.read(file, 64 * 1024 * 1024)
    const dependency = manifest.dependencies.find((d) => d.meetingId === range.anchor.meetingId)
    if (!dependency || hash(bytes) !== dependency.rawSha256) return 'unavailable'
    const raw: unknown = JSON.parse(bytes.toString('utf8'))
    if (!isRecord(raw) || raw.id !== range.anchor.meetingId || !Array.isArray(raw.segments))
      return 'unavailable'
    const projected = projectSources(raw, manifest.scope)
    const passage = projected?.passages.find(
      (p) => p.anchor.sourceId === range.anchor.sourceId && p.anchor.kind === 'transcript'
    )
    if (
      !passage ||
      projected?.revisionId !== range.anchor.revisionId ||
      passage.text.slice(range.startUtf16, range.endUtf16) !== range.quote
    )
      return 'unavailable'
    // Use the existing canonical source identity; never invent a segment or choose by text.
    const segments = raw.segments.filter(
      (segment, index) =>
        isRecord(segment) &&
        (typeof segment.id === 'string' && segment.id
          ? `transcript:${segment.id}`
          : `legacy-transcript:${index}`) === range.anchor.sourceId
    )
    if (segments.length !== 1 || !isRecord(segments[0])) return 'unavailable'
    const segment = segments[0]
    if (
      (segment.source !== undefined && segment.source !== 'audio') ||
      (segment.channel !== 'mic' && segment.channel !== 'system') ||
      segment.echo ||
      typeof segment.absoluteStartMs !== 'number' ||
      !Number.isFinite(segment.absoluteStartMs) ||
      segment.absoluteStartMs <= 0 ||
      typeof segment.startMs !== 'number' ||
      !Number.isFinite(segment.startMs) ||
      segment.startMs < 0 ||
      typeof segment.endMs !== 'number' ||
      !Number.isFinite(segment.endMs) ||
      segment.endMs <= segment.startMs
    )
      return 'unavailable'
    if (isRecord(raw.savedAudioFailures) && raw.savedAudioFailures[segment.channel] === true)
      return 'unavailable'
    const absolute = segment.absoluteStartMs
    const absoluteEnd = absolute + segment.endMs - segment.startMs
    const meetingDir = join(audioDir, range.anchor.meetingId)
    await this.directory(meetingDir)
    const sessions = (await readdir(meetingDir)).filter((s) => /^\d+$/.test(s)).sort()
    if (sessions.length > 1000) return 'unavailable'
    const matches: Array<{
      path: string
      stamp: string
      mime: string
      start: number
      metadata: string
    }> = []
    let incomplete = false
    for (const session of sessions) {
      const dir = join(meetingDir, session)
      try {
        await this.directory(dir)
        const names = (await readdir(dir)).filter((name) =>
          (AUDIO_FILES as readonly string[]).includes(name)
        )
        // Persisted timing remains a mapping candidate even when recording bytes
        // were deleted. Missing audio must not make another overlapping part unique.
        const metaBytes = await this.read(join(dir, 'part.json'), 64 * 1024)
        const meta: unknown = JSON.parse(metaBytes.toString('utf8'))
        if (
          !isRecord(meta) ||
          typeof meta.startEpochMs !== 'number' ||
          !Number.isFinite(meta.startEpochMs) ||
          meta.startEpochMs <= 0 ||
          typeof meta.durationMs !== 'number' ||
          !Number.isFinite(meta.durationMs) ||
          meta.durationMs <= 0
        )
          throw unavailable()
        if (absolute < meta.startEpochMs || absolute >= meta.startEpochMs + meta.durationMs)
          continue
        if (!names.length) return 'unavailable'
        if (names.length !== 1) return 'ambiguous'
        if (meta.channels !== 'split' || absoluteEnd > meta.startEpochMs + meta.durationMs)
          return 'unavailable'
        const path = join(dir, names[0]!)
        const info = await lstat(path, { bigint: true })
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          info.size <= 0 ||
          info.size > 256n * 1024n * 1024n
        )
          throw unavailable()
        matches.push({
          path,
          stamp: stamp(info),
          mime: playbackMime(names[0]!),
          start: meta.startEpochMs,
          metadata: hash(metaBytes)
        })
      } catch {
        incomplete = true
      }
    }
    // An unreadable part could overlap the chosen timestamp: never infer uniqueness.
    if (incomplete) return 'unavailable'
    if (matches.length > 1) return 'ambiguous'
    if (matches.length !== 1) return 'unavailable'
    const part = matches[0]!
    this.assertAvailable()
    const latest = this.roots()
    if (
      (await realpath(latest.meetingsDir)) !== meetingsDir ||
      (await realpath(latest.audioDir)) !== audioDir ||
      !sameScope(localSourceScope(meetingsDir), manifest.scope) ||
      hash(await this.read(file, 64 * 1024 * 1024)) !== dependency.rawSha256
    )
      return 'unavailable'
    return {
      key: hash(
        JSON.stringify([
          snapshot.runId,
          snapshot.requestSha256,
          range,
          meetingsDir,
          audioDir,
          dependency.rawSha256,
          part
        ])
      ),
      path: part.path,
      stamp: part.stamp,
      mime: part.mime,
      seekSeconds: (absolute - part.start) / 1000
    }
  }
}
