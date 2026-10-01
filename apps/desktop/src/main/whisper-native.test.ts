import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { transcribeWithWhisper } from './whisper-transcriber'

// Explicit opt-in only: normal test runs never download a 1.62 GB model.
const engine = process.env.DOODLE_TEST_ENGINE ?? ''
const whisper = process.env.DOODLE_TEST_WHISPER ?? ''
const modelDir = process.env.DOODLE_TEST_WHISPER_MODELS ?? ''
const available =
  process.platform === 'darwin' &&
  existsSync(engine) &&
  existsSync(whisper) &&
  existsSync(join(modelDir, 'ggml-large-v3-turbo.bin'))
const settings = { backend: 'whisper' as const, parakeetModel: 'v2' as const, language: 'en' }

test(
  'native Whisper imports dual-mono AAC once, preserves split speakers, reads MP4 and recovers after cancel',
  { skip: !available },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'doodle-whisper-native-test-'))
    try {
      const left = join(directory, 'left.aiff')
      const right = join(directory, 'right.aiff')
      execFileSync('say', ['-o', left, 'We should review the budget together'])
      execFileSync('say', ['-o', right, 'The invoices were sent to the client yesterday'])
      const dual = join(directory, 'dual.wav')
      const stereo = join(directory, 'stereo.wav')
      const makeStereo = resolve('test-fixtures/make-stereo.swift')
      execFileSync('swift', [makeStereo, left, left, dual])
      execFileSync('swift', [makeStereo, left, right, stereo])
      const aac = join(directory, 'dual.m4a')
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', dual, aac])
      const mixed = await transcribeWithWhisper(engine, whisper, modelDir, aac, undefined, {
        settings
      })
      assert.equal(mixed.segments.filter((segment) => /budget/i.test(segment.text)).length, 1)
      assert.ok(mixed.segments.every((segment) => segment.speaker === 'Speaker'))
      const split = await transcribeWithWhisper(engine, whisper, modelDir, stereo, undefined, {
        channels: 'split',
        settings
      })
      assert.match(
        split.segments
          .filter((segment) => segment.channel === 'mic')
          .map((segment) => segment.text)
          .join(' '),
        /budget/i
      )
      assert.match(
        split.segments
          .filter((segment) => segment.channel === 'system')
          .map((segment) => segment.text)
          .join(' '),
        /invoices/i
      )
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      await assert.rejects(
        transcribeWithWhisper(
          engine,
          whisper,
          modelDir,
          aac,
          (progress) => {
            if (progress.stage === 'transcribing') timer = setTimeout(() => controller.abort(), 250)
          },
          { settings, signal: controller.signal }
        ),
        { name: 'AbortError' }
      )
      clearTimeout(timer)
      const mp4 = join(directory, 'meeting.mp4')
      execFileSync('swift', [resolve('test-fixtures/make-mp4.swift'), mp4, left])
      const afterCancel = await transcribeWithWhisper(engine, whisper, modelDir, mp4, undefined, {
        settings
      })
      assert.match(afterCancel.segments.map((segment) => segment.text).join(' '), /budget/i)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
