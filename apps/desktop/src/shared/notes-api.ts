/**
 * Shared notes/AI IPC contract, used by main + preload + renderer.
 *
 * The main process owns the notes engines (packages/ai) and settings; the
 * renderer only ever sees this view of the world. Types are deliberately
 * standalone (not imported from @repo/ai) so the renderer bundle and the
 * web tsconfig never touch node-only code.
 */

import type { TranscriptSegment } from './engine-events'

export const NOTES_MODELS_CHANNEL = 'notes:models'
export const NOTES_ACTIVATE_MODEL_CHANNEL = 'notes:activate-model'
export const NOTES_GET_SETTINGS_CHANNEL = 'notes:get-settings'
export const NOTES_SET_SETTINGS_CHANNEL = 'notes:set-settings'
export const NOTES_ENHANCE_CHANNEL = 'notes:enhance'
/** main → renderer: model download progress while activating. */
export const NOTES_DOWNLOAD_PROGRESS_CHANNEL = 'notes:download-progress'
/** main → renderer: streamed tokens during an enhance run. */
export const NOTES_ENHANCE_TOKEN_CHANNEL = 'notes:enhance-token'

export type CloudProvider = 'anthropic' | 'openai'
export type EngineChoice = 'local' | 'cloud'

/** One catalog model + its state on this machine. */
export interface NotesModelInfo {
  id: string
  /** Friendly tier name: Fast / Balanced / Quality. */
  label: string
  description: string
  sizeGB: number
  minRamGB: number
  /** This machine has enough RAM to run it. */
  available: boolean
  /** The GGUF is present in the app's models dir. */
  downloaded: boolean
  /** Currently selected as the local notes model. */
  active: boolean
}

export interface NotesModelsResponse {
  ramGB: number
  models: NotesModelInfo[]
}

export interface ActivateModelResult {
  ok: boolean
  error?: string
}

/** Settings as exposed to the renderer — the API key never crosses IPC. */
export interface NotesSettingsView {
  engineChoice: EngineChoice
  activeLocalModelId?: string
  cloud?: {
    provider: CloudProvider
    model?: string
    hasKey: boolean
  }
  /** Set when part of an update could not be applied (e.g. no encryption). */
  error?: string
}

/** Partial update; omitted fields are left untouched. */
export interface NotesSettingsUpdate {
  engineChoice?: EngineChoice
  /**
   * Cloud config: `null` clears it; `apiKey` (write-only) replaces the
   * stored key when non-empty, otherwise the existing key is kept.
   */
  cloud?: {
    provider: CloudProvider
    model?: string
    apiKey?: string
  } | null
}

export interface EnhanceRequest {
  title: string
  rawNotesMarkdown: string
  segments: TranscriptSegment[]
}

/** Errors come back as a value, never as a rejected promise. */
export interface EnhanceResult {
  markdown?: string
  engine?: string
  elapsedMs?: number
  error?: string
}

export interface DownloadProgressEvent {
  modelId: string
  /** 0..1 */
  progress: number
}

export interface EnhanceTokenEvent {
  token: string
}

/** API surface exposed on `window.notes` by the preload script. */
export interface NotesApi {
  models(): Promise<NotesModelsResponse>
  activateModel(modelId: string): Promise<ActivateModelResult>
  getSettings(): Promise<NotesSettingsView>
  setSettings(update: NotesSettingsUpdate): Promise<NotesSettingsView>
  enhance(input: EnhanceRequest): Promise<EnhanceResult>
  onDownloadProgress(cb: (ev: DownloadProgressEvent) => void): () => void
  onEnhanceToken(cb: (ev: EnhanceTokenEvent) => void): () => void
}
