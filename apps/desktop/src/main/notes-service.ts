import { app, ipcMain, safeStorage } from 'electron'
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CloudNotesEngine,
  DEFAULT_MODELS_DIR,
  LOCAL_MODELS,
  LocalModelStore,
  LocalNotesEngine,
  totalRamGB,
  type AskInput,
  type LocalModelSpec,
  type MergeInput,
  type NotesEngine
} from '@repo/ai'
import { labelSegments, sanitizeSpeakerName, speakerInfos } from '@repo/meetings-store'
import {
  NOTES_ACTIVATE_MODEL_CHANNEL,
  NOTES_ASK_CHANNEL,
  NOTES_ASK_GLOBAL_CHANNEL,
  NOTES_ASK_GLOBAL_TOKEN_CHANNEL,
  NOTES_ASK_TOKEN_CHANNEL,
  NOTES_DOWNLOAD_PROGRESS_CHANNEL,
  NOTES_ENHANCE_CHANNEL,
  NOTES_TEMPLATES_CHANNEL,
  NOTES_ENHANCE_PROGRESS_CHANNEL,
  NOTES_ENHANCE_TOKEN_CHANNEL,
  NOTES_GET_SETTINGS_CHANNEL,
  NOTES_GLOBAL_CHAT_CLEAR_CHANNEL,
  NOTES_GLOBAL_CHAT_GET_CHANNEL,
  NOTES_MODELS_CHANNEL,
  NOTES_SET_SETTINGS_CHANNEL,
  type ActivateModelResult,
  type AskRequest,
  type AskResult,
  type CloudProvider,
  type EnhanceRequest,
  type EnhanceResult,
  type GlobalAskRequest,
  type GlobalAskResult,
  type GlobalChatEntry,
  type NotesModelsResponse,
  type NotesSettingsUpdate,
  type NotesSettingsView
} from '../shared/notes-api'
import { autoGenerateNotesAfterStop } from '../shared/auto-notes'
import type { MeetingRecord } from '../shared/meetings-api'
import { isStoredCloudProvider } from '../shared/meeting-recovery'
import type { MeetingsService } from './meetings-service'
import { modelSearchDirectories } from './model-paths'

/**
 * @repo/ai's index does not re-export the global-ask types (the engines
 * reference them structurally), so they are derived from the engine surface
 * instead of imported.
 */
type GlobalAskInput = Parameters<NotesEngine['askAcrossMeetings']>[0]
type GlobalAskMeeting = GlobalAskInput['meetings'][number]

/** Newest meetings considered for cross-meeting context; the prompt builder
 *  trims further to its character budget. */
const MAX_GLOBAL_MEETINGS = 30
/** Fallback transcript excerpt length for meetings with no notes at all. */
const TRANSCRIPT_EXCERPT_CHARS = 1500
/** Prior exchanges replayed into each cross-meeting ask. */
const MAX_GLOBAL_HISTORY_SENT = 6

/** What actually lands in userData/settings.json. */
interface StoredCloudSettings {
  provider: CloudProvider
  model?: string
  /** base64 of safeStorage.encryptString(key). The plaintext never hits
   *  disk. Absent for Ollama, which needs no key. */
  apiKeyEncrypted?: string
}

interface StoredSettings {
  autoGenerateNotesAfterStop?: boolean
  engineChoice: 'local' | 'cloud'
  activeLocalModelId?: string
  /** The user's own name, shown instead of "You" on their transcript lines. */
  profileName?: string
  cloud?: StoredCloudSettings
}

export type NotesBroadcast = (channel: string, payload: unknown) => void

/**
 * Owns notes settings + the notes engines (packages/ai) in the main process.
 *
 * One LocalNotesEngine is kept alive across enhance calls so the model stays
 * loaded; it is disposed and swapped only when the active model changes.
 * Cloud engines are cheap per-call wrappers around the user's key.
 */
export class NotesService {
  private readonly settingsPath: string
  private readonly globalChatPath: string
  private readonly modelStore: LocalModelStore
  private settings: StoredSettings
  private localEngine: LocalNotesEngine | null = null
  private localEngineModelId: string | null = null
  private localEnginePath: string | null = null
  private enhanceBusy = false
  private askBusy = false
  private activateBusy = false

