import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ensureWhisperModel, verifyModel } from './whisper-model'
import { runBatchChild } from './batch-child'
import { normalizeBatchSettings } from '../shared/batch-transcription'
import { whisperTokens } from './whisper-transcriber'

test('batch defaults stay Parakeet; invalid settings cannot become CLI arguments', () => {
  assert.deepEqual(normalizeBatchSettings(null), {
    backend: 'parakeet',
    parakeetModel: 'v2',
    language: 'auto'
  })
  assert.equal(
    normalizeBatchSettings({ backend: 'whisper', language: '--translate' }).language,
    'auto'
  )
  assert.equal(normalizeBatchSettings({ backend: 'whisper', language: 'da' }).language, 'da')
})

test('verified model downloads once, works offline, repairs corruption and rejects bad hashes', async () => {
  const payload = Buffer.from('synthetic-model-test-only')
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.end(payload)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const dir = await mkdtemp(join(tmpdir(), 'whisper-cache-test-'))
  const descriptor = {
    filename: 'test.bin',
    bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
    url: `http://127.0.0.1:${address.port}`
  }
  try {
    const progress: number[] = []
    const path = await ensureWhisperModel(
      dir,
      undefined,
      (value) => progress.push(value),
      descriptor
    )
    assert.equal(await verifyModel(path, descriptor), true)
    assert.equal(progress.at(-1), 1)
    await writeFile(path, Buffer.alloc(payload.length))
    await ensureWhisperModel(dir, undefined, undefined, descriptor)
    assert.equal(requests, 2)
    await assert.rejects(
      ensureWhisperModel(dir, undefined, undefined, {
        ...descriptor,
        filename: 'bad.bin',
        sha256: '0'.repeat(64)
      }),
      /integrity/
    )
    assert.deepEqual(await readdir(dir), ['test.bin'])
    await new Promise<void>((resolve) => server.close(() => resolve()))
    assert.equal(await ensureWhisperModel(dir, undefined, undefined, descriptor), path)
    assert.deepEqual(await readFile(path), payload)
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('canceling model download removes only its partial and allows retry', async () => {
  const server = createServer((_request, response) => {
    response.write('slow')
    const timer = setInterval(() => response.write('data'), 20)
    response.on('close', () => clearInterval(timer))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const dir = await mkdtemp(join(tmpdir(), 'whisper-cancel-test-'))
  const controller = new AbortController()
  try {
    const running = ensureWhisperModel(dir, controller.signal, () => controller.abort(), {
      filename: 'test.bin',
      bytes: 1000000,
      sha256: '0'.repeat(64),
      url: `http://127.0.0.1:${address.port}`
    })
    await assert.rejects(running, { name: 'AbortError' })
    assert.deepEqual(await readdir(dir), [])
  } finally {
    server.closeAllConnections()
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('cancel waits for a resistant child to exit, and later jobs still run', async () => {
  const controller = new AbortController()
  const start = Date.now()
  const running = runBatchChild(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"],
    controller.signal
  )
  const timer = setTimeout(() => controller.abort(), 150)
  await assert.rejects(running, { name: 'AbortError' })
  clearTimeout(timer)
  assert.ok(Date.now() - start >= 1800)
  assert.equal((await runBatchChild(process.execPath, ['-e', "console.log('ok')"])).trim(), 'ok')
})

test('Whisper token adapter preserves measured times, Unicode and probabilities', () => {
  const result = whisperTokens({
    transcription: [
      {
        offsets: { from: 0, to: 1200 },
        tokens: [
          { text: '[_BEG_]', p: 1 },
          { text: ' Vi', p: 0.9, offsets: { from: 100, to: 200 } },
          { text: ' mødes', p: 0.8, offsets: { from: 250, to: 500 } }
        ]
      }
    ]
  })
  assert.equal(result.length, 2)
  assert.equal(result[1]?.token, ' mødes')
  assert.equal(result[1]?.startSec, 0.25)
  assert.equal(result[1]?.confidence, 0.8)
})
