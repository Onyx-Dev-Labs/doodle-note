import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { NotesEngineLog, type NotesDiagnostic } from './notes-log'

test('JSONL persists allowlisted metrics and classified errors without transcript, notes or raw exception content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'notes-engine.log')
  const logger = new NotesEngineLog(file)
  logger.log({
    event: 'prefill',
    modelId: 'qwen3-4b',
    promptTokens: 1941,
    skippedTokens: 1843,
    evaluatedTokens: 98,
    prefillMs: 2000,
    prefillTokensPerSecond: 49,
    prefixReused: true,
    transcript: 'PRIVATE TRANSCRIPT',
    notes: 'PRIVATE NOTES'
  } as NotesDiagnostic)
  logger.log({
    event: 'fallback',
    stage: 'context',
    error: new Error('allocation failed: PRIVATE TRANSCRIPT')
  })
  logger.log({
    event: 'failure',
    error: Object.assign(new Error('PRIVATE NOTES'), { code: 'timeout' })
  })
  await logger.flush()
  const text = await readFile(file, 'utf8')
  assert.doesNotMatch(text, /PRIVATE|transcript|notes|stack/)
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(lines[0].skippedTokens, 1843)
  assert.equal(lines[0].prefixReused, true)
  assert.ok(Date.parse(lines[0].timestamp))
  assert.equal(lines[1].errorClass, 'Error')
  assert.equal(lines[1].message, 'Native memory allocation failed.')
  assert.equal(lines[2].timeout, true)
})

test('concurrent appends rotate once per size boundary, retaining exactly one old file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'notes-engine.log')
  const logger = new NotesEngineLog(file, 600)
  for (let i = 0; i < 30; i++) logger.log({ event: 'context', contextSize: i, contextCreateMs: 1 })
  await logger.flush()
  assert.deepEqual((await readdir(dir)).sort(), ['notes-engine.log', 'notes-engine.log.old'])
  const current = await readFile(file, 'utf8'),
    old = await readFile(`${file}.old`, 'utf8')
  assert.ok(Buffer.byteLength(current) <= 600)
  assert.ok(Buffer.byteLength(old) <= 600)
  const entries = `${old}${current}`
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(entries.at(-1).contextSize, 29)
  for (let i = 1; i < entries.length; i++)
    assert.equal(entries[i].contextSize, entries[i - 1].contextSize + 1)
})

test('logging failures resolve harmlessly and later writes recover', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'notes-engine.log')
  await mkdir(file)
  const logger = new NotesEngineLog(file)
  logger.log({ event: 'warmup', reason: 'battery' })
  await logger.flush()
  await rm(file, { recursive: true })
  logger.log({ event: 'warmup', reason: 'start' })
  await logger.flush()
  assert.equal(JSON.parse((await readFile(file, 'utf8')).trim()).reason, 'start')
})

test('large repeated exception text has bounded classification work and cannot inflate the log', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'notes-engine.log')
  const logger = new NotesEngineLog(file)
  logger.log({
    event: 'failure',
    error: new Error('no usable allocat insufficient '.repeat(100_000))
  })
  await logger.flush()
  const text = await readFile(file, 'utf8')
  assert.ok(text.length < 1024)
  assert.equal(
    JSON.parse(text).message,
    'Model operation failed; unclassified details omitted for content privacy.'
  )
})

test('runtime duration and boolean battery observations persist without arbitrary power data', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'notes-log-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'notes-engine.log')
  const logger = new NotesEngineLog(file)
  logger.log({ event: 'runtime', backend: 'vulkan', runtimeMs: 6000 })
  logger.log({ event: 'warmup', reason: 'skipped', why: 'battery', onBatteryPower: true })
  logger.log({ event: 'warmup', reason: 'start', onBatteryPower: false })
  logger.log({
    event: 'warmup',
    reason: 'start',
    onBatteryPower: 'PRIVATE'
  } as unknown as NotesDiagnostic)
  await logger.flush()
  const text = await readFile(file, 'utf8')
  assert.doesNotMatch(text, /PRIVATE/)
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(lines[0].runtimeMs, 6000)
  assert.equal(lines[1].reason, 'skipped')
  assert.equal(lines[1].why, 'battery')
  assert.equal(lines[1].onBatteryPower, true)
  assert.equal(lines[2].onBatteryPower, false)
  assert.equal(lines[3].onBatteryPower, undefined)
})
