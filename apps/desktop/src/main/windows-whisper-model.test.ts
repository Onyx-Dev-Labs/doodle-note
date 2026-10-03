import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { modelFilesMatch, splitWhisperWindows } from './windows-whisper-model'

test('modelFilesMatch requires every file at its exact expected size', () => {
  const root = mkdtempSync(join(tmpdir(), 'doodlenote-whisper-test-'))
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

test('long recordings are split below the Whisper hard limit without dropping their ending', () => {
  const samples = Float32Array.from({ length: 27 }, (_, index) => index)
  const windows = splitWhisperWindows(samples, 10)
  assert.deepEqual(
    windows.map((window) => [...window]),
    [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      [20, 21, 22, 23, 24, 25, 26]
    ]
  )
})
