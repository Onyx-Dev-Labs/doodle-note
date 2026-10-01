import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { transcribeFileToSegments } from './import-logic'

test(
  'batch cancellation reaps a real child before returning',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doodle-cancel-fixture-'))
    const engine = join(dir, 'fixture-engine')
    writeFileSync(
      engine,
      '#!/bin/sh\nprintf \'{"event":"status","stage":"transcribing"}\\n\'\nexec sleep 30\n',
      { mode: 0o755 }
    )
    try {
      const controller = new AbortController()
      const result = transcribeFileToSegments(engine, 'synthetic.wav', () => controller.abort(), {
        signal: controller.signal
      })
      await assert.rejects(result, { name: 'AbortError' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test('already canceled batch never starts the executable', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    transcribeFileToSegments('/does-not-exist', 'fixture.wav', undefined, {
      signal: controller.signal
    }),
    { name: 'AbortError' }
  )
})
