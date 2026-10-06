import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  withGenerationDeadline,
  GenerationError,
  requireCompleteOutput
} from './generation-control'

it('deadline aborts the producer and waits for native cleanup before rejecting', async () => {
  let cleaned = false
  const work = withGenerationDeadline(
    undefined,
    'condensing',
    async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      await new Promise((resolve) => setTimeout(resolve, 15))
      cleaned = true
      return 'late output'
    },
    5
  )
  await assert.rejects(
    work,
    (error: unknown) => error instanceof GenerationError && error.code === 'timeout'
  )
  assert.equal(cleaned, true)
})

it('user cancellation reaches the producer and rejects even a late successful response', async () => {
  const controller = new AbortController()
  const work = withGenerationDeadline(controller.signal, 'writing', async (signal) => {
    assert.equal(signal.aborted, false)
    controller.abort(new GenerationError('canceled', 'Canceled'))
    return 'late output'
  })
  await assert.rejects(
    work,
    (error: unknown) => error instanceof GenerationError && error.code === 'canceled'
  )
})

it('does not start preparation when already canceled', async () => {
  const controller = new AbortController()
  controller.abort(new GenerationError('canceled', 'Canceled'))
  await assert.rejects(
    withGenerationDeadline(controller.signal, 'preparing', async () => {
      assert.fail('must not prepare')
    }),
    /Canceled/
  )
})

it('rejects truncated native output instead of saving it as complete notes', () => {
  assert.throws(() => requireCompleteOutput('maxTokens', 'condensing'), /output limit/)
  assert.doesNotThrow(() => requireCompleteOutput('eogToken', 'writing'))
})
