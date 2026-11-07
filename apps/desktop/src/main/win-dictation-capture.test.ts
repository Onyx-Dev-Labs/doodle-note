import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import {
  DICTATION_CAPTURE_CONTROL_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL,
  DICTATION_CAPTURE_READY_CHANNEL
} from '../shared/dictation-capture-api'
import type { EngineCaptureStatus } from '../shared/engine-events'

// A fake Electron: one BrowserWindow with a recording webContents, and an ipcMain we can emit on.
const require = createRequire(import.meta.url)
const loader = require('node:module') as { _load: (id: string, ...args: unknown[]) => unknown }
const originalLoad = loader._load

interface Sent {
  channel: string
  payload: unknown
}
class FakeWebContents extends EventEmitter {
  readonly sent: Sent[] = []
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
  setWindowOpenHandler(): void {
    /* no-op in the fake */
  }
}
class FakeWindow extends EventEmitter {
  static created: FakeWindow[] = []
  webContents = new FakeWebContents()
  destroyed = false
  constructor() {
    super()
    FakeWindow.created.push(this)
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    this.destroyed = true
    this.emit('closed')
  }
}
const ipcHandlers = new Map<string, Array<(event: unknown, payload: unknown) => void>>()
const fakeIpcMain = {
  on(channel: string, cb: (event: unknown, payload: unknown) => void): void {
    const list = ipcHandlers.get(channel) ?? []
    list.push(cb)
    ipcHandlers.set(channel, list)
  },
  removeListener(channel: string, cb: (event: unknown, payload: unknown) => void): void {
    ipcHandlers.set(
      channel,
      (ipcHandlers.get(channel) ?? []).filter((x) => x !== cb)
    )
  }
}
function emit(channel: string, event: unknown, payload: unknown): void {
  for (const cb of ipcHandlers.get(channel) ?? []) cb(event, payload)
}
loader._load = (id, ...args) =>
  id === 'electron'
    ? { BrowserWindow: FakeWindow, ipcMain: fakeIpcMain }
    : originalLoad(id, ...args)
const { WinDictationCapture } =
  require('./win-dictation-capture') as typeof import('./win-dictation-capture')
loader._load = originalLoad

function build(): {
  capture: InstanceType<typeof WinDictationCapture>
  loadCalls: FakeWindow[]
  lost: EngineCaptureStatus[]
} {
  FakeWindow.created = []
  ipcHandlers.clear()
  const loadCalls: FakeWindow[] = []
  const lost: EngineCaptureStatus[] = []
  const capture = new WinDictationCapture({
    preload: 'preload.js',
    load: async (window) => {
      loadCalls.push(window as unknown as FakeWindow)
    },
    testHooks: false,
    onCaptureLost: (status) => lost.push(status)
  })
  return { capture, loadCalls, lost }
}
const ready = (win: FakeWindow): void =>
  emit(DICTATION_CAPTURE_READY_CHANNEL, { sender: win.webContents }, undefined)

test('control messages are held until the capture page is ready, then flushed in order', () => {
  const { capture, loadCalls } = build()
  capture.control({ action: 'start', sessionId: 1, channels: ['mic'], profile: 'dictation' })
  const win = FakeWindow.created[0]!
  assert.equal(loadCalls.length, 1, 'the window is created and loaded once')
  assert.deepEqual(win.webContents.sent, [], 'nothing is sent before the page is ready')
  ready(win)
  assert.deepEqual(win.webContents.sent, [
    {
      channel: DICTATION_CAPTURE_CONTROL_CHANNEL,
      payload: { action: 'start', sessionId: 1, channels: ['mic'], profile: 'dictation' }
    }
  ])
  capture.control({ action: 'stop', sessionId: 1, profile: 'dictation' })
  const sent1: Sent[] = win.webContents.sent
  assert.equal(sent1[sent1.length - 1]?.channel, DICTATION_CAPTURE_CONTROL_CHANNEL)
  capture.dispose()
})

test('the device list is requested from the page and resolved from its reply', async () => {
  const { capture } = build()
  const promise = capture.listInputDevices()
  const win = FakeWindow.created[0]!
  ready(win)
  const sent2: Sent[] = win.webContents.sent
  const request = sent2.find((m) => m.channel === DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL)
  const requestId = (request?.payload as { requestId: string }).requestId
  const devices = [{ uid: 'mic-1', name: 'Microphone', isDefault: true }]
  emit(DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL, { sender: win.webContents }, { requestId, devices })
  assert.deepEqual(await promise, devices)
  capture.dispose()
})

test('a capture window that goes away mid-session reports the loss once', () => {
  const { capture, lost } = build()
  capture.control({ action: 'start', sessionId: 7, channels: ['mic'], profile: 'dictation' })
  const win = FakeWindow.created[0]!
  ready(win)
  win.destroy()
  assert.deepEqual(lost, [
    { type: 'error', sessionId: 7, message: 'The dictation microphone stopped unexpectedly.' }
  ])
  capture.dispose()
})

test('a stopped session that then loses its window does not report a loss', () => {
  const { capture, lost } = build()
  capture.control({ action: 'start', sessionId: 9, channels: ['mic'], profile: 'dictation' })
  const win = FakeWindow.created[0]!
  ready(win)
  capture.control({ action: 'stop', sessionId: 9, profile: 'dictation' })
  win.destroy()
  assert.deepEqual(lost, [])
  capture.dispose()
})
