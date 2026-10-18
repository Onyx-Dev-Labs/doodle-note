import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localSourceScope } from '@repo/meetings-store/sources'
import { retrieveOriginalEvidence } from '@repo/meetings-store/evidence'
import type { CitedAnswerSnapshot } from '../shared/cited-ask-api'
import { CitedSourceAudio } from './cited-source-audio'

function fixture(t: test.TestContext): {
  adapter: CitedSourceAudio
  snapshot(): CitedAnswerSnapshot
  id(snapshot: CitedAnswerSnapshot): string
  original: {
    id: string
    title: string
    rawNotesMarkdown: string
    segments: Array<{
      id: string
      channel: string
      text: string
      startMs: number
      endMs: number
      absoluteStartMs: number
    }>
  }
  put(): void
  file: string
  part(session: string, start: number, duration?: number): string
  audioDir: string
  meetingsDir: string
  expire(): void
} {
  const root = mkdtempSync(join(tmpdir(), 'dev507-audio-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const meetingsDir = join(root, 'meetings')
  const audioDir = join(root, 'audio')
  mkdirSync(meetingsDir)
  mkdirSync(audioDir)
  let now = 1000
  const adapter = new CitedSourceAudio(
    () => ({ meetingsDir, audioDir }),
    () => {},
    () => now
  )
  const original = {
    id: 'one',
    title: 'Synthetic',
    rawNotesMarkdown: 'Orchid original note.',
    segments: [
      {
        id: 'segment-a',
        channel: 'mic',
        text: 'Orchid ships Friday.',
        startMs: 500,
        endMs: 1500,
        absoluteStartMs: 2000500
      }
    ]
  }
  const file = join(meetingsDir, 'one.json')
  const put = (): void => writeFileSync(file, JSON.stringify(original))
  put()
  const scope = localSourceScope(meetingsDir, true)
  const snapshot = (): CitedAnswerSnapshot => {
    const evidence = retrieveOriginalEvidence(
      { meetingsDir, scope, authorized: true },
      { mode: 'question', question: 'Orchid', filters: {} }
    )
    return {
      version: 1,
      runId: 'run',
      purpose: 'library-ask',
      requestSha256: 'a'.repeat(64),
      askedAt: '2026-10-18T00:00:00Z',
      status: 'answered',
      claims: [],
      evidence,
      prompt: {
        ranges: evidence.ranges.map((r) => ({ ...r, parentRangeId: r.id })),
        omittedRangeIds: [],
        budgetComplete: true,
        inputTokens: 100,
        contextWindowTokens: 16384,
        outputReserveTokens: 4096,
        safetyMarginTokens: 256,
        accounting: 'tokenizer',
        wireSha256: 'b'.repeat(64)
      },
      engineId: 'local:synthetic',
      modelArtifactRevision: 'synthetic',
      promptVersion: 1
    }
  }
  const part = (session: string, start: number, duration = 5000): string => {
    const dir = join(audioDir, 'one', session)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'audio.wav'), `synthetic-${session}`)
    writeFileSync(
      join(dir, 'part.json'),
      JSON.stringify({ startEpochMs: start, durationMs: duration, channels: 'split' })
    )
    return dir
  }
  const id = (s: CitedAnswerSnapshot): string =>
    s.prompt!.ranges.find((r) => r.anchor.kind === 'transcript')!.id
  return {
    adapter,
    snapshot,
    id,
    original,
    put,
    file,
    part,
    audioDir,
    meetingsDir,
    expire: () => {
      now += 300001
    }
  }
}

test('trusted original absolute timing selects the second real part and exact seek without rewriting originals', async (t) => {
  const f = fixture(t)
  f.part('1000000', 1000000)
  f.part('2000000', 2000000)
  const before = readFileSync(f.file)
  const s = f.snapshot()
  const audio = await f.adapter.available(s, f.id(s))
  assert.equal(audio.status, 'available')
  if (audio.status !== 'available') return
  const playback = await f.adapter.play(audio.token, s, f.id(s))
  assert.equal(playback.seekSeconds, 0.5)
  assert.equal(Buffer.from(playback.bytes).toString(), 'synthetic-2000000')
  assert.equal(playback.mime, 'audio/wav')
  assert.deepEqual(readFileSync(f.file), before)
  f.expire()
  await assert.rejects(f.adapter.play(audio.token, s, f.id(s)), /unavailable/)
})

