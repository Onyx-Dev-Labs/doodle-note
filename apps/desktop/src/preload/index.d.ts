import type { EngineApi } from '../shared/engine-events'
import type { MeetingsApi } from '../shared/meetings-api'
import type { NotesApi } from '../shared/notes-api'

declare global {
  interface Window {
    engine: EngineApi
    notes: NotesApi
    meetings: MeetingsApi
  }
}

export {}
