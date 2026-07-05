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
import {
  NOTES_ACTIVATE_MODEL_CHANNEL,
  NOTES_ASK_CHANNEL,
  NOTES_ASK_TOKEN_CHANNEL,
  NOTES_DOWNLOAD_PROGRESS_CHANNEL,
  NOTES_ENHANCE_CHANNEL,
  NOTES_ENHANCE_TOKEN_CHANNEL,
  NOTES_GET_SETTINGS_CHANNEL,
  NOTES_MODELS_CHANNEL,
  NOTES_SET_SETTINGS_CHANNEL,
  type ActivateModelResult,
  type AskRequest,
  type AskResult,
  type AskTokenEvent,
  type DownloadProgressEvent,
  type EnhanceRequest,
  type EnhanceResult,
  type EnhanceTokenEvent,
  type NotesApi,
  type NotesModelsResponse,
  type NotesSettingsUpdate,
  type NotesSettingsView
} from '../shared/notes-api'
import {
  MEETINGS_DELETE_CHANNEL,
  MEETINGS_GET_CHANNEL,
  MEETINGS_LIST_CHANNEL,
  MEETINGS_UPSERT_CHANNEL,
  type MeetingRecord,
  type MeetingSummary,
  type MeetingUpsert,
  type MeetingsApi
} from '../shared/meetings-api'

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

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    cb(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const notesApi: NotesApi = {
  models(): Promise<NotesModelsResponse> {
    return ipcRenderer.invoke(NOTES_MODELS_CHANNEL) as Promise<NotesModelsResponse>
  },

  activateModel(modelId: string): Promise<ActivateModelResult> {
    return ipcRenderer.invoke(NOTES_ACTIVATE_MODEL_CHANNEL, modelId) as Promise<ActivateModelResult>
  },

  getSettings(): Promise<NotesSettingsView> {
    return ipcRenderer.invoke(NOTES_GET_SETTINGS_CHANNEL) as Promise<NotesSettingsView>
  },

  setSettings(update: NotesSettingsUpdate): Promise<NotesSettingsView> {
    return ipcRenderer.invoke(NOTES_SET_SETTINGS_CHANNEL, update) as Promise<NotesSettingsView>
  },

  enhance(input: EnhanceRequest): Promise<EnhanceResult> {
    return ipcRenderer.invoke(NOTES_ENHANCE_CHANNEL, input) as Promise<EnhanceResult>
  },

  ask(req: AskRequest): Promise<AskResult> {
    return ipcRenderer.invoke(NOTES_ASK_CHANNEL, req) as Promise<AskResult>
  },

  onDownloadProgress(cb: (ev: DownloadProgressEvent) => void): () => void {
    return subscribe(NOTES_DOWNLOAD_PROGRESS_CHANNEL, cb)
  },

  onEnhanceToken(cb: (ev: EnhanceTokenEvent) => void): () => void {
    return subscribe(NOTES_ENHANCE_TOKEN_CHANNEL, cb)
  },

  onAskToken(cb: (ev: AskTokenEvent) => void): () => void {
    return subscribe(NOTES_ASK_TOKEN_CHANNEL, cb)
  }
}

const meetingsApi: MeetingsApi = {
  list(): Promise<MeetingSummary[]> {
    return ipcRenderer.invoke(MEETINGS_LIST_CHANNEL) as Promise<MeetingSummary[]>
  },

  get(id: string): Promise<MeetingRecord | null> {
    return ipcRenderer.invoke(MEETINGS_GET_CHANNEL, id) as Promise<MeetingRecord | null>
  },

  upsert(meeting: MeetingUpsert): Promise<MeetingRecord> {
    return ipcRenderer.invoke(MEETINGS_UPSERT_CHANNEL, meeting) as Promise<MeetingRecord>
  },

  delete(id: string): Promise<void> {
    return ipcRenderer.invoke(MEETINGS_DELETE_CHANNEL, id) as Promise<void>
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('engine', engineApi)
    contextBridge.exposeInMainWorld('notes', notesApi)
    contextBridge.exposeInMainWorld('meetings', meetingsApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (defined in index.d.ts)
  window.engine = engineApi
  // @ts-ignore (defined in index.d.ts)
  window.notes = notesApi
  // @ts-ignore (defined in index.d.ts)
  window.meetings = meetingsApi
}
