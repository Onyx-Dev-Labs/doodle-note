import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { batchTranscribeArgs, transcribeFileToSegments } from './import-logic'

test('batchTranscribeArgs: only multilingual (v3) overrides the engine default', () => {
  assert.deepEqual(batchTranscribeArgs('/m.wav'), [
    'transcribe',
    '--file',
    '/m.wav',
    '--channels',
    'split'
  ])
  assert.deepEqual(batchTranscribeArgs('/m.wav', 'v2'), [
    'transcribe',
    '--file',
    '/m.wav',
    '--channels',
    'split'
  ])
  assert.deepEqual(batchTranscribeArgs('/m.wav', 'v3'), [
    'transcribe',
    '--file',
    '/m.wav',
    '--channels',
    'split',
    '--model',
    'v3'
  ])
})

/**
 * Integration test against the REAL engine binary and real speech (macOS
 * `say`). Skipped where the engine doesn't exist (CI, non-mac) — the logic
 * it exercises is mac-only anyway.
 */
const ENGINE = resolve(__dirname, '..', '..', '..', '..', 'engine', '.build', 'release', 'engine')
const MAKE_MP4 = resolve(__dirname, '..', '..', 'test-fixtures', 'make-mp4.swift')
const available = process.platform === 'darwin' && existsSync(ENGINE)

test('mono import: real speech becomes mic-channel segments', { skip: !available }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-test-'))
  try {
    const file = join(dir, 'memo.aiff')
    execFileSync('say', ['-o', file, 'The deployment finished without any errors last night'])
    const result = await transcribeFileToSegments(ENGINE, file)
    assert.ok(result.segments.length >= 1, 'produced segments')
    assert.ok(result.audioSeconds > 0)
    const text = result.segments
      .map((s) => s.text)
      .join(' ')
      .toLowerCase()
    assert.match(text, /deployment/)
    assert.match(text, /errors/)
    for (const segment of result.segments) {
      assert.equal(segment.channel, 'mic')
      assert.equal(segment.speaker, 'You')
      assert.ok(segment.endMs > segment.startMs)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stereo re-transcription: channels keep their speakers', { skip: !available }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-stereo-'))
  try {
    // Build a stereo file with distinct speech per channel, like our merged
    // meeting recordings (L = mic/You, R = system/Them).
    const left = join(dir, 'l.aiff')
    const right = join(dir, 'r.aiff')
    execFileSync('say', ['-o', left, 'We should review the budget together'])
    execFileSync('say', ['-o', right, 'The invoices were sent to the client yesterday'])
    const stereo = join(dir, 'stereo.wav')
    execFileSync('swift', [
      join(__dirname, '..', '..', 'test-fixtures', 'make-stereo.swift'),
      left,
      right,
      stereo
    ])

    const result = await transcribeFileToSegments(ENGINE, stereo)
    const micText = result.segments
      .filter((s) => s.channel === 'mic' && !s.echo)
      .map((s) => s.text)
      .join(' ')
      .toLowerCase()
    const systemText = result.segments
      .filter((s) => s.channel === 'system' && !s.echo)
      .map((s) => s.text)
      .join(' ')
      .toLowerCase()
    assert.match(micText, /budget/)
    assert.match(systemText, /invoices/)
    assert.doesNotMatch(micText, /invoices/)
    assert.doesNotMatch(systemText, /budget/)
    const speakers = new Set(result.segments.map((s) => `${s.channel}:${s.speaker}`))
    assert.ok(speakers.has('mic:You'))
    assert.ok(speakers.has('system:Them'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unreadable file rejects with a real error', { skip: !available }, async () => {
  await assert.rejects(
    () => transcribeFileToSegments(ENGINE, '/nonexistent/nope.wav'),
    /file not found|no content|error/i
  )
})

test('MP4 video import extracts speech from its audio track', { skip: !available }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-mp4-'))
  try {
    const speech = join(dir, 'speech.aiff')
    execFileSync('say', ['-o', speech, 'The deployment finished without any errors last night'])
    const video = join(dir, 'meeting.mp4')
    execFileSync('swift', [MAKE_MP4, video, speech])

    const result = await transcribeFileToSegments(ENGINE, video)
    const text = result.segments
      .map((segment) => segment.text)
      .join(' ')
      .toLowerCase()
    assert.match(text, /deployment/)
    assert.match(text, /errors/)
    assert.ok(result.audioSeconds > 0)
    assert.ok(result.segments.every((segment) => segment.channel === 'mic'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(
  'MP4 video without audio fails before creating transcript segments',
  { skip: !available },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-mp4-silent-'))
    try {
      const video = join(dir, 'silent.mp4')
      execFileSync('swift', [MAKE_MP4, video])
      await assert.rejects(
        () => transcribeFileToSegments(ENGINE, video),
        /no decodable audio track/i
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
