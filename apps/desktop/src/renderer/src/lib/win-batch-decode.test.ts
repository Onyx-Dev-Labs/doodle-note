import assert from 'node:assert/strict'
import { test } from 'node:test'
import { winBatchChannels } from './win-batch-decode'

function audio(
  ...channels: number[][]
): Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'> {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    getChannelData: (index: number) => new Float32Array(channels[index])
  }
}

test('ordinary stereo imports produce one mixed stream instead of duplicate people', () => {
  const result = winBatchChannels(audio([0.5, -0.5], [0.5, -0.5]), 'mixed')
  assert.deepEqual(result, [new Float32Array([0.5, -0.5])])
})

test('mixed imports retain audio from channels beyond the first two without clipping', () => {
  const result = winBatchChannels(audio([0, 0], [0, 0], [0.75, -0.75]), 'mixed')
  assert.deepEqual(result, [new Float32Array([0.25, -0.25])])
})

test('known split recordings preserve the silent microphone slot for system-only speech', () => {
  const result = winBatchChannels(audio([0, 0], [0.75, -0.75]), 'split')
  assert.deepEqual(result, [new Float32Array([0, 0]), new Float32Array([0.75, -0.75])])
})

test('mono imports retain original sample amplitude', () => {
  assert.deepEqual(winBatchChannels(audio([0.75, -0.5]), 'mixed'), [new Float32Array([0.75, -0.5])])
})
