import { ipcMain, safeStorage } from 'electron'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CloudNotesEngine,
  LOCAL_MODELS,
  LocalNotesEngine,
  totalRamGB,
  type AskInput,
  type LocalModelSpec,
  type MergeInput,
  type NotesEngine
} from '@repo/ai'
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
import type { MeetingRecord } from '../shared/meetings-api'
import type { MeetingsService } from './meetings-service'

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
  /** base64 of safeStorage.encryptString(key). The plaintext never hits disk. */
  apiKeyEncrypted: string
}

interface StoredSettings {
  engineChoice: 'local' | 'cloud'
  activeLocalModelId?: string
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
  private readonly modelsDir: string
  private settings: StoredSettings
  private localEngine: LocalNotesEngine | null = null
  private localEngineModelId: string | null = null
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
    this.modelsDir = join(userDataDir, 'models')
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

  private modelsResponse(): NotesModelsResponse {
    const ramGB = totalRamGB()
    const files = this.listModelFiles()
    // Out-of-the-box behavior: if nothing was explicitly activated but a
    // usable model is already on disk, adopt the best downloaded one so
    // Enhance works without requiring a trip to Settings first.
    if (this.settings.activeLocalModelId === undefined) {
      const downloaded = LOCAL_MODELS.filter(
        (m) => m.minRamGB <= ramGB && this.isDownloaded(m, files)
      )
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
        downloaded: this.isDownloaded(spec, files),
        active: this.settings.activeLocalModelId === spec.id
      }))
    }
  }

  private listModelFiles(): string[] {
    try {
      return readdirSync(this.modelsDir)
    } catch {
      return [] // dir doesn't exist yet — nothing downloaded
    }
  }

  /**
   * node-llama-cpp caches `hf:owner/repo:quant` URIs as
   * `hf_<owner>_<repo minus -GGUF>.<quant>.gguf` (verified against a real
   * download). Exact-name match first, then a fuzzy base+quant fallback; a
   * sibling `.ipull` marker means the download is still in progress.
   */
  private isDownloaded(spec: LocalModelSpec, files: string[]): boolean {
    const parsed = /^hf:([^/]+)\/([^:]+):(.+)$/.exec(spec.uri)
    if (!parsed) return false
    const owner = parsed[1]!.toLowerCase()
    const repoBase = parsed[2]!.replace(/-GGUF$/i, '').toLowerCase()
    const quant = parsed[3]!.toLowerCase()
    const expected = `hf_${owner}_${repoBase}.${quant}.gguf`
    const lower = files.map((f) => f.toLowerCase())
    const inProgress = new Set(lower.filter((f) => f.endsWith('.ipull')))
    return lower.some((f) => {
      if (!f.endsWith('.gguf') || inProgress.has(`${f}.ipull`)) return false
      return f === expected || (f.includes(repoBase) && f.includes(quant))
    })
  }

  private async activateModel(modelId: string): Promise<ActivateModelResult> {
    const spec = LOCAL_MODELS.find((m) => m.id === modelId)
    if (!spec) return { ok: false, error: `Unknown model id: ${modelId}` }
    if (spec.minRamGB > totalRamGB()) {
      return { ok: false, error: `${spec.label} needs at least ${spec.minRamGB} GB RAM.` }
    }
    if (this.activateBusy) {
      return { ok: false, error: 'Another model is already downloading.' }
    }
    this.activateBusy = true
    try {
      const engine = this.obtainLocalEngine(spec)
      await engine.prepare() // downloads (with progress events) + loads
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
  private obtainLocalEngine(spec: LocalModelSpec): LocalNotesEngine {
    if (this.localEngine && this.localEngineModelId === spec.id) {
      return this.localEngine
    }
    const previous = this.localEngine
    this.localEngine = new LocalNotesEngine({
      modelUri: spec.uri,
      modelsDir: this.modelsDir,
      onDownloadProgress: (fraction) => {
        this.broadcast(NOTES_DOWNLOAD_PROGRESS_CHANNEL, { modelId: spec.id, progress: fraction })
      }
    })
    this.localEngineModelId = spec.id
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
      const segments = Array.isArray(request.segments) ? request.segments : []
      const kept = segments.filter((s) => !s.echo)
      const input: MergeInput = {
        title:
          typeof request.title === 'string' && request.title.trim()
            ? request.title.trim()
            : 'Untitled meeting',
        rawNotesMarkdown:
          typeof request.rawNotesMarkdown === 'string' ? request.rawNotesMarkdown : '',
        segments: kept.map((s) => ({ speaker: s.speaker, text: s.text, startMs: s.startMs })),
        ...(kept.length > 0 ? { durationMs: Math.max(...kept.map((s) => s.endMs)) } : {}),
        ...(typeof request.templateId === 'string' ? { templateId: request.templateId } : {})
      }
      const engine = this.pickEngine()
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

      const segments = Array.isArray(request.segments) ? request.segments : []
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
        history: history.map((h) => ({ question: h.question, answer: h.answer })),
        question
      }
      const engine = this.pickEngine()
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
      const engine = this.pickEngine()
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

  /** Local by default; cloud only when explicitly chosen AND a key is saved. */
  private pickEngine(): NotesEngine {
    const { engineChoice, cloud } = this.settings
    if (engineChoice === 'cloud' && cloud) {
      const apiKey = this.decryptApiKey(cloud.apiKeyEncrypted)
      if (apiKey) {
        return new CloudNotesEngine({
          provider: cloud.provider,
          apiKey,
          ...(cloud.model ? { model: cloud.model } : {})
        })
      }
      // Key unreadable (keychain changed, etc.) — fall through to local.
    }

    const files = this.listModelFiles()
    const spec =
      LOCAL_MODELS.find((m) => m.id === this.settings.activeLocalModelId) ??
      LOCAL_MODELS.find((m) => this.isDownloaded(m, files)) // settings lost but files present
    if (!spec || !this.isDownloaded(spec, files)) {
      throw new Error(
        'No local notes model is downloaded yet. Open the Models view and activate one.'
      )
    }
    return this.obtainLocalEngine(spec)
  }

  /* ---- settings ---- */

  private settingsView(): NotesSettingsView {
    const { engineChoice, activeLocalModelId, cloud } = this.settings
    return {
      engineChoice,
      ...(activeLocalModelId ? { activeLocalModelId } : {}),
      ...(cloud
        ? {
            cloud: {
              provider: cloud.provider,
              ...(cloud.model ? { model: cloud.model } : {}),
              hasKey: Boolean(cloud.apiKeyEncrypted)
            }
          }
        : {})
    }
  }

  private applySettings(update: NotesSettingsUpdate): NotesSettingsView {
    let error: string | undefined

    if (update.engineChoice === 'local' || update.engineChoice === 'cloud') {
      this.settings.engineChoice = update.engineChoice
    }

    if (update.cloud === null) {
      delete this.settings.cloud
    } else if (
      update.cloud &&
      (update.cloud.provider === 'anthropic' || update.cloud.provider === 'openai')
    ) {
      const provider = update.cloud.provider
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

      if (apiKeyEncrypted) {
        this.settings.cloud = { provider, ...(model ? { model } : {}), apiKeyEncrypted }
      } else {
        delete this.settings.cloud
      }
    }

    this.saveSettings()
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
        engineChoice: raw.engineChoice === 'cloud' ? 'cloud' : 'local'
      }
      if (
        typeof raw.activeLocalModelId === 'string' &&
        LOCAL_MODELS.some((m) => m.id === raw.activeLocalModelId)
      ) {
        settings.activeLocalModelId = raw.activeLocalModelId
      }
      const cloud = raw.cloud
      if (
        cloud &&
        (cloud.provider === 'anthropic' || cloud.provider === 'openai') &&
        typeof cloud.apiKeyEncrypted === 'string' &&
        cloud.apiKeyEncrypted.length > 0
      ) {
        settings.cloud = {
          provider: cloud.provider,
          ...(typeof cloud.model === 'string' && cloud.model ? { model: cloud.model } : {}),
          apiKeyEncrypted: cloud.apiKeyEncrypted
        }
      }
      return settings
    } catch {
      return { engineChoice: 'local' }
    }
  }

  private saveSettings(): void {
    try {
      writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2))
    } catch (err) {
      // Never log settings content here — it would include the encrypted key.
      console.error('[notes] failed to save settings:', err)
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
