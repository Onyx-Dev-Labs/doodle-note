import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VOICE_ENROLL_SECONDS, type VoiceEnrollEvent } from '../shared/dictation-api'
import { DictationVoice, readVoiceProfile, type VoiceEngine } from './dictation-voice'
import type { VoiceEnrollProgress, VoiceEnrollResult } from './engine-process'

const voiceprint = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: 1,
    model: 'wespeaker-v2',
    embedding: Array.from({ length: 256 }, () => 0.0625),
    levelDb: -22,
    speechSeconds: 14,
    createdAtMs: 1_800_000_000_000,
    deviceName: 'USB Mic',
    ...extra
  })

/** An engine whose recording ends with `result`, writing a voiceprint first when it succeeds. */
function fakeEngine(result: VoiceEnrollResult): VoiceEngine & {
  calls: Array<{ outPath: string; inputDevice?: string | null; seconds: number }>
  progress: ((event: VoiceEnrollProgress) => void) | null
  finished: number
  cancelled: number
  settle: () => void
} {
  let resolve: ((result: VoiceEnrollResult) => void) | null = null
  const engine = {
    calls: [] as Array<{ outPath: string; inputDevice?: string | null; seconds: number }>,
    progress: null as ((event: VoiceEnrollProgress) => void) | null,
    finished: 0,
    cancelled: 0,
    enrolling: false,
    enrollVoice: (opts: Parameters<VoiceEngine['enrollVoice']>[0]) => {
      engine.calls.push({
        outPath: opts.outPath,
        inputDevice: opts.inputDevice,
        seconds: opts.seconds
      })
      engine.progress = opts.onProgress
      return {
        result: new Promise<VoiceEnrollResult>((done) => {
          resolve = done
        }),
        finish: () => void engine.finished++,
        cancel: () => void engine.cancelled++
      }
    },
    settle: () => {
      const call = engine.calls.at(-1)
      if (result.ok && call) writeFileSync(call.outPath, voiceprint())
      resolve?.(result)
    }
  }
  return engine
}

test('a voiceprint file is described without exposing the voice; damage reads as none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-voice-'))
  const path = join(dir, 'dictation-voiceprint.json')
  assert.equal(readVoiceProfile(path), null)
  writeFileSync(path, voiceprint())
  assert.deepEqual(readVoiceProfile(path), { createdAt: 1_800_000_000_000, deviceName: 'USB Mic' })
  writeFileSync(path, voiceprint({ deviceName: undefined, createdAtMs: 'soon' }))
  assert.deepEqual(readVoiceProfile(path), { createdAt: 0, deviceName: null })
  writeFileSync(path, '{ not json')
  assert.equal(readVoiceProfile(path), null)
})

test('a file the engine would refuse to filter by is not reported as a voice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-voice-'))
  const path = join(dir, 'dictation-voiceprint.json')
  const full = Array.from({ length: 256 }, () => 0.0625)
  for (const [why, extra] of [
    ['no embedding', { embedding: [] }],
    ['wrong size', { embedding: full.slice(1) }],
    ['a value that is not a number', { embedding: [...full.slice(1), 'x'] }],
    ['a value that is not finite', { embedding: [...full.slice(1), null] }],
    ['another version', { version: 2 }],
    ['another model', { model: 'something-else' }],
    ['all zeros', { embedding: full.map(() => 0) }],
    ['absurdly large values', { embedding: full.map(() => 3e38) }],
    ['no level', { levelDb: undefined }],
    ['an impossible level', { levelDb: 500 }]
  ] as const) {
    writeFileSync(path, voiceprint(extra))
    assert.equal(readVoiceProfile(path), null, why)
  }
})

test('recording a voice: progress is relayed, and the new voice is there afterwards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-voice-'))
  const engine = fakeEngine({ ok: true, deviceName: 'USB Mic' })
  const voice = new DictationVoice(dir, engine)
  assert.equal(voice.profile(), null)
  assert.equal(voice.voiceprintPath(), null)

  const events: VoiceEnrollEvent[] = []
  const pending = voice.enroll('usb-1', (event) => void events.push(event))
  assert.equal(voice.enrolling, true)
  assert.deepEqual(await voice.enroll(null, () => {}), { ok: false, reason: 'busy' })
  assert.deepEqual(engine.calls, [
    {
      outPath: join(dir, 'dictation-voiceprint.json'),
      inputDevice: 'usb-1',
      seconds: VOICE_ENROLL_SECONDS
    }
  ])
  engine.progress?.({ type: 'download', progress: 0.4 })
  engine.progress?.({ type: 'recording' })
  engine.progress?.({ type: 'level', peak: 0.25 })
  engine.progress?.({ type: 'analysing' })
  voice.finish()
  assert.equal(engine.finished, 1)
  engine.settle()
  assert.deepEqual(await pending, { ok: true })
  assert.deepEqual(events, [
    { type: 'preparing' },
    { type: 'preparing', progress: 0.4 },
    { type: 'recording' },
    { type: 'level', level: 0.65 },
    { type: 'analysing' }
  ])
  assert.equal(voice.enrolling, false)
  assert.equal(voice.voiceprintPath(), join(dir, 'dictation-voiceprint.json'))
  assert.equal(voice.profile()?.deviceName, 'USB Mic')

  // It is still there after a restart, until it is removed.
  assert.ok(new DictationVoice(dir, engine).profile())
  writeFileSync(join(dir, 'dictation-voiceprint.json.tmp'), 'left behind by an interrupted save')
  await voice.remove()
  assert.equal(voice.profile(), null)
  assert.equal(existsSync(join(dir, 'dictation-voiceprint.json')), false)
  assert.equal(existsSync(join(dir, 'dictation-voiceprint.json.tmp')), false)
})

test('removing the voice during a recording waits for it, so nothing is saved afterwards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-voice-'))
  // This engine finishes saving even though it was cancelled: the worst case.
  const engine = fakeEngine({ ok: true, deviceName: null })
  const voice = new DictationVoice(dir, engine)
  const recording = voice.enroll(null, () => {})
  const removal = voice.remove()
  let removed = false
  void removal.then(() => (removed = true))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(engine.cancelled, 1)
  assert.equal(removed, false, 'the file is not deleted while the recording could still write it')
  engine.settle()
  await removal
  await recording
  assert.equal(existsSync(join(dir, 'dictation-voiceprint.json')), false)
  assert.equal(voice.profile(), null)
})

test('a failed recording keeps the previous voice; no engine means no recording', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dictation-voice-'))
  writeFileSync(join(dir, 'dictation-voiceprint.json'), voiceprint({ deviceName: 'Old Mic' }))
  const engine = fakeEngine({ ok: false, reason: 'not-enough-speech' })
  const voice = new DictationVoice(dir, engine)
  const pending = voice.enroll(null, () => {})
  engine.settle()
  assert.deepEqual(await pending, { ok: false, reason: 'not-enough-speech' })
  assert.equal(voice.profile()?.deviceName, 'Old Mic')

  const none = new DictationVoice(dir, null)
  assert.deepEqual(await none.enroll(null, () => {}), { ok: false, reason: 'unavailable' })
})
