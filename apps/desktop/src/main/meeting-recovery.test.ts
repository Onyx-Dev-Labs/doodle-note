import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isStoredCloudProvider,
  meetingPrimaryAction,
  transcriptCheckpointDelayMs
} from '../shared/meeting-recovery'

test('saved audio with no transcript offers transcription recovery', () => {
  assert.equal(
    meetingPrimaryAction({
      capturing: false,
      segmentCount: 0,
      audioPartCount: 1,
      modelReady: false,
      enhancedPresent: false,
      generating: false,
      retranscribing: false
    }),
    'transcribe'
  )
})

test('a meeting with transcript but no notes model offers model setup', () => {
  assert.equal(
    meetingPrimaryAction({
      capturing: false,
      segmentCount: 4,
      audioPartCount: 1,
      modelReady: false,
      enhancedPresent: false,
      generating: false,
      retranscribing: false
    }),
    'configure-model'
  )
})

test('live transcript segments are checkpointed before a normal stop', () => {
  assert.equal(transcriptCheckpointDelayMs('recording', 4), 1_000)
  assert.equal(transcriptCheckpointDelayMs('finishing', 4), 400)
  assert.equal(transcriptCheckpointDelayMs('ended', 4), 0)
  assert.equal(transcriptCheckpointDelayMs('idle', 4), null)
  assert.equal(transcriptCheckpointDelayMs('recording', 0), null)
})

test('every supported cloud provider survives settings reload', () => {
  for (const provider of ['anthropic', 'openai', 'groq', 'openrouter', 'ollama']) {
    assert.equal(isStoredCloudProvider(provider), true, provider)
  }
  assert.equal(isStoredCloudProvider('not-a-provider'), false)
})