test('missing metadata, imported text, absent absolute time and overlapping parts cannot guess a seek', async (t) => {
  const f = fixture(t)
  const dir = f.part('2000000', 2000000)
  let s = f.snapshot()
  rmSync(join(dir, 'part.json'))
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'unavailable')
  f.part('2000000', 2000000)
  f.part('2000001', 2000001)
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'ambiguous')
  rmSync(join(f.audioDir, 'one', '2000001'), { recursive: true })
  delete (f.original.segments[0] as { absoluteStartMs?: number }).absoluteStartMs
  f.put()
  s = f.snapshot()
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'unavailable')
  Object.assign(f.original.segments[0]!, {
    source: 'text',
    channel: 'text',
    absoluteStartMs: 2000500
  })
  f.put()
  s = f.snapshot()
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'unavailable')
  const personal = s.prompt!.ranges.find((r) => r.anchor.kind === 'personal')!
  assert.equal((await f.adapter.available(s, personal.id)).status, 'unavailable')
})

test('playback rejects changed original, replaced/deleted recording, wrong range and library identity', async (t) => {
  const f = fixture(t)
  const dir = f.part('2000000', 2000000)
  const s = f.snapshot()
  const available = await f.adapter.available(s, f.id(s))
  assert.equal(available.status, 'available')
  if (available.status !== 'available') return
  const token = available.token
  await assert.rejects(
    f.adapter.play(token, s, s.prompt!.ranges.find((r) => r.anchor.kind === 'personal')!.id)
  )
  writeFileSync(join(dir, 'audio.wav'), 'replacement recording')
  await assert.rejects(f.adapter.play(token, s, f.id(s)))
  const renewed = await f.adapter.available(s, f.id(s))
  assert.equal(renewed.status, 'available')
  if (renewed.status !== 'available') return
  f.original.segments[0]!.absoluteStartMs += 100
  f.put()
  await assert.rejects(f.adapter.play(renewed.token, s, f.id(s)))
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'unavailable')
  const current = f.snapshot()
  rmSync(join(dir, 'audio.wav'))
  assert.equal((await f.adapter.available(current, f.id(current))).status, 'unavailable')
  f.part('2000000', 2000000)
  writeFileSync(
    join(f.meetingsDir, '.doodlenote-source-library.json'),
    JSON.stringify({ version: 1, libraryId: 'changed' })
  )
  assert.equal((await f.adapter.available(current, f.id(current))).status, 'unavailable')
})

test('recording symlinks and ambiguous file choices are never exposed', async (t) => {
  const f = fixture(t)
  const dir = f.part('2000000', 2000000)
  const s = f.snapshot()
  writeFileSync(join(dir, 'audio.m4a'), 'other')
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'ambiguous')
  rmSync(join(dir, 'audio.m4a'))
  rmSync(join(dir, 'audio.wav'))
  symlinkSync(f.file, join(dir, 'audio.wav'))
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'unavailable')
})

test('persisted overlapping timing remains unsafe when one recording is missing or deleted', async (t) => {
  const f = fixture(t)
  f.part('2000000', 2000000)
  const overlap = f.part('2000001', 2000001)
  const s = f.snapshot()
  assert.equal((await f.adapter.available(s, f.id(s))).status, 'ambiguous')
  rmSync(join(overlap, 'audio.wav'))
  assert.notEqual((await f.adapter.available(s, f.id(s))).status, 'available')
})

test('an existing token cannot survive a new overlapping metadata-only part', async (t) => {
  const f = fixture(t)
  f.part('2000000', 2000000)
  const s = f.snapshot()
  const a = await f.adapter.available(s, f.id(s))
  assert.equal(a.status, 'available')
  if (a.status !== 'available') return
  const overlap = f.part('2000001', 2000001)
  rmSync(join(overlap, 'audio.wav'))
  await assert.rejects(f.adapter.play(a.token, s, f.id(s)), /unavailable/)
})

test('known nonoverlapping missing recording preserves the unique valid part', async (t) => {
  const f = fixture(t)
  const earlier = f.part('1000000', 1000000)
  rmSync(join(earlier, 'audio.wav'))
  f.part('2000000', 2000000)
  const s = f.snapshot()
  const a = await f.adapter.available(s, f.id(s))
  assert.equal(a.status, 'available')
  if (a.status !== 'available') return
  assert.equal(
    Buffer.from((await f.adapter.play(a.token, s, f.id(s))).bytes).toString(),
    'synthetic-2000000'
  )
})
