import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  boundedTestStallMs,
  MAX_ASR_STALL_MS,
  MAX_CONFIRM_STALL_MS,
  speechWorkerEnv
} from './speech-worker-env'

const env = {
  PATH: 'C:\\Windows',
  DOODLENOTE_BARK_TEST_HOOKS: '1',
  DOODLENOTE_BARK_TEST_WORKER_STALL_MS: 'Infinity',
  DOODLENOTE_ASR_TEST_STALL_MS: '8000',
  DICTATION_HELPER_TEST: '1'
}

test('a packaged production build passes no QA hook to the speech worker', () => {
  const out = speechWorkerEnv(env, true, 'release')
  assert.deepEqual(Object.keys(out), ['PATH'])
})

test('a packaged dev-channel build keeps only the ASR backlog hook (the documented packaged meeting smoke)', () => {
  const out = speechWorkerEnv(env, true, 'dev')
  assert.deepEqual(Object.keys(out).sort(), ['DOODLENOTE_ASR_TEST_STALL_MS', 'PATH'])
})

test("Bark's hooks reach the worker only unpackaged with DOODLENOTE_BARK_TEST_HOOKS=1; DICTATION_HELPER_* never", () => {
  const on = speechWorkerEnv(env, false, 'release')
  assert.equal(on.DOODLENOTE_BARK_TEST_WORKER_STALL_MS, 'Infinity')
  assert.equal(on.DICTATION_HELPER_TEST, undefined)
  const off = speechWorkerEnv({ ...env, DOODLENOTE_BARK_TEST_HOOKS: '0' }, false, 'release')
  assert.equal(off.DOODLENOTE_BARK_TEST_WORKER_STALL_MS, undefined)
})

test('the worker bounds every stall it is given', () => {
  assert.equal(boundedTestStallMs('Infinity', MAX_CONFIRM_STALL_MS), 0)
  assert.equal(boundedTestStallMs('-5', MAX_CONFIRM_STALL_MS), 0)
  assert.equal(boundedTestStallMs('1e9', MAX_CONFIRM_STALL_MS), 0)
  assert.equal(boundedTestStallMs('3000', MAX_CONFIRM_STALL_MS), 3000)
  assert.equal(boundedTestStallMs('999999999', MAX_CONFIRM_STALL_MS), MAX_CONFIRM_STALL_MS)
  assert.equal(boundedTestStallMs('999999999', MAX_ASR_STALL_MS), MAX_ASR_STALL_MS)
  assert.equal(boundedTestStallMs(undefined, MAX_ASR_STALL_MS), 0)
})

test('both speech workers are spawned with the sanitized environment, and the worker reads its stalls bounded', () => {
  for (const file of ['engine-host-win.ts', 'win-batch-transcriber.ts']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    assert.match(source, /env: speechWorkerEnv\(process\.env, app\.isPackaged, APP_CHANNEL\)/, file)
  }
  const worker = readFileSync(new URL('./engine-win.ts', import.meta.url), 'utf8')
  assert.match(
    worker,
    /boundedTestStallMs\(process\.env\.DOODLENOTE_ASR_TEST_STALL_MS, MAX_ASR_STALL_MS\)/
  )
  assert.match(
    worker,
    /boundedTestStallMs\(process\.env\.DOODLENOTE_BARK_TEST_WORKER_STALL_MS, MAX_CONFIRM_STALL_MS\)/
  )
  assert.doesNotMatch(worker, /Number\(process\.env\.DOODLENOTE_/)
})
