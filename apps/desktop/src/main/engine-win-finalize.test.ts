import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WINDOWS_ASR_SAMPLE_RATE,
  WINDOWS_ASR_TAIL_SECONDS,
  boundedTokenWindow,
  finishOnlineStream
} from './engine-win-finalize'

test('finalization submits recognizer-only tail silence before inputFinished', () => {
  const calls: string[] = []
  const submitted: { value: Float32Array | null } = { value: null }
  const stream = {
    acceptWaveform({ samples, sampleRate }: { samples: Float32Array; sampleRate: number }) {
      assert.equal(sampleRate, WINDOWS_ASR_SAMPLE_RATE)
      submitted.value = samples
      calls.push('tail')
    },
    inputFinished() {
      calls.push('finished')
    }
  }
  let readyChecks = 0
  const recognizer = {
    isReady() {
      return readyChecks++ === 0
    },
    decode() {
      calls.push('decode')
    }
  }

  finishOnlineStream(stream, recognizer)

  assert.deepEqual(calls, ['tail', 'finished', 'decode'])
  assert.equal(submitted.value?.length, WINDOWS_ASR_SAMPLE_RATE * WINDOWS_ASR_TAIL_SECONDS)
  assert.ok(submitted.value?.every((sample) => sample === 0))
})

test('tail padding cannot extend emitted timing beyond real audio', () => {
  assert.deepEqual(boundedTokenWindow(1.8, 2.4, 2), { startSec: 1.8, endSec: 2 })
  assert.equal(boundedTokenWindow(2.1, 2.4, 2), null)
})
