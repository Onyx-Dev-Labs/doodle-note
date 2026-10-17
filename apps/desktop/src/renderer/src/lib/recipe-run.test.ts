import assert from 'node:assert/strict'
import { test } from 'node:test'
import { invalidateRecipeRun, registerRecipeRun, RecipeAttempts } from './recipe-run'

test('cancel during pending editor flush invalidates locally before an IPC producer exists', async () => {
  let invalidated = false
  let release!: () => void
  let generated = false
  const unregister = registerRecipeRun('synthetic', (reason) => {
    assert.equal(reason, 'canceled')
    invalidated = true
  })
  const pending = (async () => {
    await new Promise<void>((r) => {
      release = r
    })
    if (!invalidated) generated = true
  })()
  invalidateRecipeRun('other')
  assert.equal(invalidated, false)
  invalidateRecipeRun('synthetic', 'canceled')
  release()
  await pending
  unregister()
  assert.equal(generated, false)
})

test('ambiguous failure/cancel retries keep ID; success and changed recipe/scope mint distinct attempts', () => {
  const attempts = new RecipeAttempts()
  let serial = 0
  const mint = (): string => `run-${++serial}`
  assert.equal(attempts.begin('library/meeting/v1', mint), 'run-1')
  assert.equal(attempts.begin('library/meeting/v1', mint), 'run-1')
  attempts.complete('stale-run')
  assert.equal(attempts.begin('library/meeting/v1', mint), 'run-1')
  attempts.complete('run-1')
  assert.equal(attempts.begin('library/meeting/v1', mint), 'run-2')
  assert.equal(attempts.begin('other-library/meeting/v1', mint), 'run-3')
  assert.equal(attempts.begin('other-library/meeting/v2', mint), 'run-4')
})
