import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  LEGACY_ZIPFORMER,
  LegacyStreamingChannel,
  legacyZipformerInstalled,
  type LegacyStream
} from './windows-asr-legacy'

test('the cached Zipformer from earlier builds is recognised only when complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'doodlenote-legacy-'))
  try {
    assert.equal(legacyZipformerInstalled(root), false)
    const dir = join(root, LEGACY_ZIPFORMER.name)
    mkdirSync(dir)
    for (const [name, size] of Object.entries(LEGACY_ZIPFORMER.files)) {
      writeFileSync(join(dir, name), Buffer.alloc(size))
    }
    assert.equal(legacyZipformerInstalled(root), true)
    writeFileSync(join(dir, 'tokens.txt'), 'short')
    assert.equal(legacyZipformerInstalled(root), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a recording on the legacy model still produces timings and a final transcript', () => {
  const events: Array<Record<string, unknown>> = []
  let fed = 0
  const recognizer = {
    createStream: (): LegacyStream => ({
      acceptWaveform: ({ samples }) => {
        fed += samples.length
      },
      inputFinished: () => {}
    }),
    isReady: () => false,
    decode: () => {},
    getResult: () =>
      fed >= 16_000
        ? { text: '▁HELLO▁THERE', tokens: ['▁HELLO', '▁THERE'], timestamps: [0.2, 0.6] }
        : { text: '', tokens: [], timestamps: [] }
  }
  const channel = new LegacyStreamingChannel('mic', recognizer, (event) => events.push(event))
  channel.ingest(new Float32Array(16_000), Date.now() - 100)
  channel.finish()
  assert.equal(events[0]!.event, 'channel_start')
  const timings = events.filter((event) => event.event === 'timings')
  assert.deepEqual(
    (timings[0]!.tokens as Array<{ token: string }>).map((token) => token.token),
    [' HELLO', ' THERE']
  )
  assert.deepEqual(events.at(-1), { event: 'final', channel: 'mic', text: 'HELLO THERE' })
})
