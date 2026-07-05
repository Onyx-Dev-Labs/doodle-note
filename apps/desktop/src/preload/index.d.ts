import type { CalendarApi } from '../shared/calendar-api'
import type { EngineApi } from '../shared/engine-events'
import type { FoldersApi } from '../shared/folders-api'
import type { MeetingsApi } from '../shared/meetings-api'
import type { NotesApi } from '../shared/notes-api'

declare global {
  interface Window {
    engine: EngineApi
    notes: NotesApi
    meetings: MeetingsApi
    folders: FoldersApi
    calendar: CalendarApi
  }
}

export {}
