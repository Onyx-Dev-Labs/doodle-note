import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMergeUserMessage, buildReduceUserMessage } from './prompt'

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
