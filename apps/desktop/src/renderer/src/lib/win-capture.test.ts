import assert from 'node:assert/strict'
import { test } from 'node:test'

test('a microphone permission result cannot reopen capture after Stop', async () => {
  let resolveMicrophone!: (stream: MediaStream) => void
  const microphone = new Promise<MediaStream>((resolve) => {
    resolveMicrophone = resolve
  })
  let stoppedTracks = 0
  const stream = {
    getTracks: () => [{ stop: () => stoppedTracks++ }],
    getAudioTracks: () => [{}],
    getVideoTracks: () => [],
    removeTrack: () => {}
  } as unknown as MediaStream
  const contexts: Array<{ closed: boolean }> = []
  const statuses: Array<{ type: string; sessionId: number }> = []

  class TestAudioContext {
    destination = {}
    closed = false

    constructor() {
      contexts.push(this)
    }

    createMediaStreamSource(): { connect(): void } {
      return { connect: () => undefined }
    }

    createScriptProcessor(): { connect(): void; onaudioprocess: unknown } {
      return { connect: () => undefined, onaudioprocess: null }
    }

    createGain(): { connect(): void; gain: { value: number } } {
      return { connect: () => undefined, gain: { value: 1 } }
    }

    async close(): Promise<void> {
      this.closed = true
    }
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => microphone } }
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: TestAudioContext
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

  const { startWinCapture, stopWinCapture } = await import('./win-capture')
  const starting = startWinCapture(7, ['mic'])
  stopWinCapture(7)
  resolveMicrophone(stream)
  await starting

  assert.equal(stoppedTracks, 1)
  assert.equal(contexts.length, 0)
  assert.deepEqual(statuses, [{ type: 'drained', sessionId: 7 }])
})

test('ready, PCM, and drained acknowledgements preserve renderer IPC order', async () => {
  const events: string[] = []
  let stoppedTracks = 0
  const stream = {
    getTracks: () => [{ stop: () => stoppedTracks++ }],
    getAudioTracks: () => [{}],
    getVideoTracks: () => [],
    removeTrack: () => {}
  } as unknown as MediaStream
  type AudioCallback = (event: { inputBuffer: { getChannelData(): Float32Array } }) => void
  interface TestNode {
    connect(): void
    disconnect(): void
  }
  interface TestProcessor extends TestNode {
    onaudioprocess: AudioCallback | null
  }
  let processor: TestProcessor | undefined
  const node = (): TestNode => ({
    connect: () => undefined,
    disconnect: () => undefined
  })

  class TestAudioContext {
    destination = {}
    createMediaStreamSource(): TestNode {
      return node()
    }
    createScriptProcessor(): TestProcessor {
      processor = { ...node(), onaudioprocess: null }
      return processor
    }
    createGain(): TestNode & { gain: { value: number } } {
      return { ...node(), gain: { value: 1 } }
    }
    async close(): Promise<void> {
      await Promise.resolve()
    }
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } }
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: TestAudioContext
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      engine: {
        sendAudio(sessionId: number) {
          events.push(`audio:${sessionId}`)
        },
        reportCaptureStatus(status: { type: string; sessionId: number }) {
          events.push(`${status.type}:${status.sessionId}`)
        }
      }
    }
  })

  const { startWinCapture, stopWinCapture } = await import('./win-capture')
  await startWinCapture(8, ['mic'])
  const staleCallback = processor?.onaudioprocess
  assert.ok(staleCallback)
  staleCallback({ inputBuffer: { getChannelData: () => new Float32Array([0.5]) } })
  stopWinCapture(8)
  staleCallback({ inputBuffer: { getChannelData: () => new Float32Array([0.75]) } })

  assert.deepEqual(events, ['ready:8', 'audio:8', 'drained:8'])
  assert.equal(stoppedTracks, 1)
})
