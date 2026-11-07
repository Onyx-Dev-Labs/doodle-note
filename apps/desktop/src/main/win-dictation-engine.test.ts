import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EngineStartOptions } from '../shared/engine-events'
import { windowsInputStateUid, winDictationEngine } from './win-dictation-engine'

test('Bark asks the Windows engine for a raw dictation capture, and only that', async () => {
  const starts: EngineStartOptions[] = []
  let stopped = 0
  const engine = winDictationEngine(
    {
      tryStartLive: (opts) => {
        starts.push(opts)
        return { started: true }
      },
      stop: () => void stopped++,
      running: false,
      warm: true,
      dictationModelState: () => ({
        ready: true,
        downloadProgress: null,
        usingFallback: false,
        downloadFailed: false
      }),
      retryDictationModel: () => {}
    },
    {
      listInputDevices: async () => [
        { uid: 'abc', name: 'Microphone (USB Audio)', isDefault: true }
      ]
    }
  )
  assert.deepEqual(engine.tryStartLive({ source: 'mic', levels: true, inputDevice: 'abc' }), {
    started: true
  })
  assert.deepEqual(starts, [
    { source: 'mic', levels: true, inputDevice: 'abc', captureProfile: 'dictation' }
  ])
  engine.stop()
  assert.equal(stopped, 1)
  assert.equal(engine.warm, true)
  assert.equal(engine.running, false)
  assert.equal(engine.deviceName('abc'), null, 'unknown until listed')
  assert.deepEqual(await engine.listInputDevices?.(), [
    { uid: 'abc', name: 'Microphone (USB Audio)', isDefault: true }
  ])
  assert.equal(engine.deviceName('abc'), 'Microphone (USB Audio)')
  assert.deepEqual(engine.dictationModelState?.(), {
    ready: true,
    downloadProgress: null,
    usingFallback: false,
    downloadFailed: false
  })
})

test('a refusal from the engine is passed on unchanged', () => {
  const engine = winDictationEngine(
    {
      tryStartLive: () => ({
        started: false,
        reason: 'The speech engine is busy with another session.'
      }),
      stop: () => {},
      running: true,
      warm: false,
      dictationModelState: () => ({
        ready: false,
        downloadProgress: 0.5,
        usingFallback: true,
        downloadFailed: false
      }),
      retryDictationModel: () => {}
    },
    { listInputDevices: async () => [] }
  )
  assert.deepEqual(engine.tryStartLive({ source: 'mic' }), {
    started: false,
    reason: 'The speech engine is busy with another session.'
  })
})

test('the helper reads a microphone by its endpoint name, the default stays the default', () => {
  const names: Record<string, string> = { abc: 'Microphone (USB Audio)' }
  const lookup = (uid: string): string | null => names[uid] ?? null
  assert.equal(windowsInputStateUid(null, lookup), null)
  assert.equal(windowsInputStateUid('default', lookup), 'default')
  assert.equal(windowsInputStateUid('communications', lookup), 'communications')
  assert.equal(windowsInputStateUid('abc', lookup), 'name:Microphone (USB Audio)')
  assert.equal(windowsInputStateUid('gone', lookup), null)
})
