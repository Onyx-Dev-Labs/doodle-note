import type { SourcesApi } from '../shared/source-api'
import type { DictationApi } from '../shared/dictation-api'
import type { RecipesApi } from '../shared/recipes-api'
import type { TextImporterApi } from '../shared/text-import-api'
import type { StorageApi } from '../shared/storage-api'
import type { RecordingApi } from '../shared/recording-api'
import type { AudioApi } from '../shared/audio-api'
import type { ImporterApi } from '../shared/import-api'
import type { WizardApi } from '../shared/wizard-api'
import type { ExporterApi } from '../shared/export-api'
import type { CalendarApi } from '../shared/calendar-api'
import type { DetectApi } from '../shared/detect-api'
import type { EngineApi } from '../shared/engine-events'
import type { FoldersApi } from '../shared/folders-api'
import type { IntegrationsApi } from '../shared/integrations-api'
import type { MediaApi } from '../shared/media-api'
import type { MeetingsApi } from '../shared/meetings-api'
import type { NotesApi } from '../shared/notes-api'
import type { SyncApi } from '../shared/sync-api'
import type { ThemeApi } from '../shared/theme-api'
import type { UpdateApi } from '../shared/update-api'
import type { InstallMigrationApi } from '../shared/install-migration-api'

declare global {
  interface Window {
    storage: StorageApi
    dictation: DictationApi
    recording: RecordingApi
    engine: EngineApi
    notes: NotesApi
    recipes: RecipesApi
    meetings: MeetingsApi
    sources: SourcesApi
    folders: FoldersApi
    calendar: CalendarApi
    sync: SyncApi
    media: MediaApi
    detect: DetectApi
    themeNative: ThemeApi
    updates: UpdateApi
    /** Windows only (see src/shared/install-migration-api.ts). */
    installMigration?: InstallMigrationApi
    integrations: IntegrationsApi
    audio: AudioApi
    importer: ImporterApi
    textImporter: TextImporterApi
    wizard: WizardApi
    exporter: ExporterApi
    /** process.platform of the host, for presentation only. Absent in tests. */
    appPlatform?: string
  }
}

export {}
