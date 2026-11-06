import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PARAKEET_UNIFIED,
  PARAKEET_TDT_V2,
  PARAKEET_TDT_V3,
  SILERO_VAD,
  ensureWindowsAsrModel,
  ensureWindowsAsrModels,
  modelFilesMatch,
  parakeetSpec,
  type WindowsAsrModelSpec
} from './windows-asr-models'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'doodlenote-asr-models-'))
}

const payload = Buffer.from('synthetic model archive bytes')
const sha = createHash('sha256').update(payload).digest('hex')

function fakeArchive(name: string, files: Record<string, number>): WindowsAsrModelSpec {
  return {
    name,
    url: `https://example.invalid/${name}.tar.bz2`,
    bytes: payload.length,
    sha256: sha,
    kind: 'archive',
    files
  }
}

/** Writes the archive's folder (plus extras the app must prune) into staging. */
function fakeExtract(spec: WindowsAsrModelSpec, extras = true) {
  const files = spec.files
  return async (_archive: string, destination: string): Promise<void> => {
    const root = join(destination, spec.name)
    mkdirSync(root, { recursive: true })
    for (const [file, size] of Object.entries(files))
      writeFileSync(join(root, file), Buffer.alloc(size))
    if (extras) {
      mkdirSync(join(root, 'test_wavs'))
      writeFileSync(join(root, 'test_wavs', '0.wav'), 'x')
      writeFileSync(join(root, 'README.md'), 'x')
    }
  }
}
test('pinned models come from the k2-fsa asr-models release with exact sizes and hashes', () => {
  for (const model of [PARAKEET_UNIFIED, PARAKEET_TDT_V2, PARAKEET_TDT_V3, SILERO_VAD]) {
    assert.match(
      model.url,
      /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/asr-models\//
    )
    assert.match(model.sha256, /^[0-9a-f]{64}$/)
    assert.ok(model.bytes > 0)
  }
  assert.equal(parakeetSpec('v2'), PARAKEET_TDT_V2)
  assert.equal(parakeetSpec('v3'), PARAKEET_TDT_V3)
  assert.deepEqual(Object.keys(PARAKEET_TDT_V2.files).sort(), [
    'decoder.int8.onnx',
    'encoder.int8.onnx',
    'joiner.int8.onnx',
    'tokens.txt'
  ])
})

test('modelFilesMatch requires every file at its exact expected size', () => {
  const root = tempDir()
  const model = join(root, 'model')
  mkdirSync(model)
  try {
    writeFileSync(join(model, 'encoder.onnx'), Buffer.alloc(3))
    writeFileSync(join(model, 'decoder.onnx'), Buffer.alloc(4))
    const expected = { 'encoder.onnx': 3, 'decoder.onnx': 4 }
    assert.equal(modelFilesMatch(model, expected), true)
    writeFileSync(join(model, 'decoder.onnx'), Buffer.alloc(5))
    assert.equal(modelFilesMatch(model, expected), false)
    rmSync(join(model, 'encoder.onnx'))
    assert.equal(modelFilesMatch(model, expected), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a verified archive is promoted atomically with only the files the app reads', async () => {
  const root = tempDir()
  const spec = fakeArchive('fake-parakeet', { 'encoder.int8.onnx': 5, 'tokens.txt': 2 })
  // Older builds' model folders must survive untouched.
  mkdirSync(join(root, 'sherpa-onnx-streaming-zipformer-en-2023-06-26'))
  writeFileSync(join(root, 'sherpa-onnx-streaming-zipformer-en-2023-06-26', 'tokens.txt'), 'old')
  mkdirSync(join(root, 'sherpa-onnx-whisper-tiny.en'))
  const progress: number[] = []
  try {
    const dir = await ensureWindowsAsrModel(root, spec, (value) => progress.push(value), {
      download: async (_url, path, onProgress) => {
        writeFileSync(path, payload)
        onProgress(payload.length)
      },
      extract: fakeExtract(spec)
    })
    assert.equal(dir, join(root, 'fake-parakeet'))
    assert.deepEqual(readdirSync(dir).sort(), ['README.md', 'encoder.int8.onnx', 'tokens.txt'])
    assert.equal(progress.at(-1), 1)
    assert.deepEqual(readdirSync(root).sort(), [
      'fake-parakeet',
      'sherpa-onnx-streaming-zipformer-en-2023-06-26',
      'sherpa-onnx-whisper-tiny.en'
    ])
    // Installed: a second call does not download again.
    await ensureWindowsAsrModel(root, spec, () => {}, {
      download: async () => assert.fail('an installed model must not be downloaded again')
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a corrupt download is discarded and never becomes the active model', async () => {
  const root = tempDir()
  const spec = fakeArchive('fake-corrupt', { 'tokens.txt': 2 })
  try {
    await assert.rejects(
      ensureWindowsAsrModel(root, spec, () => {}, {
        download: async (_url, path) => writeFileSync(path, Buffer.alloc(payload.length)),
        extract: fakeExtract(spec)
      }),
      /failed verification/
    )
    assert.deepEqual(readdirSync(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an interrupted download keeps its partial file and the next attempt resumes it', async () => {
  const root = tempDir()
  const spec = fakeArchive('fake-resume', { 'tokens.txt': 2 })
  const half = payload.subarray(0, 10)
  try {
    await assert.rejects(
      ensureWindowsAsrModel(root, spec, () => {}, {
        download: async (_url, path) => {
          writeFileSync(path, half)
          throw new Error('network dropped')
        }
      }),
      /network dropped/
    )
    const partial = join(root, 'fake-resume.download.partial')
    assert.equal(statSync(partial).size, half.length)
    let resumedFrom = -1
    await ensureWindowsAsrModel(root, spec, () => {}, {
      download: async (_url, path) => {
        resumedFrom = statSync(path).size
        writeFileSync(path, Buffer.concat([half, payload.subarray(10)]))
      },
      extract: fakeExtract(spec, false)
    })
    assert.equal(resumedFrom, half.length)
    assert.equal(existsSync(partial), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('single-file assets and multi-asset progress are weighted by download size', async () => {
  const root = tempDir()
  const vad: WindowsAsrModelSpec = {
    name: 'fake-vad',
    url: 'https://example.invalid/vad.onnx',
    bytes: payload.length,
    sha256: sha,
    kind: 'file',
    files: { 'vad.onnx': payload.length }
  }
  const spec = fakeArchive('fake-asr', { 'tokens.txt': 2 })
  const progress: number[] = []
  try {
    const [asrDir, vadDir] = await ensureWindowsAsrModels(
      root,
      [spec, vad],
      (p) => progress.push(p),
      {
        download: async (_url, path, onProgress) => {
          writeFileSync(path, payload)
          onProgress(payload.length)
        },
        extract: fakeExtract(spec)
      }
    )
    assert.equal(asrDir, join(root, 'fake-asr'))
    assert.equal(statSync(join(vadDir!, 'vad.onnx')).size, payload.length)
    assert.deepEqual(progress, [0.5, 1])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
