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
export const NOTES_TEMPLATES_CHANNEL = 'notes:templates'
export const NOTES_ACTIVATE_MODEL_CHANNEL = 'notes:activate-model'
export const NOTES_GET_SETTINGS_CHANNEL = 'notes:get-settings'
export const NOTES_SET_SETTINGS_CHANNEL = 'notes:set-settings'
export const NOTES_ENHANCE_CHANNEL = 'notes:enhance'
export const NOTES_ASK_CHANNEL = 'notes:ask'
export const NOTES_ASK_GLOBAL_CHANNEL = 'notes:ask-global'
export const NOTES_GLOBAL_CHAT_GET_CHANNEL = 'notes:global-chat-get'
export const NOTES_GLOBAL_CHAT_CLEAR_CHANNEL = 'notes:global-chat-clear'
/** main → renderer: model download progress while activating. */
export const NOTES_DOWNLOAD_PROGRESS_CHANNEL = 'notes:download-progress'
/** main → renderer: streamed tokens during an enhance run. */
export const NOTES_ENHANCE_TOKEN_CHANNEL = 'notes:enhance-token'
/** main → renderer: long-meeting condensation progress during enhance. */
export const NOTES_ENHANCE_PROGRESS_CHANNEL = 'notes:enhance-progress'
/** main → renderer: streamed tokens during an ask run. */
export const NOTES_ASK_TOKEN_CHANNEL = 'notes:ask-token'
/** main → renderer: streamed tokens during a cross-meeting ask run. */
export const NOTES_ASK_GLOBAL_TOKEN_CHANNEL = 'notes:ask-global-token'

export type CloudProvider = 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'ollama'

export const CLOUD_PROVIDERS: ReadonlyArray<{ id: CloudProvider; label: string; keyOptional?: boolean }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'ollama', label: 'Ollama (local)', keyOptional: true }
]
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
  /** Note template shaping the output; default "general". */
  templateId?: string
}

/** Template list for the Generate-notes picker (catalog lives in @repo/ai). */
export interface NotesTemplateInfo {
  id: string
  label: string
  description: string
}

/** Errors come back as a value, never as a rejected promise. */
export interface EnhanceResult {
  markdown?: string
  engine?: string
  elapsedMs?: number
  error?: string
}

/** One completed question/answer pair, as sent back for prompt context. */
export interface AskExchange {
  question: string
  answer: string
}

/** Mirrors @repo/ai's AskInput, with the renderer's segment shape. */
export interface AskRequest {
  title: string
  rawNotesMarkdown: string
  enhancedMarkdown?: string | null
  segments: TranscriptSegment[]
  /** Prior exchanges in this meeting's chat (oldest first). */
  history: AskExchange[]
  question: string
}

/** Errors come back as a value, never as a rejected promise. */
export interface AskResult {
  answer?: string
  engine?: string
  elapsedMs?: number
  error?: string
}

/**
 * Home-level "ask anything", across all meetings. The renderer sends only
 * the question — the main process gathers the cross-meeting context (and
 * the persisted conversation history) itself.
 */
export interface GlobalAskRequest {
  question: string
}

/** Errors come back as a value, never as a rejected promise. */
export interface GlobalAskResult {
  answer?: string
  engine?: string
  elapsedMs?: number
  error?: string
}

/** One persisted Home-level exchange (userData/global-chat.json). */
export interface GlobalChatEntry {
  question: string
  answer: string
  /** ISO timestamp of when the question was asked. */
  askedAt: string
}

export interface DownloadProgressEvent {
  modelId: string
  /** 0..1 */
  progress: number
}

export interface EnhanceTokenEvent {
  token: string
}

/** Long meetings condense in parts before the final write (map-reduce). */
export interface EnhanceProgressEvent {
  phase: 'condensing' | 'writing'
  current?: number
  total?: number
}

export interface AskTokenEvent {
  token: string
}

export interface GlobalAskTokenEvent {
  token: string
}

/** API surface exposed on `window.notes` by the preload script. */
export interface NotesApi {
  templates(): Promise<NotesTemplateInfo[]>
  models(): Promise<NotesModelsResponse>
  activateModel(modelId: string): Promise<ActivateModelResult>
  getSettings(): Promise<NotesSettingsView>
  setSettings(update: NotesSettingsUpdate): Promise<NotesSettingsView>
  enhance(input: EnhanceRequest): Promise<EnhanceResult>
  ask(req: AskRequest): Promise<AskResult>
  askGlobal(req: GlobalAskRequest): Promise<GlobalAskResult>
  getGlobalChat(): Promise<GlobalChatEntry[]>
  clearGlobalChat(): Promise<void>
  onDownloadProgress(cb: (ev: DownloadProgressEvent) => void): () => void
  onEnhanceToken(cb: (ev: EnhanceTokenEvent) => void): () => void
  onEnhanceProgress(cb: (ev: EnhanceProgressEvent) => void): () => void
  onAskToken(cb: (ev: AskTokenEvent) => void): () => void
  onGlobalAskToken(cb: (ev: GlobalAskTokenEvent) => void): () => void
}
