import assert from 'node:assert/strict'
import { test } from 'node:test'
import { approxTokens, dictationBudget, fastestInstalled } from './dictation-model'

test('a short request gets a small context and a short answer, far below the meeting defaults', () => {
  const budget = dictationBudget('x'.repeat(900), 'um so I was thinking we should move the meeting')
  assert.ok(budget.contextSize <= 2048, `context ${budget.contextSize}`)
  assert.ok(budget.contextSize >= 1024)
  assert.ok(budget.maxTokens >= 256 && budget.maxTokens <= 512, `answer ${budget.maxTokens}`)
  assert.equal(budget.contextSize % 256, 0)
})

test('the budget always leaves room for the request, the answer and the margin', () => {
  for (const chars of [10, 500, 3000, 9000, 20000]) {
    const system = 'x'.repeat(1200)
    const prompt = 'y'.repeat(chars)
    const { contextSize, maxTokens } = dictationBudget(system, prompt)
    const needed = approxTokens(system) + approxTokens(prompt) + maxTokens + 256
    assert.ok(contextSize >= Math.min(needed, 8192), `${chars} chars`)
    assert.ok(maxTokens <= 2048 && contextSize <= 8192)
  }
})

test('the quickest installed model is the smallest download', () => {
  const fast = { id: 'fast', sizeGB: 2.4 }
  const balanced = { id: 'balanced', sizeGB: 4.9 }
  const quality = { id: 'quality', sizeGB: 7.3 }
  assert.equal(fastestInstalled([quality, balanced, fast])?.id, 'fast')
  assert.equal(fastestInstalled([quality, balanced])?.id, 'balanced')
  assert.equal(fastestInstalled([quality])?.id, 'quality')
  assert.equal(fastestInstalled([]), null)
})
