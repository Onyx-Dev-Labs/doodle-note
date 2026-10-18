import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CloudNotesEngine } from './cloud-engine'
import { OLLAMA_GLOBAL_ASK_TEMPLATE } from './global-ask-model-budget'
import {
  GLOBAL_ASK_SYSTEM_PROMPT,
  GlobalAskBudgetError,
  utf8TokenUpperBound
} from './global-ask-prompt'

const input = { meetings: [], history: [], question: 'What happened?' }
const baseMetadata = {
  parameters: 'num_ctx 8192\n',
  template: OLLAMA_GLOBAL_ASK_TEMPLATE,
  model_info: { 'general.architecture': 'llama', 'llama.context_length': 131072 }
}
const chatResponse = () =>
  Response.json({
    id: 'fixture',
    object: 'chat.completion',
    created: 1,
    model: 'fixture',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Synthetic answer' },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
  })

test('Ollama embedded messages cannot bypass the budget even with an audited template and explicit request system', async () => {
  const previous = globalThis.fetch
  const inherited = 'inherited '.repeat(50_000)
  assert.equal(utf8TokenUpperBound(inherited), 500_000)
  let chatCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/show')) {
      return Response.json({
        ...baseMetadata,
        system: 'Default model system',
        messages: [{ role: 'system', content: inherited }]
      })
    }
    chatCalls++
    return chatResponse()
  }
  try {
    await assert.rejects(
      new CloudNotesEngine({ provider: 'ollama', apiKey: '' }).askAcrossMeetings(input),
      (error: unknown) =>
        error instanceof GlobalAskBudgetError &&
        error.code === 'unsupported-model-budget' &&
        /embedded messages/.test(error.message)
    )
    assert.equal(chatCalls, 0, 'reject before sending meeting content for generation')
  } finally {
    globalThis.fetch = previous
  }
})

test('Ollama rejects nonempty or malformed messages metadata regardless of model system metadata', async () => {
  const previous = globalThis.fetch
  let metadata: Record<string, unknown> = baseMetadata
  let chatCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/show')) return Response.json(metadata)
    chatCalls++
    return chatResponse()
  }
  try {
    for (const messages of [
      null,
      {},
      '',
      'messages',
      0,
      false,
      [null],
      [{}],
      [{ role: 'user', content: '' }],
      [{ role: 'assistant', content: 'seeded history' }]
    ]) {
      for (const system of [undefined, '', 'inherited '.repeat(50_000)]) {
        metadata = { ...baseMetadata, messages, ...(system === undefined ? {} : { system }) }
        await assert.rejects(
          new CloudNotesEngine({ provider: 'ollama', apiKey: '' }).askAcrossMeetings(input),
          (error: unknown) =>
            error instanceof GlobalAskBudgetError &&
            error.code === 'unsupported-model-budget' &&
            /embedded messages/.test(error.message)
        )
      }
    }
    assert.equal(chatCalls, 0)
  } finally {
    globalThis.fetch = previous
  }
})

test('absent/empty Ollama messages remain supported; the explicit request system overrides model system metadata', async () => {
  const previous = globalThis.fetch
  let metadata: Record<string, unknown> = baseMetadata
  const renderedCounts: number[] = []
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('http://localhost:11434/'))
    if (String(url).endsWith('/api/show')) return Response.json(metadata)
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
      max_tokens: number
    }
    assert.equal(body.messages.length, 2)
    assert.equal(body.messages[0]!.role, 'system')
    assert.equal(body.messages[0]!.content, GLOBAL_ASK_SYSTEM_PROMPT)
    assert.equal(body.max_tokens, 2048)
    // Ollama chatMessagesForRequest prepends embedded messages unconditionally,
    // but only prepends model.System when the request does not start with system.
    const rendered = [
      ...((metadata.messages as typeof body.messages | undefined) ?? []),
      ...body.messages
    ]
    if (body.messages[0]!.role !== 'system' && metadata.system) {
      rendered.unshift({ role: 'system', content: String(metadata.system) })
    }
    renderedCounts.push(
      rendered.reduce((sum, message) => sum + utf8TokenUpperBound(message.content), 0)
    )
    return chatResponse()
  }
  try {
    for (const messages of [undefined, []]) {
      for (const system of [undefined, '', 'inherited '.repeat(50_000)]) {
        metadata = {
          ...baseMetadata,
          ...(messages === undefined ? {} : { messages }),
          ...(system === undefined ? {} : { system })
        }
        const result = await new CloudNotesEngine({
          provider: 'ollama',
          apiKey: ''
        }).askAcrossMeetings(input)
        const coverage = result.coverage!
        assert.equal(coverage.inputTokens, renderedCounts.at(-1))
        assert.ok(
          coverage.inputTokens + coverage.outputReserveTokens + coverage.safetyMarginTokens <=
            coverage.contextWindowTokens
        )
      }
    }
    assert.equal(renderedCounts.length, 6)
    assert.equal(
      new Set(renderedCounts).size,
      1,
      'overridden model system never changes the effective prompt'
    )
  } finally {
    globalThis.fetch = previous
  }
})