  constructor(
    userDataDir: string,
    private readonly broadcast: NotesBroadcast,
    /** Read-only view of the meetings store, for cross-meeting context. */
    private readonly meetings: MeetingsService
  ) {
    this.settingsPath = join(userDataDir, 'settings.json')
    this.globalChatPath = join(userDataDir, 'global-chat.json')
    this.modelStore = new LocalModelStore(
      modelSearchDirectories(userDataDir, app.getPath('appData'), DEFAULT_MODELS_DIR)
    )
    this.settings = this.loadSettings()
  }

  registerIpc(): void {
    ipcMain.handle(NOTES_MODELS_CHANNEL, () => this.modelsResponse())
    ipcMain.handle(NOTES_ACTIVATE_MODEL_CHANNEL, (_event, modelId: unknown) =>
      this.activateModel(String(modelId))
    )
    ipcMain.handle(NOTES_GET_SETTINGS_CHANNEL, () => this.settingsView())
    ipcMain.handle(NOTES_SET_SETTINGS_CHANNEL, (_event, update: unknown) =>
      this.applySettings((update ?? {}) as NotesSettingsUpdate)
    )
    ipcMain.handle(NOTES_TEMPLATES_CHANNEL, async () => {
      const { NOTE_TEMPLATES } = await import('@repo/ai')
      return NOTE_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description }))
    })
    ipcMain.handle(NOTES_ENHANCE_CHANNEL, (_event, request: unknown) =>
      this.enhance((request ?? {}) as EnhanceRequest)
    )
    ipcMain.handle(NOTES_ASK_CHANNEL, (_event, request: unknown) =>
      this.ask((request ?? {}) as AskRequest)
    )
    ipcMain.handle(NOTES_ASK_GLOBAL_CHANNEL, (_event, request: unknown) =>
      this.askGlobal((request ?? {}) as GlobalAskRequest)
    )
    ipcMain.handle(NOTES_GLOBAL_CHAT_GET_CHANNEL, () => this.loadGlobalChat())
    ipcMain.handle(NOTES_GLOBAL_CHAT_CLEAR_CHANNEL, () => {
      this.saveGlobalChat([])
    })
  }

  async dispose(): Promise<void> {
    const engine = this.localEngine
    this.localEngine = null
    this.localEngineModelId = null
    try {
      await engine?.dispose()
    } catch {
      // Shutting down anyway.
    }
  }

  /* ---- models ---- */

  private async modelsResponse(): Promise<NotesModelsResponse> {
    const ramGB = totalRamGB()
    const paths = new Map<string, string | null>()
    for (const spec of LOCAL_MODELS) paths.set(spec.id, await this.modelStore.find(spec))
    // Out-of-the-box behavior: if nothing was explicitly activated but a
    // usable model is already on disk, adopt the best downloaded one so
    // Enhance works without requiring a trip to Settings first.
    if (this.settings.activeLocalModelId === undefined) {
      const downloaded = LOCAL_MODELS.filter((m) => m.minRamGB <= ramGB && paths.get(m.id))
      const adopt = downloaded[downloaded.length - 1]
      if (adopt) {
        this.settings.activeLocalModelId = adopt.id
        this.saveSettings()
      }
    }
    return {
      ramGB,
      models: LOCAL_MODELS.map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        sizeGB: spec.sizeGB,
        minRamGB: spec.minRamGB,
        available: spec.minRamGB <= ramGB,
        downloaded: Boolean(paths.get(spec.id)),
        active: this.settings.activeLocalModelId === spec.id && Boolean(paths.get(spec.id))
      }))
    }
  }

  private async activateModel(modelId: string): Promise<ActivateModelResult> {
    const spec = LOCAL_MODELS.find((m) => m.id === modelId)
    if (!spec) return { ok: false, error: `Unknown model id: ${modelId}` }
    if (spec.minRamGB > totalRamGB()) {
      return { ok: false, error: `${spec.label} needs at least ${spec.minRamGB} GB RAM.` }
    }
    if (this.activateBusy || this.enhanceBusy || this.askBusy) {
      return { ok: false, error: 'Another model operation is running. Try again when it finishes.' }
    }
    this.activateBusy = true
    try {
      const phase = (stage: 'checking' | 'loading' | 'verifying'): void => {
        this.broadcast(NOTES_DOWNLOAD_PROGRESS_CHANNEL, { modelId: spec.id, progress: 0, stage })
      }
      phase('checking')
      const modelPath = await this.modelStore.ensure(spec, async (directory) => {
        const { resolveModelFile } = await import('node-llama-cpp')
        const file = await resolveModelFile(spec.artifact.uri, {
          directory,
          cli: false,
          onProgress: ({ totalSize, downloadedSize }) => {
            this.broadcast(NOTES_DOWNLOAD_PROGRESS_CHANNEL, {
              modelId: spec.id,
              stage: 'downloading',
              progress: totalSize > 0 ? downloadedSize / totalSize : 0
            })
          }
        })
        phase('verifying')
        return file
      })
      phase('loading')
      const engine = this.obtainLocalEngine(spec, modelPath)
      await engine.prepare()
      this.settings.activeLocalModelId = spec.id
      this.saveSettings()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.activateBusy = false
    }
  }

  /** The single long-lived local engine; swapped only on model change. */
  private obtainLocalEngine(spec: LocalModelSpec, modelPath: string): LocalNotesEngine {
    if (
      this.localEngine &&
      this.localEngineModelId === spec.id &&
      this.localEnginePath === modelPath
    ) {
      return this.localEngine
    }
    const previous = this.localEngine
    this.localEngine = new LocalNotesEngine({
      modelUri: spec.uri,
      modelPath
    })
    this.localEngineModelId = spec.id
    this.localEnginePath = modelPath
    void previous?.dispose().catch(() => {})
    return this.localEngine
  }

  /* ---- enhance ---- */

  private async enhance(request: EnhanceRequest): Promise<EnhanceResult> {
    if (this.enhanceBusy) {
      return { error: 'Notes are already being generated — wait for the current run to finish.' }
    }
    if (this.askBusy) {
      return { error: 'A question is being answered right now — try again in a moment.' }
    }
    this.enhanceBusy = true
    try {
      if (
        request.automaticAfterStop &&
        !autoGenerateNotesAfterStop(this.settings.autoGenerateNotesAfterStop)
      ) {
        return { error: 'Automatic notes are now disabled. Choose Generate notes to run manually.' }
      }
      const segments = labelSegments(
        Array.isArray(request.segments) ? request.segments : [],
        request.participants
      )
      const kept = segments.filter((s) => !s.echo)
      const input: MergeInput = {
        title: typeof request.title === 'string' ? request.title.trim() : '',
        rawNotesMarkdown:
          typeof request.rawNotesMarkdown === 'string' ? request.rawNotesMarkdown : '',
        segments: kept.map((s) => ({ speaker: s.speaker, text: s.text, startMs: s.startMs })),
        speakers: speakerInfos(kept, request.participants),
        ...(kept.length > 0 ? { durationMs: Math.max(...kept.map((s) => s.endMs)) } : {}),
        ...(typeof request.templateId === 'string' ? { templateId: request.templateId } : {})
      }
      const engine = await this.pickEngine(request.automaticAfterStop === true)
      const result = await engine.generateNotes(
        input,
        (token) => {
          this.broadcast(NOTES_ENHANCE_TOKEN_CHANNEL, { token })
        },
        (progress) => {
          this.broadcast(NOTES_ENHANCE_PROGRESS_CHANNEL, progress)
        }
      )
      return { markdown: result.markdown, engine: result.engine, elapsedMs: result.elapsedMs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.enhanceBusy = false
    }
  }

  /* ---- ask anything ---- */

  private async ask(request: AskRequest): Promise<AskResult> {
    if (this.askBusy) {
      return { error: 'Still answering the previous question — one at a time.' }
    }
    if (this.enhanceBusy) {
      return { error: 'Notes are being generated right now — ask again when they finish.' }
    }
    this.askBusy = true
    try {
      const question = typeof request.question === 'string' ? request.question.trim() : ''
      if (!question) return { error: 'Ask a question first.' }

      const segments = labelSegments(
        Array.isArray(request.segments) ? request.segments : [],
        request.participants
      )
      const kept = segments.filter((s) => !s.echo)
      const history = (Array.isArray(request.history) ? request.history : []).filter(
        (h) => h && typeof h.question === 'string' && typeof h.answer === 'string'
      )
      const input: AskInput = {
        title:
          typeof request.title === 'string' && request.title.trim()
            ? request.title.trim()
            : 'Untitled meeting',
        rawNotesMarkdown:
          typeof request.rawNotesMarkdown === 'string' ? request.rawNotesMarkdown : '',
        ...(typeof request.enhancedMarkdown === 'string' && request.enhancedMarkdown.trim()
          ? { enhancedMarkdown: request.enhancedMarkdown }
          : {}),
        segments: kept.map((s) => ({ speaker: s.speaker, text: s.text, startMs: s.startMs })),
        speakers: speakerInfos(kept, request.participants),
        history: history.map((h) => ({ question: h.question, answer: h.answer })),
        question
      }
      const engine = await this.pickEngine()
      const result = await engine.askQuestion(input, (token) => {
        this.broadcast(NOTES_ASK_TOKEN_CHANNEL, { token })
      })
      return { answer: result.markdown, engine: result.engine, elapsedMs: result.elapsedMs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.askBusy = false
    }
  }

  /* ---- ask across meetings (Home-level chat) ---- */

  /**
   * Home "ask anything": the renderer sends only the question; context is
   * gathered here from the meetings store, and the conversation history is
   * the persisted global chat. Shares `askBusy` with the per-meeting ask so
   * global ask, per-meeting ask and enhance are mutually exclusive.
   */
  private async askGlobal(request: GlobalAskRequest): Promise<GlobalAskResult> {
    if (this.askBusy) {
      return { error: 'Still answering the previous question — one at a time.' }
    }
    if (this.enhanceBusy) {
      return { error: 'Notes are being generated right now — ask again when they finish.' }
    }
    this.askBusy = true
    try {
      const question = typeof request.question === 'string' ? request.question.trim() : ''
      if (!question) return { error: 'Ask a question first.' }

      const meetings = this.globalAskContext()
      if (meetings.length === 0) {
        return { error: 'No meeting notes yet — record a meeting first.' }
      }

      const input: GlobalAskInput = {
        meetings,
        history: this.loadGlobalChat()
          .slice(-MAX_GLOBAL_HISTORY_SENT)
          .map((e) => ({ question: e.question, answer: e.answer })),
        question
      }
      const engine = await this.pickEngine()
      const result = await engine.askAcrossMeetings(input, (token) => {
        this.broadcast(NOTES_ASK_GLOBAL_TOKEN_CHANNEL, { token })
      })
      this.saveGlobalChat([
        ...this.loadGlobalChat(),
        { question, answer: result.markdown, askedAt: new Date().toISOString() }
      ])
      return { answer: result.markdown, engine: result.engine, elapsedMs: result.elapsedMs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.askBusy = false
    }
  }

  /**
   * Cross-meeting context: every non-trashed meeting, newest first, reduced
   * to its best available notes. Meetings with nothing to ground an answer
   * on are skipped entirely; the newest MAX_GLOBAL_MEETINGS candidates go to
   * the prompt builder, which trims further to its character budget.
   */
  private globalAskContext(): GlobalAskMeeting[] {
    const records = this.meetings
      .readAll()
      .filter((record) => !record.trashedAt)
      .sort((a, b) => {
        const aIso = a.startedAt ?? a.createdAt
        const bIso = b.startedAt ?? b.createdAt
        return aIso < bIso ? 1 : aIso > bIso ? -1 : 0
      })
    const out: GlobalAskMeeting[] = []
    for (const record of records) {
      if (out.length >= MAX_GLOBAL_MEETINGS) break
      const notes = bestNotesOf(record)
      if (notes === null) continue
      out.push({
        title: record.title.trim() || 'Untitled meeting',
        dateIso: record.startedAt ?? record.createdAt,
        notesMarkdown: notes
      })
    }
    return out
  }

  /* ---- global chat persistence (userData/global-chat.json) ---- */

  private loadGlobalChat(): GlobalChatEntry[] {
    try {
      const raw = JSON.parse(readFileSync(this.globalChatPath, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isGlobalChatEntry) : []
    } catch {
      return [] // file doesn't exist yet (or is corrupt) — no conversation
    }
  }

  private saveGlobalChat(entries: GlobalChatEntry[]): void {
    try {
      writeFileSync(this.globalChatPath, JSON.stringify(entries, null, 2))
    } catch (err) {
      console.error('[notes] failed to save global chat:', err)
    }
  }

  /** Local by default; cloud only when explicitly chosen AND usable —
   *  a readable key, or Ollama which needs none. */
  private async pickEngine(requireSelectedProvider = false): Promise<NotesEngine> {
    if (this.activateBusy) throw new Error('A model is being prepared. Try again when it finishes.')
    const { engineChoice, cloud } = this.settings
    if (engineChoice === 'cloud' && cloud) {
      const apiKey = cloud.apiKeyEncrypted ? this.decryptApiKey(cloud.apiKeyEncrypted) : ''
      if (apiKey || cloud.provider === 'ollama') {
        return new CloudNotesEngine({
          provider: cloud.provider,
          apiKey: apiKey ?? '',
          ...(cloud.model ? { model: cloud.model } : {})
        })
      }
      if (requireSelectedProvider)
        throw new Error(
          'The selected provider key is unavailable. Open Settings and reconnect it, then generate notes manually.'
        )
      // Key unreadable (keychain changed, etc.) — fall through to local.
    }

    if (requireSelectedProvider && engineChoice === 'cloud' && !cloud) {
      throw new Error('Set up the selected provider in Settings, then generate notes manually.')
    }
    const selected = LOCAL_MODELS.find((m) => m.id === this.settings.activeLocalModelId)
    for (const spec of selected ? [selected] : LOCAL_MODELS) {
      if (spec.minRamGB > totalRamGB()) continue
      const modelPath = await this.modelStore.find(spec)
      if (modelPath) return this.obtainLocalEngine(spec, modelPath)
    }
    throw new Error(
      'The local notes model is missing, unreadable or invalid. Open Settings → Notes model to activate or download it.'
    )
  }

  /* ---- settings ---- */

  private settingsView(): NotesSettingsView {
    const { engineChoice, activeLocalModelId, profileName, cloud } = this.settings
    return {
      engineChoice,
      autoGenerateNotesAfterStop: autoGenerateNotesAfterStop(
        this.settings.autoGenerateNotesAfterStop
      ),
      ...(activeLocalModelId ? { activeLocalModelId } : {}),
      ...(profileName ? { profileName } : {}),
      ...(cloud
        ? {
            cloud: {
              provider: cloud.provider,
              ...(cloud.model ? { model: cloud.model } : {}),
              // "Usable", strictly speaking: Ollama is keyless by design.
              hasKey: Boolean(cloud.apiKeyEncrypted) || cloud.provider === 'ollama'
            }
          }
        : {})
    }
  }

  private applySettings(update: NotesSettingsUpdate): NotesSettingsView {
    let error: string | undefined
    const previousSettings = { ...this.settings }

    if (update.engineChoice === 'local' || update.engineChoice === 'cloud') {
      this.settings.engineChoice = update.engineChoice
    }

    if (typeof update.profileName === 'string') {
      const name = sanitizeSpeakerName(update.profileName)
      if (name) this.settings.profileName = name
      else delete this.settings.profileName
    }

    if (typeof update.autoGenerateNotesAfterStop === 'boolean') {
      this.settings.autoGenerateNotesAfterStop = update.autoGenerateNotesAfterStop
    }

    const validProviders: CloudProvider[] = ['anthropic', 'openai', 'groq', 'openrouter', 'ollama']
    if (update.cloud === null) {
      delete this.settings.cloud
    } else if (update.cloud && validProviders.includes(update.cloud.provider as CloudProvider)) {
      const provider = update.cloud.provider as CloudProvider
      const model =
        typeof update.cloud.model === 'string' && update.cloud.model.trim()
          ? update.cloud.model.trim()
          : undefined
      const previous = this.settings.cloud
      // Keys are provider-specific: switching provider drops the old key.
      let apiKeyEncrypted =
        previous && previous.provider === provider ? previous.apiKeyEncrypted : undefined

      const newKey = typeof update.cloud.apiKey === 'string' ? update.cloud.apiKey.trim() : ''
      if (newKey) {
        if (safeStorage.isEncryptionAvailable()) {
          apiKeyEncrypted = safeStorage.encryptString(newKey).toString('base64')
        } else {
          error = 'This system cannot encrypt secrets (safeStorage unavailable) — key not saved.'
        }
      }

      if (apiKeyEncrypted || provider === 'ollama') {
        this.settings.cloud = {
          provider,
          ...(model ? { model } : {}),
          ...(apiKeyEncrypted ? { apiKeyEncrypted } : {})
        }
      } else {
        delete this.settings.cloud
      }
    }

    if (!this.saveSettings()) {
      this.settings = previousSettings
      error = 'Could not save notes settings. Please try again.'
    }
    const view = this.settingsView()
    return error ? { ...view, error } : view
  }

  private decryptApiKey(encryptedB64: string): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(Buffer.from(encryptedB64, 'base64'))
    } catch {
      return null
    }
  }

  private loadSettings(): StoredSettings {
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<StoredSettings>
      const settings: StoredSettings = {
        autoGenerateNotesAfterStop: autoGenerateNotesAfterStop(raw.autoGenerateNotesAfterStop),
        engineChoice: raw.engineChoice === 'cloud' ? 'cloud' : 'local'
      }
      if (
        typeof raw.activeLocalModelId === 'string' &&
        LOCAL_MODELS.some((m) => m.id === raw.activeLocalModelId)
      ) {
        settings.activeLocalModelId = raw.activeLocalModelId
      }
      if (typeof raw.profileName === 'string') {
        const name = sanitizeSpeakerName(raw.profileName)
        if (name) settings.profileName = name
      }
      const cloud = raw.cloud
      if (
        cloud &&
        isStoredCloudProvider(cloud.provider) &&
        (cloud.provider === 'ollama' ||
          (typeof cloud.apiKeyEncrypted === 'string' && cloud.apiKeyEncrypted.length > 0))
      ) {
        settings.cloud = {
          provider: cloud.provider,
          ...(typeof cloud.model === 'string' && cloud.model ? { model: cloud.model } : {}),
          ...(typeof cloud.apiKeyEncrypted === 'string'
            ? { apiKeyEncrypted: cloud.apiKeyEncrypted }
            : {})
        }
      }
      return settings
    } catch {
      return { engineChoice: 'local' }
    }
  }

  private saveSettings(): boolean {
    const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify(this.settings, null, 2))
      renameSync(temporaryPath, this.settingsPath)
      return true
    } catch (err) {
      // Never log settings content here — it would include the encrypted key.
      console.error('[notes] failed to save settings:', err)
      try {
        rmSync(temporaryPath, { force: true })
      } catch {
        /* Preserve the original failure. */
      }
      return false
    }
  }
}

/**
 * The densest grounding available for one meeting: generated notes, else the
 * user's rough notes, else a short transcript excerpt — else null (nothing
 * to ground on; skip the meeting).
 */
function bestNotesOf(record: MeetingRecord): string | null {
  const enhanced = record.enhancedMarkdown?.trim()
  if (enhanced) return enhanced
  const raw = record.rawNotesMarkdown.trim()
  if (raw) return raw
  const spoken = record.segments
    .filter((s) => !s.echo)
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n')
    .trim()
  if (spoken.length === 0) return null
  return spoken.length > TRANSCRIPT_EXCERPT_CHARS
    ? `${spoken.slice(0, TRANSCRIPT_EXCERPT_CHARS)}…`
    : spoken
}

function isGlobalChatEntry(entry: unknown): entry is GlobalChatEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Partial<GlobalChatEntry>
  return (
    typeof e.question === 'string' && typeof e.answer === 'string' && typeof e.askedAt === 'string'
  )
}
