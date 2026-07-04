import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  ENGINE_EVENT_CHANNEL,
  ENGINE_START_CHANNEL,
  ENGINE_STOP_CHANNEL,
  type EngineApi,
  type EngineCommand,
  type EngineEvent,
  type EngineStartOptions,
  type EngineStartRequest
} from '../shared/engine-events'

const engineApi: EngineApi = {
  start(command: EngineCommand, filePath?: string, opts?: EngineStartOptions): void {
    const request: EngineStartRequest = { command, filePath, opts }
    ipcRenderer.send(ENGINE_START_CHANNEL, request)
  },

  stop(): void {
    ipcRenderer.send(ENGINE_STOP_CHANNEL)
  },

  onEvent(cb: (event: EngineEvent) => void): () => void {
    const listener = (_event: IpcRendererEvent, engineEvent: EngineEvent): void => {
      cb(engineEvent)
    }
    ipcRenderer.on(ENGINE_EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(ENGINE_EVENT_CHANNEL, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('engine', engineApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (defined in index.d.ts)
  window.engine = engineApi
}
