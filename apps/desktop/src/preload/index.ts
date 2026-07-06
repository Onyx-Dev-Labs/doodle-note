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
  NOTES_ASK_GLOBAL_CHANNEL,
  NOTES_ASK_GLOBAL_TOKEN_CHANNEL,
  NOTES_ASK_TOKEN_CHANNEL,
  NOTES_DOWNLOAD_PROGRESS_CHANNEL,
  NOTES_ENHANCE_CHANNEL,
  NOTES_ENHANCE_TOKEN_CHANNEL,
  NOTES_GET_SETTINGS_CHANNEL,
  NOTES_GLOBAL_CHAT_CLEAR_CHANNEL,
  NOTES_GLOBAL_CHAT_GET_CHANNEL,
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
  type GlobalAskRequest,
  type GlobalAskResult,
  type GlobalAskTokenEvent,
  type GlobalChatEntry,
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
import {
  FOLDERS_CREATE_CHANNEL,
  FOLDERS_DELETE_CHANNEL,
  FOLDERS_LIST_CHANNEL,
  FOLDERS_RENAME_CHANNEL,
  type FolderRecord,
  type FoldersApi
} from '../shared/folders-api'
import {
  SYNC_CONNECT_CHANNEL,
  SYNC_DISCONNECT_CHANNEL,
  SYNC_GET_STATUS_CHANNEL,
  SYNC_NOW_CHANNEL,
  SYNC_SET_ENABLED_CHANNEL,
  SYNC_STATUS_EVENT_CHANNEL,
  type SyncApi,
  type SyncStatus
} from '../shared/sync-api'
import {
  CALENDAR_CONNECT_CHANNEL,
  CALENDAR_DISCONNECT_CHANNEL,
  CALENDAR_EVENTS_CHANNEL,
  CALENDAR_GET_STATE_CHANNEL,
  CALENDAR_REFRESH_CHANNEL,
  CALENDAR_SET_CONFIG_CHANNEL,
  CALENDAR_SET_PREFS_CHANNEL,
  CALENDAR_START_MEETING_CHANNEL,
  type CalendarApi,
  type CalendarConfigUpdate,
  type CalendarPrefsUpdate,
  type CalendarStartMeetingEvent,
  type CalendarState
} from '../shared/calendar-api'

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

  askGlobal(req: GlobalAskRequest): Promise<GlobalAskResult> {
    return ipcRenderer.invoke(NOTES_ASK_GLOBAL_CHANNEL, req) as Promise<GlobalAskResult>
  },

  getGlobalChat(): Promise<GlobalChatEntry[]> {
    return ipcRenderer.invoke(NOTES_GLOBAL_CHAT_GET_CHANNEL) as Promise<GlobalChatEntry[]>
  },

  clearGlobalChat(): Promise<void> {
    return ipcRenderer.invoke(NOTES_GLOBAL_CHAT_CLEAR_CHANNEL) as Promise<void>
  },

  onDownloadProgress(cb: (ev: DownloadProgressEvent) => void): () => void {
    return subscribe(NOTES_DOWNLOAD_PROGRESS_CHANNEL, cb)
  },

  onEnhanceToken(cb: (ev: EnhanceTokenEvent) => void): () => void {
    return subscribe(NOTES_ENHANCE_TOKEN_CHANNEL, cb)
  },

  onAskToken(cb: (ev: AskTokenEvent) => void): () => void {
    return subscribe(NOTES_ASK_TOKEN_CHANNEL, cb)
  },

  onGlobalAskToken(cb: (ev: GlobalAskTokenEvent) => void): () => void {
    return subscribe(NOTES_ASK_GLOBAL_TOKEN_CHANNEL, cb)
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

const foldersApi: FoldersApi = {
  list(): Promise<FolderRecord[]> {
    return ipcRenderer.invoke(FOLDERS_LIST_CHANNEL) as Promise<FolderRecord[]>
  },

  create(name: string): Promise<FolderRecord> {
    return ipcRenderer.invoke(FOLDERS_CREATE_CHANNEL, name) as Promise<FolderRecord>
  },

  rename(id: string, name: string): Promise<FolderRecord | null> {
    return ipcRenderer.invoke(FOLDERS_RENAME_CHANNEL, id, name) as Promise<FolderRecord | null>
  },

  remove(id: string): Promise<void> {
    return ipcRenderer.invoke(FOLDERS_DELETE_CHANNEL, id) as Promise<void>
  }
}

const calendarApi: CalendarApi = {
  getState(): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_GET_STATE_CHANNEL) as Promise<CalendarState>
  },

  setConfig(config: CalendarConfigUpdate): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_SET_CONFIG_CHANNEL, config) as Promise<CalendarState>
  },

  setPrefs(update: CalendarPrefsUpdate): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_SET_PREFS_CHANNEL, update) as Promise<CalendarState>
  },

  connect(): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_CONNECT_CHANNEL) as Promise<CalendarState>
  },

  disconnect(): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_DISCONNECT_CHANNEL) as Promise<CalendarState>
  },

  refresh(): Promise<CalendarState> {
    return ipcRenderer.invoke(CALENDAR_REFRESH_CHANNEL) as Promise<CalendarState>
  },

  onEvents(cb: (state: CalendarState) => void): () => void {
    return subscribe(CALENDAR_EVENTS_CHANNEL, cb)
  },

  onStartMeeting(cb: (ev: CalendarStartMeetingEvent) => void): () => void {
    return subscribe(CALENDAR_START_MEETING_CHANNEL, cb)
  }
}

const syncApi: SyncApi = {
  getStatus(): Promise<SyncStatus> {
    return ipcRenderer.invoke(SYNC_GET_STATUS_CHANNEL) as Promise<SyncStatus>
  },

  connect(): Promise<SyncStatus> {
    return ipcRenderer.invoke(SYNC_CONNECT_CHANNEL) as Promise<SyncStatus>
  },

  disconnect(): Promise<SyncStatus> {
    return ipcRenderer.invoke(SYNC_DISCONNECT_CHANNEL) as Promise<SyncStatus>
  },

  setEnabled(enabled: boolean): Promise<SyncStatus> {
    return ipcRenderer.invoke(SYNC_SET_ENABLED_CHANNEL, enabled) as Promise<SyncStatus>
  },

  syncNow(): Promise<SyncStatus> {
    return ipcRenderer.invoke(SYNC_NOW_CHANNEL) as Promise<SyncStatus>
  },

  onStatus(cb: (status: SyncStatus) => void): () => void {
    return subscribe(SYNC_STATUS_EVENT_CHANNEL, cb)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('engine', engineApi)
    contextBridge.exposeInMainWorld('notes', notesApi)
    contextBridge.exposeInMainWorld('meetings', meetingsApi)
    contextBridge.exposeInMainWorld('folders', foldersApi)
    contextBridge.exposeInMainWorld('calendar', calendarApi)
    contextBridge.exposeInMainWorld('sync', syncApi)
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
  // @ts-ignore (defined in index.d.ts)
  window.folders = foldersApi
  // @ts-ignore (defined in index.d.ts)
  window.calendar = calendarApi
  // @ts-ignore (defined in index.d.ts)
  window.sync = syncApi
}
