/**
 * Preload of Bark's hidden Windows capture window. It exposes only what capture
 * needs: control messages in, PCM frames and acknowledgements out, and the device
 * list. Nothing else of the app's API is reachable from this window.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  DICTATION_CAPTURE_CONTROL_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL,
  DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL,
  DICTATION_CAPTURE_READY_CHANNEL,
  DICTATION_CAPTURE_TEST_HOOKS_ARG,
  type DictationCaptureBridge
} from '../shared/dictation-capture-api'
import {
  ENGINE_AUDIO_CHANNEL,
  ENGINE_CAPTURE_STATUS_CHANNEL,
  type EngineCaptureControl,
  type EngineCaptureStatus,
  type EngineInputDevice
} from '../shared/engine-events'

const engine = {
  sendAudio(sessionId: number, channel: string, samples: Float32Array): void {
    ipcRenderer.send(ENGINE_AUDIO_CHANNEL, { sessionId, channel, samples })
  },
  reportCaptureStatus(status: EngineCaptureStatus): void {
    ipcRenderer.send(ENGINE_CAPTURE_STATUS_CHANNEL, status)
  }
}

const bridge: DictationCaptureBridge = {
  onControl(cb) {
    const listener = (_event: IpcRendererEvent, control: EngineCaptureControl): void => cb(control)
    ipcRenderer.on(DICTATION_CAPTURE_CONTROL_CHANNEL, listener)
    return () => ipcRenderer.removeListener(DICTATION_CAPTURE_CONTROL_CHANNEL, listener)
  },
  onDevicesRequest(cb) {
    const listener = (_event: IpcRendererEvent, payload: { requestId?: unknown }): void => {
      if (typeof payload?.requestId === 'string') cb(payload.requestId)
    }
    ipcRenderer.on(DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL, listener)
    return () => ipcRenderer.removeListener(DICTATION_CAPTURE_DEVICES_REQUEST_CHANNEL, listener)
  },
  replyDevices(requestId: string, devices: EngineInputDevice[]): void {
    ipcRenderer.send(DICTATION_CAPTURE_DEVICES_REPLY_CHANNEL, { requestId, devices })
  },
  ready(): void {
    ipcRenderer.send(DICTATION_CAPTURE_READY_CHANNEL)
  },
  testHooks: process.argv.includes(DICTATION_CAPTURE_TEST_HOOKS_ARG)
}

contextBridge.exposeInMainWorld('engine', engine)
contextBridge.exposeInMainWorld('dictationCapture', bridge)
