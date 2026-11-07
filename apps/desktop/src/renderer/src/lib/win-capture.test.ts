import assert from 'node:assert/strict'
import { test } from 'node:test'

interface TestNode {
  connect(): void
  disconnect(): void
}

type PortListener = ((event: { data: unknown }) => void) | null

/** Minimal AudioWorklet stand-ins: the test plays the audio thread's part. */
function installAudio(): {
  contexts: Array<{ closed: boolean; modules: string[] }>
  pumps: Array<{
    options: Record<string, unknown>
    fromWorklet(data: unknown): void
    toWorklet: unknown[]
    onFlush?: () => void
  }>
} {
  const contexts: Array<{ closed: boolean; modules: string[] }> = []
  const pumps: ReturnType<typeof installAudio>['pumps'] = []
  const node = (): TestNode => ({ connect: () => undefined, disconnect: () => undefined })

  class TestAudioContext {
    destination = {}
    closed = false
    modules: string[] = []
    audioWorklet = {
      addModule: async (url: string): Promise<void> => {
        this.modules.push(url)
      }
    }
    constructor() {
      contexts.push(this)
    }
    createMediaStreamSource(): TestNode {
      return node()
    }
    createGain(): TestNode & { gain: { value: number } } {
      return { ...node(), gain: { value: 1 } }
    }
    async close(): Promise<void> {
      this.closed = true
    }
  }

  class TestAudioWorkletNode {
    readonly port: { onmessage: PortListener; postMessage(data: unknown): void }
    constructor(_context: unknown, name: string, options: Record<string, unknown>) {
      assert.equal(name, 'doodlenote-capture-pump')
      const pump: ReturnType<typeof installAudio>['pumps'][number] = {
        options,
        toWorklet: [],
        fromWorklet: (data) => this.port.onmessage?.({ data })
      }
      this.port = {
        onmessage: null,
        postMessage: (data: unknown) => {
          pump.toWorklet.push(data)
          pump.onFlush?.()
        }
      }
      pumps.push(pump)
    }
    connect(): void {
      /* The test drives the pump directly. */
    }
    disconnect(): void {
      /* Nothing to release in the stand-in. */
    }
  }

  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: TestAudioContext })
  Object.defineProperty(globalThis, 'AudioWorkletNode', {
    configurable: true,
    value: TestAudioWorkletNode
  })
  return { contexts, pumps }
}

function testStream(onStop: () => void): MediaStream {
  return {
    getTracks: () => [{ stop: onStop }],
    getAudioTracks: () => [{}],
    getVideoTracks: () => [],
    removeTrack: () => {}
  } as unknown as MediaStream
}

test('a microphone permission result cannot reopen capture after Stop', async () => {
  let resolveMicrophone!: (stream: MediaStream) => void
  const microphone = new Promise<MediaStream>((resolve) => {
    resolveMicrophone = resolve
  })
  let stoppedTracks = 0
  const { contexts } = installAudio()
  const statuses: Array<{ type: string; sessionId: number }> = []
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => microphone } }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      engine: {
        sendAudio: () => undefined,
        reportCaptureStatus(status: { type: string; sessionId: number }) {
          statuses.push(status)
        }
      }
    }
  })

  const { setWinCaptureWorkletUrl, startWinCapture, stopWinCapture } = await import('./win-capture')
  setWinCaptureWorkletUrl('test://capture-worklet.js')
  const starting = startWinCapture(7, ['mic'])
  await stopWinCapture(7)
  resolveMicrophone(testStream(() => stoppedTracks++))
  await starting

  assert.equal(stoppedTracks, 1)
  assert.equal(contexts.length, 0)
  assert.deepEqual(statuses, [{ type: 'drained', sessionId: 7 }])
})

