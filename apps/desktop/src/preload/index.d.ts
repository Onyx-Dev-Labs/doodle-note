import type { CalendarApi } from '../shared/calendar-api'
import type { DetectApi } from '../shared/detect-api'
import type { EngineApi } from '../shared/engine-events'
import type { FoldersApi } from '../shared/folders-api'
import type { MediaApi } from '../shared/media-api'
import type { MeetingsApi } from '../shared/meetings-api'
import type { NotesApi } from '../shared/notes-api'
import type { SyncApi } from '../shared/sync-api'

declare global {
  interface Window {
    engine: EngineApi
    notes: NotesApi
    meetings: MeetingsApi
    folders: FoldersApi
    calendar: CalendarApi
    sync: SyncApi
    media: MediaApi
    detect: DetectApi
  }
}

export {}
