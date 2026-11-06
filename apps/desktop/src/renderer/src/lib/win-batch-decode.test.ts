import assert from 'node:assert/strict'
import { test } from 'node:test'
import { winBatchChannels } from './win-batch-decode'

function buffer(
  channels: number[][]
): Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'> {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    getChannelData: (index: number) => Float32Array.from(channels[index]!)
  }
}

test('external stereo is mixed once to a single neutral channel, like the Mac', () => {
  const mixed = winBatchChannels(
    buffer([
      [1, 0.5],
      [0, 0.5]
    ]),
    'mixed'
  )
  assert.equal(mixed.length, 1)
  assert.deepEqual([...mixed[0]!], [0.5, 0.5])
})

test('mono files and saved DoodleNote parts keep their channels', () => {
  assert.equal(winBatchChannels(buffer([[0.25]]), 'mixed').length, 1)
  const split = winBatchChannels(buffer([[1], [2], [3]]), 'split')
  assert.deepEqual(
    split.map((channel) => [...channel]),
    [[1], [2]]
  )
})
