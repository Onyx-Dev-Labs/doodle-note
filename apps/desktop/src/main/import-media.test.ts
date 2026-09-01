import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUDIO_FILES,
  IMPORTABLE_EXTENSIONS,
  importedPlaybackFilename,
  playbackMime
} from './import-media'

test('recording imports accept MP4 without dropping existing audio formats', () => {
  assert.deepEqual([...IMPORTABLE_EXTENSIONS], ['wav', 'mp3', 'm4a', 'mp4'])
  assert.deepEqual([...AUDIO_FILES], ['audio.m4a', 'audio.wav', 'audio.mp3', 'audio.mp4'])
})

test('imported playback names normalize case and reject unsupported containers', () => {
  assert.equal(importedPlaybackFilename('/tmp/Quarterly Review.MP4'), 'audio.mp4')
  assert.equal(importedPlaybackFilename('/tmp/meeting.m4a'), 'audio.m4a')
  assert.equal(importedPlaybackFilename('/tmp/meeting.mov'), null)
  assert.equal(importedPlaybackFilename('/tmp/no-extension'), null)
})

test('stored MP4 playback is served with its video container MIME type', () => {
  assert.equal(playbackMime('audio.mp4'), 'video/mp4')
  assert.equal(playbackMime('audio.m4a'), 'audio/mp4')
  assert.equal(playbackMime('unexpected.bin'), 'application/octet-stream')
})