test('the worklet pump keeps ready, PCM, final partial frame and drained in IPC order', async () => {
  const events: string[] = []
  let stoppedTracks = 0
  const { contexts, pumps } = installAudio()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => testStream(() => stoppedTracks++) } }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      engine: {
        sendAudio(sessionId: number, channel: string, samples: Float32Array) {
          events.push(`audio:${sessionId}:${channel}:${samples.length}`)
        },
        reportCaptureStatus(status: { type: string; sessionId: number }) {
          events.push(`${status.type}:${status.sessionId}`)
        }
      }
    }
  })

  const { setWinCaptureWorkletUrl, startWinCapture, stopWinCapture } = await import('./win-capture')
  setWinCaptureWorkletUrl('test://capture-worklet.js')
  await startWinCapture(8, ['mic'])
  assert.deepEqual(contexts[0]!.modules, ['test://capture-worklet.js'])
  const pump = pumps[0]!
  // Same mono down-mix as the former ScriptProcessorNode(4096, 1, 1).
  assert.equal(pump.options.channelCount, 1)
  assert.equal(pump.options.channelCountMode, 'explicit')
  assert.equal(pump.options.channelInterpretation, 'speakers')
  pump.fromWorklet({ type: 'pcm', samples: new Float32Array(4096) })
  // On Stop the audio thread hands over its final partial frame, then confirms.
  pump.onFlush = () => {
    pump.fromWorklet({ type: 'pcm', samples: new Float32Array(100) })
    pump.fromWorklet({ type: 'flushed' })
  }
  await stopWinCapture(8)
  pump.fromWorklet({ type: 'pcm', samples: new Float32Array(7) })

  assert.deepEqual(pump.toWorklet, [{ type: 'flush' }])
  assert.deepEqual(events, ['ready:8', 'audio:8:mic:4096', 'audio:8:mic:100', 'drained:8'])
  assert.equal(stoppedTracks, 1)
  assert.equal(contexts[0]!.closed, true)
})

test('Stop does not wait forever for a pump that never confirms its flush', async () => {
  const events: string[] = []
  installAudio()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => testStream(() => undefined) } }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      engine: {
        sendAudio: () => undefined,
        reportCaptureStatus(status: { type: string; sessionId: number }) {
          events.push(`${status.type}:${status.sessionId}`)
        }
      }
    }
  })
  const { setWinCaptureWorkletUrl, startWinCapture, stopWinCapture } = await import('./win-capture')
  setWinCaptureWorkletUrl('test://capture-worklet.js')
  await startWinCapture(9, ['mic'])
  const began = Date.now()
  await stopWinCapture(9)
  assert.ok(Date.now() - began < 2000)
  assert.deepEqual(events, ['ready:9', 'drained:9'])
})

test('meetings keep voice processing and 4096-sample frames; dictation records raw in small frames', async () => {
  const constraints: MediaStreamConstraints[] = []
  const { pumps } = installAudio()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (c: MediaStreamConstraints) => {
          constraints.push(c)
          return testStream(() => undefined)
        }
      }
    }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { engine: { sendAudio: () => undefined, reportCaptureStatus: () => undefined } }
  })
  const { setWinCaptureWorkletUrl, startWinCapture, stopWinCapture } = await import('./win-capture')
  setWinCaptureWorkletUrl('test://capture-worklet.js')
  await startWinCapture(20, ['mic'], 'mic-1')
  assert.deepEqual(constraints.at(-1), {
    audio: {
      deviceId: { exact: 'mic-1' },
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  assert.equal(pumps.at(-1)!.options.processorOptions, undefined)
  await stopWinCapture(20)

  await startWinCapture(21, ['mic'], undefined, { raw: true, frameSamples: 1024 })
  assert.deepEqual(constraints.at(-1), {
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  })
  assert.deepEqual(pumps.at(-1)!.options.processorOptions, { frameSamples: 1024 })
  await stopWinCapture(21)

  // A substitute source (the test fixture) replaces getUserMedia and gets the same constraints.
  const substituted: MediaStreamConstraints[] = []
  await startWinCapture(22, ['mic'], undefined, {
    raw: true,
    acquireMicrophone: async (c) => {
      substituted.push(c)
      return testStream(() => undefined)
    }
  })
  assert.equal(substituted.length, 1)
  assert.equal(constraints.length, 2, 'the real microphone was not opened')
  await stopWinCapture(22)
})
