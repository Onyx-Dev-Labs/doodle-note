import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { AudioApi, AudioPart } from '../shared/audio-api'
import type { EngineApi } from '../shared/engine-events'
import { libraryActivity } from './library-activity'
import { watchMeetingAudio } from '../renderer/src/lib/meeting-audio'

// Stub only Electron's transport. The service, preload, library IPC barrier,
// checkpoint merge and MeetingView's subscription are the production code.
const require = createRequire(import.meta.url)
const electronId = require.resolve('electron')
const electron = new Module(electronId)
const renderer = new EventEmitter()
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const exposed: Record<string, unknown> = {}
electron.exports = {
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  },
  ipcRenderer: Object.assign(renderer, {
    invoke: async (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
  }),
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      exposed[name] = api
    }
  }
}
require.cache[electronId] = electron
Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })

function checkpoint(root: string, meetingId: string, session = '1000'): string {
  const dir = join(root, meetingId, session)
  mkdirSync(join(dir, 'checkpoints'), { recursive: true })
  writeFileSync(join(dir, 'checkpoints', 'mic-000001.f32'), Buffer.alloc(16000 * 4))
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      sampleRate: 16000,
      channels: { mic: { epochMs: 1200 } }
    })
  )
  return dir
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('an already-open meeting receives recovered audio through main IPC and preload without restart', async () => {
  const { AudioService } = await import('./audio-service')
  await import('../preload/index')
  const root = mkdtempSync(join(tmpdir(), 'audio-notification-test-'))
  checkpoint(root, 'recovered-meeting')
  const sent: Array<{ channel: string; payload: unknown }> = []
  const service = new AudioService(
    root,
    '',
    () => {},
    (channel: string, payload: unknown) => {
      sent.push({ channel, payload })
      renderer.emit(channel, {}, payload)
    }
  )
  service.registerIpc()
  const audio = exposed.audio as AudioApi
  const engine = exposed.engine as EngineApi
  const engineEvents: unknown[] = []
  const stopEngine = engine.onEvent((event) => engineEvents.push(event))
  let visible: AudioPart[] = []
  const stop = watchMeetingAudio('recovered-meeting', audio, engine, (parts) => {
    visible = parts
  })
  try {
    await settle()
    assert.equal(visible.length, 0, 'the meeting is open before delayed recovery starts')
    await libraryActivity.run(() => service.recoverOrphans())
    await settle()
    assert.equal(
      (await audio.list('recovered-meeting'))[0]?.durationMs,
      1000,
      'recovery itself succeeded and saved timing metadata'
    )
    assert.equal(
      visible[0]?.durationMs,
      1000,
      'the mounted meeting must show recovered audio without reopening or restarting'
    )
    assert.deepEqual(sent, [
      { channel: 'audio:changed', payload: { meetingId: 'recovered-meeting' } }
    ])
    assert.deepEqual(engineEvents, [], 'orphan recovery must not impersonate the current capture')
    const playback = await audio.read(visible[0]!.url)
    assert.equal(playback?.mime, 'audio/wav')
    assert.equal(Buffer.from(playback!.bytes).toString('ascii', 0, 4), 'RIFF')
  } finally {
    stop()
    stopEngine()
    rmSync(root, { recursive: true, force: true })
  }
})

test('recovery skips active sessions and no-ops without notifying, and publishes each recovered meeting', async () => {
  const { AudioService } = await import('./audio-service')
  const root = mkdtempSync(join(tmpdir(), 'audio-notification-test-'))
  const changed: unknown[] = []
  const service = new AudioService(
    root,
    '',
    () => {},
    (_channel, payload) => changed.push(payload)
  )
  const activeDir = service.beginSession('active-meeting')!
  checkpoint(root, 'active-meeting', basename(activeDir))
  checkpoint(root, 'meeting-a')
  checkpoint(root, 'meeting-b')
  const empty = join(root, 'empty-meeting', '1000')
  mkdirSync(empty, { recursive: true })
  const failed = checkpoint(root, 'failed-meeting')
  writeFileSync(join(failed, 'checkpoints', 'mic-000001.f32'), Buffer.alloc(0))
  try {
    await service.recoverOrphans()
    assert.deepEqual(changed, [{ meetingId: 'meeting-a' }, { meetingId: 'meeting-b' }])
    assert.equal(existsSync(join(activeDir, 'checkpoints', 'mic-000001.f32')), true)
    assert.equal(existsSync(join(activeDir, 'audio.wav')), false)
    assert.equal(existsSync(join(failed, 'checkpoints', 'mic-000001.f32')), true)
    assert.equal(existsSync(empty), false)
    await service.recoverOrphans()
    assert.equal(changed.length, 2, 'already recovered parts and unsuccessful merges do not notify')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('native recovery publishes only a committed part in the owning available library', async (t) => {
  const { AudioService } = await import('./audio-service')
  for (const outcome of [
    'saved',
    'no-result',
    'no-file',
    'metadata-failure',
    'unavailable',
    'switched'
  ] as const) {
    await t.test(outcome, async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'audio-notification-test-'))
      const dir = join(root, 'meeting-a', '1000')
      mkdirSync(join(dir, 'checkpoints'), { recursive: true })
      writeFileSync(join(dir, 'checkpoints', 'mic-000001.caf'), 'synthetic checkpoint')
      const binary = join(root, 'engine-placeholder')
      writeFileSync(binary, '')
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true
      })
      t.mock.method(childProcess, 'spawn', (() => child) as unknown as typeof childProcess.spawn)
      let currentRoot = root
      let available = true
      const changed: unknown[] = []
      const service = new AudioService(
        () => currentRoot,
        binary,
        () => {
          if (!available) throw new Error('library unavailable')
        },
        (_channel, payload) => {
          changed.push(payload)
          assert.equal(
            service.list('meeting-a')[0]?.durationMs,
            59691,
            'metadata must be visible before notification'
          )
        }
      )
      try {
        const recovering = libraryActivity.run(() => service.recoverOrphans())
        let transferred = false
        const transfer = libraryActivity.exclusive(async () => {
          transferred = true
        })
        await settle()
        assert.equal(transferred, false, 'the library cannot relocate while recovery owns it')
        if (outcome !== 'no-file') writeFileSync(join(dir, 'audio.m4a'), 'synthetic merged output')
        if (outcome === 'metadata-failure') mkdirSync(join(dir, 'part.json'))
        if (outcome === 'unavailable') available = false
        if (outcome === 'switched') currentRoot = join(root, 'different-library')
        child.stdout.write(
          outcome === 'no-result'
            ? 'merge failed\n'
            : JSON.stringify({ event: 'audio', startEpochMs: 1200, durationMs: 59691 }) + '\n'
        )
        child.emit('close', 0)
        if (outcome === 'unavailable') await assert.rejects(recovering, /library unavailable/)
        else await recovering
        await transfer
        assert.equal(transferred, true)
        assert.deepEqual(changed, outcome === 'saved' ? [{ meetingId: 'meeting-a' }] : [])
      } finally {
        child.stdout.destroy()
        child.stderr.destroy()
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
})
