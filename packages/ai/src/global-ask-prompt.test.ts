import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildGlobalAskUserMessage } from './global-ask-prompt'

test('the first evidence item cannot bypass the legacy 20k character ceiling', () => {
  const message = buildGlobalAskUserMessage({
    meetings: [
      { title: 'Synthetic meeting', dateIso: '2026-10-17', notesMarkdown: 'x'.repeat(25_000) }
    ],
    history: [],
    question: 'What happened?'
  })
  assert.ok(message.length <= 20_000, `assembled ${message.length} characters`)
})

test('six oversized exchanges cannot escape the complete request budget', () => {
  const message = buildGlobalAskUserMessage({
    meetings: [],
    history: Array.from({ length: 6 }, () => ({
      question: 'q'.repeat(10_000),
      answer: 'a'.repeat(10_000)
    })),
    question: 'What happened?'
  })
  assert.ok(message.length <= 20_000, `assembled ${message.length} characters`)
})

import {
  buildGlobalAskPrompt,
  GLOBAL_ASK_SYSTEM_PROMPT,
  GlobalAskBudgetError,
  utf8TokenUpperBound,
  type GlobalAskBudget,
  type GlobalAskInput
} from './global-ask-prompt'

const budget: GlobalAskBudget = {
  contextWindowTokens: 8192,
  outputReserveTokens: 1024,
  safetyMarginTokens: 256,
  accounting: 'utf8-upper-bound',
  countInputTokens: (system, user) =>
    utf8TokenUpperBound(`[system]${system}[user]${user}[assistant]`)
}
const short: GlobalAskInput = {
  meetings: [
    {
      title: 'Synthetic',
      dateIso: '2026-10-17',
      notesMarkdown: 'Ada will send the plan.',
      sourceId: 'fixture-1'
    }
  ],
  history: [{ question: 'Who owns it?', answer: 'Ada.' }],
  question: 'What is next?'
}
const assertFits = (input: GlobalAskInput, limits = budget) => {
  const result = buildGlobalAskPrompt(input, limits)
  assert.equal(result.system, GLOBAL_ASK_SYSTEM_PROMPT)
  assert.equal(result.coverage.inputTokens, limits.countInputTokens(result.system, result.user))
  assert.ok(
    result.coverage.inputTokens + limits.outputReserveTokens + limits.safetyMarginTokens <=
      limits.contextWindowTokens
  )
  assert.ok(result.user.endsWith(input.question), 'question is preserved exactly')
  return result
}

test('short requests retain evidence, attribution and relevant conversation', () => {
  const result = assertFits(short)
  assert.match(result.user, /Ada will send the plan/)
  assert.match(result.user, /Q: Who owns it\?\nA: Ada\./)
  assert.deepEqual(result.coverage.includedSourceIds, ['fixture-1'])
  assert.deepEqual(result.coverage.includedHistoryIndexes, [0])
  assert.equal(result.coverage.omittedHistoryCount, 0)
})

test('budget includes system, wrappers, question, coverage marker and output reserve at the exact boundary', () => {
  const input = { meetings: [], history: [], question: 'boundary' }
  const result = assertFits(input)
  const exact = {
    ...budget,
    contextWindowTokens:
      result.coverage.inputTokens + budget.outputReserveTokens + budget.safetyMarginTokens
  }
  assertFits(input, exact)
  assert.throws(
    () =>
      buildGlobalAskPrompt(input, { ...exact, contextWindowTokens: exact.contextWindowTokens - 1 }),
    (error: unknown) => error instanceof GlobalAskBudgetError && error.code === 'question-too-large'
  )
})

test('oversized questions are rejected intact with an actionable error', () => {
  assert.throws(
    () => buildGlobalAskPrompt({ ...short, question: '界😀'.repeat(10_000) }, budget),
    /Shorten it or choose a model/
  )
})

test('first evidence, huge headings and Unicode reduce deterministically without broken surrogate pairs', () => {
  const input = {
    ...short,
    availableMeetingCount: 500,
    meetings: [
      { ...short.meetings[0]!, notesMarkdown: '界😀e\u0301'.repeat(10_000) },
      { title: 'x'.repeat(20_000), dateIso: '', notesMarkdown: 'huge heading' },
      { title: 'Small', dateIso: '2026-10-17', notesMarkdown: 'A later short fact.' }
    ]
  }
  const result = assertFits(input)
  assert.deepEqual(result, buildGlobalAskPrompt(input, budget))
  assert.equal(new TextDecoder().decode(new TextEncoder().encode(result.user)), result.user)
  assert.match(result.user, /shortened for context budget/)
  assert.match(result.user, /A later short fact/)
  assert.deepEqual(result.coverage.truncatedMeetingIndexes, [0])
  assert.deepEqual(result.coverage.omittedMeetingIndexes, [1])
  assert.match(result.user, /500 candidate meetings/)
  assert.match(result.user, /not an exhaustive library search/)
})

test('history is a contiguous recent suffix, bounded even for six huge exchanges', () => {
  const history = Array.from({ length: 6 }, () => ({
    question: 'q'.repeat(20_000),
    answer: 'a'.repeat(20_000)
  }))
  assert.deepEqual(assertFits({ ...short, history }).coverage.includedHistoryIndexes, [])
  assert.equal(assertFits({ ...short, history }).coverage.omittedHistoryCount, 6)
  const result = assertFits({
    ...short,
    history: [...history, { question: 'Latest?', answer: 'yes' }]
  })
  assert.deepEqual(result.coverage.includedHistoryIndexes, [6])
  assert.equal(result.coverage.omittedHistoryCount, 6)
})

test('pre-excerpted sources disclose shortening once, even if further shortened', () => {
  for (const notesMarkdown of ['Short excerpt', '長😀'.repeat(10_000)]) {
    const result = assertFits({
      ...short,
      meetings: [{ ...short.meetings[0]!, sourceTruncated: true, notesMarkdown }]
    })
    assert.deepEqual(result.coverage.truncatedMeetingIndexes, [0])
  }
})

test('token accounting is injectable and is never assumed to equal character length', () => {
  const input = { ...short, question: '😀界' }
  const result = assertFits(input)
  assert.ok(result.coverage.inputTokens > result.system.length + result.user.length)
  assert.throws(
    () => buildGlobalAskPrompt(short, { ...budget, countInputTokens: () => NaN }),
    /invalid token accounting/
  )
  assert.throws(
    () => buildGlobalAskPrompt(short, { ...budget, outputReserveTokens: 10_000 }),
    /no usable Ask context/
  )
})

test('mixed synthetic candidate sizes stay within the complete bound', () => {
  for (let n = 0; n < 60; n++) {
    const meetings = Array.from({ length: n }, (_, i) => ({
      title: `M${i}`,
      dateIso: '2026-10-17',
      notesMarkdown: 'x界😀'.repeat((i * 997 + n * 13) % 3000)
    }))
    assertFits({ ...short, meetings })
  }
})
