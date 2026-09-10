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

test('an imported meeting with a transcript and notes model offers Generate notes', () => {
  assert.equal(
    meetingPrimaryAction({
      capturing: false,
      segmentCount: 4,
      audioPartCount: 1,
      modelReady: true,
      enhancedPresent: false,
      generating: false,
      retranscribing: false
    }),
    'generate'
  )
})

test('live transcript segments are checkpointed before a normal stop', () => {
  assert.equal(transcriptCheckpointDelayMs('recording', 4), 1_000)
  assert.equal(transcriptCheckpointDelayMs('finishing', 4), 400)
  assert.equal(transcriptCheckpointDelayMs('ended', 4), 0)
  assert.equal(transcriptCheckpointDelayMs('idle', 4), null)
  assert.equal(transcriptCheckpointDelayMs('recording', 0), null)
})

test('existing generated notes retain generation, setup and transcription recovery actions', () => {
  const meeting = {
    capturing: false,
    segmentCount: 4,
    audioPartCount: 1,
    modelReady: true,
    enhancedPresent: true,
    generating: false,
    retranscribing: false
  }
  assert.equal(meetingPrimaryAction(meeting), 'regenerate')
  assert.equal(meetingPrimaryAction({ ...meeting, capturing: true }), 'hidden')
  assert.equal(meetingPrimaryAction({ ...meeting, generating: true }), 'generating')
  assert.equal(meetingPrimaryAction({ ...meeting, modelReady: false }), 'configure-model')
  assert.equal(meetingPrimaryAction({ ...meeting, segmentCount: 0 }), 'transcribe')
})

test('every supported cloud provider survives settings reload', () => {
  for (const provider of ['anthropic', 'openai', 'groq', 'openrouter', 'ollama']) {
    assert.equal(isStoredCloudProvider(provider), true, provider)
  }
  assert.equal(isStoredCloudProvider('not-a-provider'), false)
})
