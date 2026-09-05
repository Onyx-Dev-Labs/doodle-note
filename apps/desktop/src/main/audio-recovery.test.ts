import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WinSessionRecorder } from './win-audio-recorder'

test(
  'startup recovery leaves active capture alone while recovering a crashed session',
  { skip: process.platform !== 'win32' },
  async () => {
    const { AudioService } = await import('./audio-service')
    const root = mkdtempSync(join(tmpdir(), 'audio-recovery-test-'))
    const service = new AudioService(root, '')
    const activeDir = service.beginSession('active-meeting')!
    const active = new WinSessionRecorder(activeDir)
    const orphanDir = join(root, 'crashed-meeting', '1000')
    const orphan = new WinSessionRecorder(orphanDir)
    try {
      active.write('mic', new Float32Array(16000).fill(0.2))
      orphan.write('mic', new Float32Array(16000).fill(0.1))
      orphan.abort()
      await service.recoverOrphans()
      assert.equal(existsSync(join(activeDir, 'audio.wav')), false)
      assert.equal(existsSync(join(activeDir, 'checkpoints', 'mic-000001.f32')), true)
      assert.equal(service.list('crashed-meeting').length, 1)
      active.write('mic', new Float32Array(16000).fill(0.3))
      const saved = await active.finish()
      assert.equal(saved?.durationMs, 2000)
    } finally {
      active.abort()
      orphan.abort()
      rmSync(root, { recursive: true, force: true })
    }
  }
)
