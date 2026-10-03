import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isWinCheckpointDir, mergeWinSession, WinSessionRecorder } from './win-audio-recorder'

function tempDir(name: string): string {
  const dir = join(
    tmpdir(),
    `win-audio-test-${name}-${process.pid}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function frames(value: number, count: number): Float32Array {
  return new Float32Array(count).fill(value)
}

interface Wav {
  channels: number
  sampleRate: number
  frameCount: number
  sample(frame: number, channel: number): number
}

function readWav(path: string): Wav {
  const buf = readFileSync(path)
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE')
  const channels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const dataBytes = buf.readUInt32LE(40)
  assert.equal(dataBytes, buf.length - 44)
  return {
    channels,
    sampleRate,
    frameCount: dataBytes / 2 / channels,
    sample: (frame, channel) => buf.readInt16LE(44 + (frame * channels + channel) * 2) / 32_767
  }
}

test('two-channel session merges to aligned stereo wav', async () => {
  const dir = tempDir('stereo')
  try {
    const recorder = new WinSessionRecorder(dir)
    // mic starts first; ~2s of 0.5s frames
    recorder.write('mic', frames(0.5, 32_000))
    recorder.write('system', frames(-0.25, 16_000))
    recorder.write('mic', frames(0.5, 16_000))
    // Fake a known epoch offset (write() stamped real Date.now() values).
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        sampleRate: 16_000,
        channels: { mic: { epochMs: 10_000 }, system: { epochMs: 11_000 } }
      })
    )
    const saved = await recorder.finish()
    assert.ok(saved)
    // mic: 48000 frames = 3s (the longer channel); system: 1s offset + 1s audio.
    assert.equal(saved.durationMs, 3000)
    assert.equal(saved.startEpochMs, 10_000)

    const wav = readWav(join(dir, 'audio.wav'))
    assert.equal(wav.channels, 2)
    assert.equal(wav.sampleRate, 16_000)
    assert.equal(wav.frameCount, 48_000)
    // Left = mic from frame 0.
    assert.ok(Math.abs(wav.sample(100, 0) - 0.5) < 0.001)
    // Right = system: silent during the 1s offset, then -0.25.
    assert.equal(wav.sample(100, 1), 0)
    assert.ok(Math.abs(wav.sample(17_000, 1) - -0.25) < 0.001)
    // Mic keeps playing after system audio ran out (frame 32k+…): left live.
    assert.ok(Math.abs(wav.sample(40_000, 0) - 0.5) < 0.001)
    assert.equal(wav.sample(40_000, 1), 0)

    // Checkpoints cleaned up after a successful merge.
    assert.equal(existsSync(join(dir, 'checkpoints')), false)
    assert.equal(existsSync(join(dir, 'manifest.json')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chunks rotate every ~30s and all survive the merge', async () => {
  const dir = tempDir('rotate')
  try {
    const recorder = new WinSessionRecorder(dir)
    // 70s of mono audio in 1s frames → expect 3 chunk files (30+30+10).
    for (let i = 0; i < 70; i++) recorder.write('mic', frames(0.1, 16_000))
    assert.ok(isWinCheckpointDir(join(dir, 'checkpoints')))
    const saved = await recorder.finish()
    assert.ok(saved)
    assert.equal(saved.durationMs, 70_000)
    const wav = readWav(join(dir, 'audio.wav'))
    assert.equal(wav.channels, 1)
    assert.equal(wav.frameCount, 70 * 16_000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('crash recovery: mergeWinSession on leftover checkpoints', async () => {
  const dir = tempDir('recover')
  try {
    const recorder = new WinSessionRecorder(dir)
    recorder.write('mic', frames(0.3, 16_000))
    recorder.abort() // crash: files closed (or not), no merge

    // Simulate a torn final chunk: truncate to a non-multiple of 4 bytes.
    const chunk = join(dir, 'checkpoints', 'mic-000001.f32')
    const size = statSync(chunk).size
    writeFileSync(chunk, readFileSync(chunk).subarray(0, size - 2))

    const saved = await mergeWinSession(dir)
    assert.ok(saved)
    // One torn frame dropped at most; everything else survives.
    assert.ok(saved.durationMs >= 999 && saved.durationMs <= 1000)
    assert.ok(existsSync(join(dir, 'audio.wav')))
    assert.equal(existsSync(join(dir, 'checkpoints')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('empty / missing session dirs merge to null', async () => {
  const dir = tempDir('empty')
  try {
    assert.equal(await mergeWinSession(dir), null) // no checkpoints dir
    mkdirSync(join(dir, 'checkpoints'))
    assert.equal(await mergeWinSession(dir), null) // no chunks
    assert.equal(isWinCheckpointDir(join(dir, 'checkpoints')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('system-only recording retains the right channel for batch speaker attribution', async () => {
  const dir = tempDir('system-only')
  try {
    const recorder = new WinSessionRecorder(dir)
    recorder.write('system', frames(0.25, 16_000))
    assert.ok(await recorder.finish())
    const wav = readWav(join(dir, 'audio.wav'))
    assert.equal(wav.channels, 2)
    assert.equal(wav.sample(100, 0), 0)
    assert.ok(Math.abs(wav.sample(100, 1) - 0.25) < 0.001)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('clipping: out-of-range floats clamp instead of wrapping', async () => {
  const dir = tempDir('clip')
  try {
    const recorder = new WinSessionRecorder(dir)
    recorder.write('mic', frames(1.7, 1_600))
    const saved = await recorder.finish()
    assert.ok(saved)
    const wav = readWav(join(dir, 'audio.wav'))
    assert.ok(Math.abs(wav.sample(100, 0) - 1) < 0.001)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
