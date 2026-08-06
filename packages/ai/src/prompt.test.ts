import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAskSystemPrompt } from './ask-prompt'
import { buildMergeSystemPrompt, buildMergeUserMessage, buildReduceUserMessage } from './prompt'

const blankTitleInput = {
  title: '',
  rawNotesMarkdown: '',
  segments: [{ speaker: 'You' as const, text: 'We discussed the Acme rollout.', startMs: 0 }]
}

test('merge prompt asks the model to infer a title when none was supplied', () => {
  const prompt = buildMergeUserMessage(blankTitleInput)
  assert.match(prompt, /Title: \(not provided/i)
  assert.match(prompt, /infer a concise, descriptive title/i)
  assert.doesNotMatch(prompt, /Untitled meeting/)
})

test('reduce prompt retains the infer-title instruction for long meetings', () => {
  const prompt = buildReduceUserMessage(blankTitleInput, 'Acme rollout facts', 2)
  assert.match(prompt, /Title: \(not provided/i)
  assert.match(prompt, /infer a concise, descriptive title/i)
})

test('merge prompt preserves a real supplied title', () => {
  const prompt = buildMergeUserMessage({ ...blankTitleInput, title: 'Acme kickoff' })
  assert.match(prompt, /Title: Acme kickoff/)
  assert.doesNotMatch(prompt, /infer a concise, descriptive title/i)
})

test('the speaker rule falls back to You/Them when nobody is identified', () => {
  const prompt = buildMergeSystemPrompt('general')
  assert.match(prompt, /"You" is the note-taker; "Them" is everyone else/)
})

test('named speakers replace You/Them in the merge and ask prompts', () => {
  const speakers = [
    { label: 'Sean', isSelf: true },
    { label: 'Priya Patel', isSelf: false }
  ]
  for (const prompt of [buildMergeSystemPrompt('general', speakers), buildAskSystemPrompt(speakers)]) {
    assert.match(prompt, /"Sean" is the note-taker/)
    assert.match(prompt, /"Priya Patel"/)
    assert.doesNotMatch(prompt, /"You" is the note-taker; "Them"/)
  }
})
