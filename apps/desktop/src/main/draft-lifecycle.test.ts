import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveDraftTitle,
  emptyDraftTitle,
  hasMeaningfulDraftContent,
  newDraftNeedsExitDecision
} from '../shared/draft-lifecycle'

test('a newly created blank draft asks for a save or discard decision', () => {
  const blank = { title: '', rawNotesMarkdown: '', segments: [] }
  assert.equal(newDraftNeedsExitDecision(true, blank), true)
  assert.equal(newDraftNeedsExitDecision(false, blank), false)
})

test('typing, a real title, or transcript makes a draft meaningful', () => {
  assert.equal(hasMeaningfulDraftContent({ title: '', rawNotesMarkdown: '- Call Pat' }), true)
  assert.equal(hasMeaningfulDraftContent({ title: 'Quarterly plan', rawNotesMarkdown: '' }), true)
  assert.equal(
    hasMeaningfulDraftContent({
      title: 'Untitled meeting',
      rawNotesMarkdown: '',
      segments: [{ text: 'We reviewed the onboarding timeline.' }]
    }),
    true
  )
})

test('generated H1 becomes the title without overwriting a supplied title', () => {
  assert.equal(
    deriveDraftTitle({
      title: '',
      rawNotesMarkdown: '- rough fragment',
      enhancedMarkdown: '# Acme onboarding timeline\n\n## Summary\nDetails'
    }),
    'Acme onboarding timeline'
  )
  assert.equal(
    deriveDraftTitle({
      title: 'Customer kickoff',
      rawNotesMarkdown: '',
      enhancedMarkdown: '# A different generated heading'
    }),
    'Customer kickoff'
  )
})

test('a generic generated H1 is skipped in favor of actual content', () => {
  assert.equal(
    deriveDraftTitle({
      title: '',
      rawNotesMarkdown: '',
      enhancedMarkdown: '# New Meeting\n\n## Summary\n\nReviewed the Acme rollout timeline.'
    }),
    'Reviewed the Acme rollout timeline'
  )
})

test('rough notes and transcript provide deterministic offline title fallbacks', () => {
  assert.equal(
    deriveDraftTitle({ title: 'New note', rawNotesMarkdown: '- [ ] Send revised quote to Megan' }),
    'Send revised quote to Megan'
  )
  assert.equal(
    deriveDraftTitle({
      title: 'Untitled meeting',
      rawNotesMarkdown: '',
      segments: [{ text: 'Review the MSP Sites launch plan and assign owners.' }]
    }),
    'Review the MSP Sites launch plan and assign owners'
  )
})

test('an attachment-only note is content and gets a useful fallback title', () => {
  const attachment = {
    kind: 'note' as const,
    title: '',
    rawNotesMarkdown: '![](doodle-media://attachment/image.png)'
  }
  assert.equal(hasMeaningfulDraftContent(attachment), true)
  assert.equal(deriveDraftTitle(attachment), 'Note with attachment')
})

test('saving an intentionally empty draft never uses Untitled', () => {
  const title = emptyDraftTitle('note', new Date('2026-08-01T14:30:00-05:00'))
  assert.match(title, /^Empty note — /)
  assert.doesNotMatch(title, /untitled/i)
})
