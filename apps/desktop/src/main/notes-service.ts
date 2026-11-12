import { dictationBudget, fastestInstalled } from './dictation-model'
import { NotesGenerationJobs } from './notes-generation-job'
import { libraryActivity } from './library-activity'
import {
  normalizeBatchSettings,
  type BatchTranscriptionSettings
} from '../shared/batch-transcription'
import { resolveLibraryPath, type LibraryPath } from './library-path'
import { libraryIpc } from './library-ipc'
import { fetchCloudModels } from './cloud-models'
import { app, ipcMain, safeStorage, powerMonitor } from 'electron'
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { escapeHtml, markdownToHtml } from '../shared/markdown-html'
import {
  buildMergeSystemPrompt,
  estimateNotesWarmupBytes,
  NOTES_WARM_CONTEXT_SIZE,
  preloadNotesRuntime,
  GenerationError,
  GlobalAskBudgetError,
  globalAskCoverageNotice,
  withGenerationDeadline,
  CloudNotesEngine,
  DEFAULT_MODELS_DIR,
  LOCAL_MODELS,
  LocalModelStore,
  NotesEngineLog,
  LocalNotesEngine,
  totalRamGB,
  type AskInput,
  type LocalModelSpec,
  type MergeInput,
  type NotesEngine
} from '@repo/ai'
import {
  labelSegments,
  sanitizeSpeakerName,
  speakerInfos,
  speakerLabel,
  withSelfParticipant,
  type MeetingTranscriptSegment
} from '@repo/meetings-store'
import {
  NOTES_ACTIVATE_MODEL_CHANNEL,
  NOTES_ASK_CHANNEL,
  NOTES_ASK_GLOBAL_CHANNEL,
  NOTES_ASK_GLOBAL_TOKEN_CHANNEL,
  NOTES_ASK_TOKEN_CHANNEL,
  NOTES_DOWNLOAD_PROGRESS_CHANNEL,
  NOTES_CANCEL_ENHANCE_CHANNEL,
  NOTES_ENHANCE_CHANNEL,
  NOTES_TEMPLATES_CHANNEL,
  NOTES_ENHANCE_PROGRESS_CHANNEL,
  NOTES_ENHANCE_TOKEN_CHANNEL,
  NOTES_GET_SETTINGS_CHANNEL,
  NOTES_GLOBAL_CHAT_CLEAR_CHANNEL,
  NOTES_GLOBAL_CHAT_GET_CHANNEL,
  NOTES_MODELS_CHANNEL,
  NOTES_CLOUD_MODELS_CHANNEL,
  type CloudModelsResult,
  NOTES_SET_SETTINGS_CHANNEL,
  type ActivateModelResult,
  type AskRequest,
  type AskResult,
  type CloudProvider,
  type EnhanceIdentity,
  type EnhanceProgressEvent,
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

/** Keep service evidence shape aligned with the engine request contract. */
type GlobalAskInput = Parameters<NotesEngine['askAcrossMeetings']>[0]
type GlobalAskMeeting = GlobalAskInput['meetings'][number]

/** Newest meetings considered for cross-meeting context; the prompt builder
 *  reduces further to its selected model request budget. */
export const NOTES_WARMUP_ENABLED = true
const MAX_GLOBAL_MEETINGS = 30
/** Fallback transcript excerpt length for meetings with no notes at all. */
const TRANSCRIPT_EXCERPT_CHARS = 1500

/** What actually lands in userData/settings.json. */
interface StoredCloudSettings {
  dataPolicyConfirmed?: boolean
  provider: CloudProvider
  model?: string
  /** base64 of safeStorage.encryptString(key). The plaintext never hits
   *  disk. Absent for Ollama, which needs no key. */
  apiKeyEncrypted?: string
}

interface StoredSettings {
  batchTranscription?: BatchTranscriptionSettings
  autoGenerateNotesAfterStop?: boolean
  engineChoice: 'local' | 'cloud'
  activeLocalModelId?: string
  /** The user's own name, shown instead of "You" on their transcript lines. */
  profileName?: string
  cloud?: StoredCloudSettings
}

export type NotesBroadcast = (channel: string, payload: unknown) => void

export type DictationCleanupFailure = 'busy' | 'no-model' | 'no-provider' | 'no-consent' | 'failed'

/** Why dictation cleanup did not run; the raw transcript is kept in every case. */
export class DictationCleanupError extends Error {
  constructor(
    readonly code: DictationCleanupFailure,
    message: string
  ) {
    super(message)
    this.name = 'DictationCleanupError'
  }
}

/**
 * Owns notes settings + the notes engines (packages/ai) in the main process.
 *
 * One LocalNotesEngine is kept alive across enhance calls so the model stays
 * loaded; it is disposed and swapped only when the active model changes.
 * Cloud engines are cheap per-call wrappers around the user's key.
 */
export class NotesService {
  private readonly settingsPath: string
  private get globalChatPath(): string {
    return join(resolveLibraryPath(this.libraryRoot), 'global-chat.json')
  }
  private readonly modelStore: LocalModelStore
  private readonly engineLog: NotesEngineLog
  private settings: StoredSettings
  /**
   * Dictation's own engine, used only when the quickest installed model is not the
   * one notes run on. Freed after ten idle minutes so a second model does not sit in memory.
   */
  private dictationEngine: LocalNotesEngine | null = null
  private dictationEngineModelId: string | null = null
  private dictationEngineTimer: NodeJS.Timeout | null = null
  /** The model dictation last chose, so the settings page can name it without touching a file. */
  private dictationSpec: LocalModelSpec | null = null
  private dictationSpecAt = 0
  /** A model load started while the person speaks; cleanup waits for it. */
  private dictationWarm: Promise<void> | null = null
  private localEngine: LocalNotesEngine | null = null
  private localEngineModelId: string | null = null
  private localEnginePath: string | null = null
  private readonly generationJobs = new NotesGenerationJobs()
  private get enhanceBusy(): boolean {
    return this.generationJobs.busy
  }
  private notesWarm: {
    meetingId: string
    controller: AbortController
    work: Promise<void>
  } | null = null
  private notesPrediction: {
    meetingId: string
    source: 'mic' | 'system' | 'both'
    system: string
    timer: NodeJS.Timeout | null
  } | null = null
  private clearNotesPrediction(): void {
    if (this.notesPrediction?.timer) clearTimeout(this.notesPrediction.timer)
    this.notesPrediction = null
  }
  private askBusy = false
  private activateBusy = false

  constructor(
    userDataDir: string,
    private readonly broadcast: NotesBroadcast,
    /** Read-only view of the meetings store, for cross-meeting context. */
    private readonly meetings: MeetingsService,
    private readonly libraryRoot: LibraryPath = userDataDir,
    private readonly assertAvailable: () => void = () => {}
  ) {
    this.settingsPath = join(userDataDir, 'settings.json')
    this.engineLog = new NotesEngineLog(join(userDataDir, 'notes-engine.log'))
    this.modelStore = new LocalModelStore(
      modelSearchDirectories(userDataDir, app.getPath('appData'), DEFAULT_MODELS_DIR),
      {
        verdictPath: join(userDataDir, 'model-integrity.json'),
        // Windows DPAPI has no authorization UI. macOS/Linux safeStorage calls
        // can prompt and block the main thread during automatic discovery.
        // The store accesses this provider lazily, only when loading receipts.
        receiptStorage: process.platform === 'win32' ? safeStorage : undefined,
        onIntegrityCheck: (event) => this.engineLog.log({ event: 'hash', ...event })
      }
    )
    this.settings = this.loadSettings()
  }

  registerIpc(): void {
    libraryIpc.handle(
      NOTES_CLOUD_MODELS_CHANNEL,
      async (_event, provider: unknown): Promise<CloudModelsResult> => {
        const cloud = this.settings.cloud
        if (!cloud || provider !== cloud.provider)
          return { models: [], error: 'Save this provider’s API key first.' }
        if (cloud.provider === 'groq' || cloud.provider === 'openrouter')
          return { models: [], error: 'Select a supported provider.' }
        const key = cloud.apiKeyEncrypted ? this.decryptApiKey(cloud.apiKeyEncrypted) : ''
        return fetchCloudModels(cloud.provider, key ?? '')
      }
    )
    libraryIpc.handle(NOTES_MODELS_CHANNEL, () => this.modelsResponse())
    libraryIpc.handle(NOTES_ACTIVATE_MODEL_CHANNEL, (_event, modelId: unknown) =>
      this.activateModel(String(modelId))
    )
    libraryIpc.handle(NOTES_GET_SETTINGS_CHANNEL, () => this.settingsView())
    libraryIpc.handle(NOTES_SET_SETTINGS_CHANNEL, (_event, update: unknown) =>
      this.applySettings((update ?? {}) as NotesSettingsUpdate)
    )
    libraryIpc.handle(NOTES_TEMPLATES_CHANNEL, async () => {
      const { NOTE_TEMPLATES } = await import('@repo/ai')
      return NOTE_TEMPLATES.map((t) => ({ id: t.id, label: t.label, description: t.description }))
    })
    // Reserve ownership before waiting on library relocation. Cancellation must
    // bypass that barrier or it could deadlock behind the operation it stops.
    ipcMain.handle(NOTES_ENHANCE_CHANNEL, async (event, request: unknown) => {
      const input = (request ?? {}) as EnhanceRequest
      const cancel = (): void => {
        this.generationJobs.cancel(input, event.sender.id)
      }
      // A reload/crash has no React unmount callback. Stop its orphaned inference.
      event.sender.on('destroyed', cancel)
      event.sender.on('render-process-gone', cancel)
      event.sender.on('did-start-loading', cancel)
      try {
        return await this.enhance(input, event.sender.id)
      } finally {
        event.sender.removeListener('destroyed', cancel)
        event.sender.removeListener('render-process-gone', cancel)
        event.sender.removeListener('did-start-loading', cancel)
      }
    })
    ipcMain.handle(NOTES_CANCEL_ENHANCE_CHANNEL, (event, identity: EnhanceIdentity) =>
      identity ? this.generationJobs.cancel(identity, event.sender.id) : false
    )
    libraryIpc.handle(NOTES_ASK_CHANNEL, (_event, request: unknown) =>
      this.ask((request ?? {}) as AskRequest)
    )
    libraryIpc.handle(NOTES_ASK_GLOBAL_CHANNEL, (_event, request: unknown) =>
      this.askGlobal((request ?? {}) as GlobalAskRequest)
    )
    libraryIpc.handle(NOTES_GLOBAL_CHAT_GET_CHANNEL, () => this.loadGlobalChat())
    libraryIpc.handle(NOTES_GLOBAL_CHAT_CLEAR_CHANNEL, () => {
      this.saveGlobalChat([])
    })
  }

  async dispose(): Promise<void> {
    await this.cancelNotesWarmup()
    await this.generationJobs.stop()
    const engine = this.localEngine
    this.localEngine = null
    this.localEngineModelId = null
    try {
      await engine?.dispose()
    } catch {
      // Shutting down anyway.
    }
    await this.disposeDictationEngine()
    await this.engineLog.flush()
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
      await this.cancelNotesWarmup()
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
      modelId: spec.id,
      onDiagnostic: this.engineLog.log,
      modelPath
    })
    this.localEngineModelId = spec.id
    this.localEnginePath = modelPath
    void previous?.dispose().catch(() => {})
    return this.localEngine
  }

  /* ---- enhance ---- */

  private async enhance(request: EnhanceRequest, owner: number): Promise<EnhanceResult> {
    if (this.enhanceBusy) {
      return { error: 'Notes are already being generated — wait for the current run to finish.' }
    }
    if (this.askBusy) {
      return { error: 'A question is being answered right now — try again in a moment.' }
    }
    if (!request.runId || !request.meetingId)
      return { error: 'Notes generation requires a meeting and run ID.' }
    const identity = { runId: request.runId, meetingId: request.meetingId }
    try {
      return await this.generationJobs.run(identity, owner, async (signal) => {
        const started = Date.now()
        let phase: EnhanceProgressEvent['phase'] = 'preparing'
        let current: number | undefined
        let total: number | undefined
        let responseChunks = 0
        let lastActivity: number | undefined
        const progress = (): void =>
          this.broadcast(NOTES_ENHANCE_PROGRESS_CHANNEL, {
            ...identity,
            phase: signal.aborted ? 'canceling' : phase,
            current,
            total,
            elapsedMs: Date.now() - started,
            responseChunks,
            lastActivityMs: lastActivity === undefined ? undefined : Date.now() - lastActivity
          })
        progress()
        const heartbeat = setInterval(progress, 1000)
        try {
          return await libraryActivity.run(async () => {
            signal.throwIfAborted()
            if (
              request.automaticAfterStop &&
              !autoGenerateNotesAfterStop(this.settings.autoGenerateNotesAfterStop)
            ) {
              return {
                error: 'Automatic notes are now disabled. Choose Generate notes to run manually.'
              }
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
              ...(kept.some((s) => s.endMs !== undefined)
                ? {
                    durationMs: Math.max(
                      ...kept.flatMap((s) => (s.endMs === undefined ? [] : [s.endMs]))
                    )
                  }
                : {}),
              ...(typeof request.templateId === 'string' ? { templateId: request.templateId } : {})
            }
            const engine = await withGenerationDeadline(
              signal,
              'preparing',
              async (preparingSignal) => {
                this.clearNotesPrediction()
                const waitStarted = Date.now()
                const warm = this.notesWarm
                if (warm) {
                  const cancel = (): void => warm.controller.abort(preparingSignal.reason)
                  preparingSignal.addEventListener('abort', cancel, { once: true })
                  try {
                    await warm.work
                  } finally {
                    preparingSignal.removeEventListener('abort', cancel)
                  }
                  preparingSignal.throwIfAborted()
                }
                this.engineLog.log({
                  event: 'prepare',
                  stage: 'warm-wait',
                  elapsedMs: Date.now() - waitStarted
                })
                const engine = await this.pickEngine(request.automaticAfterStop === true)
                preparingSignal.throwIfAborted()
                if (engine instanceof LocalNotesEngine) await engine.prepare(preparingSignal)
                return engine
              }
            )
            const result = await engine.generateNotes(
              input,
              (token) => {
                if (!signal.aborted)
                  this.broadcast(NOTES_ENHANCE_TOKEN_CHANNEL, { ...identity, token })
              },
              (update) => {
                phase = update.phase
                current = update.current
                total = update.total
                if (update.activity) {
                  responseChunks++
                  lastActivity = Date.now()
                } else {
                  responseChunks = 0
                  lastActivity = undefined
                  progress()
                }
              },
              { signal }
            )
            signal.throwIfAborted()
            return { markdown: result.markdown, engine: result.engine, elapsedMs: result.elapsedMs }
          })
        } finally {
          clearInterval(heartbeat)
        }
      })
    } catch (err) {
      this.engineLog.log({ event: 'failure', stage: 'generation', error: err })
      return {
        code: err instanceof GenerationError ? err.code : 'model-error',
        error: err instanceof Error ? err.message : String(err)
      }
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
      await this.cancelNotesWarmup()
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
      await this.cancelNotesWarmup()
      const question = typeof request.question === 'string' ? request.question.trim() : ''
      if (!question) return { error: 'Ask a question first.' }

      const { meetings, availableMeetingCount } = this.globalAskContext()
      if (meetings.length === 0) {
        return { error: 'No meeting notes yet — record a meeting first.' }
      }

      const input: GlobalAskInput = {
        meetings,
        availableMeetingCount,
        history: this.loadGlobalChat().map((e) => ({ question: e.question, answer: e.answer })),
        question
      }
      const engine = await this.pickEngine()
      const result = await engine.askAcrossMeetings(input, (token) => {
        this.broadcast(NOTES_ASK_GLOBAL_TOKEN_CHANNEL, { token })
      })
      // Require both an exact source paragraph and the Ask renderer's paragraph
      // semantics (not an open code fence). Comparison never rewrites model bytes.
      const canonicalNotice = result.coverage ? globalAskCoverageNotice(result.coverage) : ''
      const trimmedMarkdown = result.markdown.trimEnd()
      const prefix = trimmedMarkdown.slice(0, -canonicalNotice.length)
      const hasCanonicalParagraph =
        canonicalNotice &&
        trimmedMarkdown.endsWith(canonicalNotice) &&
        (prefix.trim() === '' || /\n[^\S\n]*\n$/.test(prefix)) &&
        markdownToHtml(trimmedMarkdown).endsWith(`<p>${escapeHtml(canonicalNotice)}</p>`)
      const notice = canonicalNotice && !hasCanonicalParagraph ? `\n\n${canonicalNotice}` : ''
      if (notice) this.broadcast(NOTES_ASK_GLOBAL_TOKEN_CHANNEL, { token: notice })
      const answer = result.markdown + notice
      this.saveGlobalChat([
        ...this.loadGlobalChat(),
        {
          question,
          answer,
          askedAt: new Date().toISOString(),
          ...(result.coverage ? { coverage: result.coverage } : {})
        }
      ])
      return {
        answer,
        engine: result.engine,
        elapsedMs: result.elapsedMs,
        ...(result.coverage ? { coverage: result.coverage } : {})
      }
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof GlobalAskBudgetError ? { code: err.code } : {})
      }
    } finally {
      this.askBusy = false
    }
  }

  /**
   * Cross-meeting context: every non-trashed meeting, newest first, reduced
   * to its best available notes. Meetings with nothing to ground an answer
   * on are skipped entirely; the newest MAX_GLOBAL_MEETINGS candidates go to
   * the prompt builder, which reduces further to its selected model request budget.
   */
  private globalAskContext(): { meetings: GlobalAskMeeting[]; availableMeetingCount: number } {
    const records = this.meetings
      .readAll()
      .filter((record) => !record.trashedAt)
      .sort((a, b) => {
        const aIso = a.startedAt ?? a.createdAt
        const bIso = b.startedAt ?? b.createdAt
        return aIso < bIso ? 1 : aIso > bIso ? -1 : 0
      })
    const out: GlobalAskMeeting[] = []
    let availableMeetingCount = 0
    for (const record of records) {
      const content = bestNotesOf(record)
      if (content === null) continue
      availableMeetingCount++
      if (out.length >= MAX_GLOBAL_MEETINGS) continue
      out.push({
        sourceId: record.id,
        ...content,
        title: record.title.trim() || 'Untitled meeting',
        dateIso: record.startedAt ?? record.createdAt
      })
    }
    return { meetings: out, availableMeetingCount }
  }

  /* ---- global chat persistence (userData/global-chat.json) ---- */

  private loadGlobalChat(): GlobalChatEntry[] {
    this.assertAvailable()
    try {
      const raw = JSON.parse(readFileSync(this.globalChatPath, 'utf8'))
      return Array.isArray(raw) ? raw.filter(isGlobalChatEntry) : []
    } catch {
      return [] // file doesn't exist yet (or is corrupt) — no conversation
    }
  }

  private saveGlobalChat(entries: GlobalChatEntry[]): void {
    this.assertAvailable()
    try {
      writeFileSync(this.globalChatPath, JSON.stringify(entries, null, 2))
    } catch (err) {
      console.error('[notes] failed to save global chat:', err)
      this.engineLog.log({ event: 'failure', stage: 'global-chat', error: err })
    }
  }

  /** Local by default; cloud only when explicitly chosen AND usable —
   *  a readable key, or Ollama which needs none. */
  private async pickEngine(
    requireSelectedProvider = false,
    localOnly = false
  ): Promise<NotesEngine> {
    if (this.activateBusy) throw new Error('A model is being prepared. Try again when it finishes.')
    const { engineChoice, cloud } = this.settings
    if (!localOnly && engineChoice === 'cloud' && cloud) {
      if (cloud.provider === 'groq' || cloud.provider === 'openrouter') {
        throw new Error(
          'Groq and OpenRouter are retired. Select Grok (xAI), paid Gemini, or another provider in Settings and enter its own API key. Your notes and stored settings are preserved.'
        )
      }
      const apiKey = cloud.apiKeyEncrypted ? this.decryptApiKey(cloud.apiKeyEncrypted) : ''
      if (apiKey || cloud.provider === 'ollama') {
        return new CloudNotesEngine({
          provider: cloud.provider,
          dataPolicyConfirmed: cloud.dataPolicyConfirmed === true,
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

    if (!localOnly && requireSelectedProvider && engineChoice === 'cloud' && !cloud) {
      throw new Error('Set up the selected provider in Settings, then generate notes manually.')
    }
    preloadNotesRuntime(this.engineLog.log)
    const selected = LOCAL_MODELS.find((m) => m.id === this.settings.activeLocalModelId)
    for (const spec of selected ? [selected] : LOCAL_MODELS) {
      if (spec.minRamGB > totalRamGB()) continue
      const lookupStarted = Date.now()
      const modelPath = await this.modelStore.find(spec)
      this.engineLog.log({
        event: 'prepare',
        stage: 'model-lookup',
        elapsedMs: Date.now() - lookupStarted,
        modelId: spec.id
      })
      if (modelPath) return this.obtainLocalEngine(spec, modelPath)
    }
    throw new Error(
      'The local notes model is missing, unreadable or invalid. Open Settings → Notes model to activate or download it.'
    )
  }

  /** Recipe-only entry: no settings mutation and no provider fallback. Existing summary/Ask paths are unchanged. */
  async runRecipe(
    policy: 'local-only' | 'explicit-cloud',
    system: string,
    prompt: string,
    signal: AbortSignal
  ): Promise<import('@repo/ai').MergedNotes & { modelRevision: string }> {
    if (this.askBusy || this.enhanceBusy || this.activateBusy)
      throw new Error('Another model operation is running. Wait for it to finish, then retry.')
    this.askBusy = true
    try {
      await this.cancelNotesWarmup()
      if (
        policy === 'explicit-cloud' &&
        (this.settings.engineChoice !== 'cloud' || !this.settings.cloud)
      )
        throw new Error(
          'Select and authorize a cloud provider in Settings, or choose a local-only fetch. No fallback was used.'
        )
      const settingsBefore = JSON.stringify(this.settings)
      const engine = await this.pickEngine(true, policy === 'local-only')
      signal.throwIfAborted()
      if (settingsBefore !== JSON.stringify(this.settings))
        throw new Error('Model settings changed. Retry with the current settings.')
      if (!engine.runBounded)
        throw new Error('This model does not support bounded fetch generation.')
      const revision = (): string => {
        if (!engine.id.startsWith('local:')) return `provider-model:${engine.id}`
        if (!this.localEnginePath) throw new Error('Local model path is unavailable.')
        const file = statSync(this.localEnginePath)
        return `local-artifact:${engine.id}:${file.size}:${file.mtimeMs}`
      }
      const modelRevision = revision()
      const result = await engine.runBounded(system, prompt, { signal, phase: 'writing' })
      signal.throwIfAborted()
      if (modelRevision !== revision() || settingsBefore !== JSON.stringify(this.settings))
        throw new Error('Model or policy changed during the run. No output was saved; retry.')
      return { ...result, modelRevision }
    } finally {
      this.askBusy = false
    }
  }

  /**
   * Dictation cleanup entry. It takes the same lease as notes, Ask and recipes
   * (`askBusy`), so it can never overlap a generation or a model swap, and it
   * refuses rather than interrupting one. It reads settings but never writes
   * them, never falls back from the chosen mode, and never exposes a key.
   * `consent` is the dictation-specific approval for sending dictated TEXT to
   * the configured provider; the meeting-notes data-policy flag is not reused.
   */
  async runDictationCleanup(
    mode: 'local' | 'byok',
    system: string,
    prompt: string,
    signal: AbortSignal,
    consent: { provider: string; model: string } | null
  ): Promise<{ markdown: string; engineId: string }> {
    // A model load begun while the person was speaking holds the lease; let it finish first.
    if (this.dictationWarm) await this.dictationWarm.catch(() => {})
    if (this.askBusy || this.enhanceBusy || this.activateBusy)
      throw new DictationCleanupError('busy', 'The notes model is busy with another task.')
    this.askBusy = true
    try {
      await this.cancelNotesWarmup()
      const settingsBefore = JSON.stringify(this.settings)
      const engine = await this.pickDictationEngine(mode, consent)
      signal.throwIfAborted()
      // Cleanup is a sentence or a paragraph: a small context, a short answer and a
      // low temperature are much quicker than the meeting-sized defaults.
      const control = {
        signal,
        phase: 'writing' as const,
        ...dictationBudget(system, prompt),
        temperature: 0.2
      }
      const result = engine.runBounded
        ? await engine.runBounded(system, prompt, control)
        : await engine.runRaw(system, prompt, undefined, control)
      signal.throwIfAborted()
      if (settingsBefore !== JSON.stringify(this.settings))
        throw new DictationCleanupError('failed', 'Model settings changed during cleanup.')
      return { markdown: result.markdown, engineId: engine.id }
    } catch (error) {
      if (error instanceof DictationCleanupError || signal.aborted) throw error
      throw new DictationCleanupError(
        'failed',
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      this.askBusy = false
    }
  }

  private async pickDictationEngine(
    mode: 'local' | 'byok',
    consent: { provider: string; model: string } | null
  ): Promise<NotesEngine> {
    if (mode === 'byok') {
      const { engineChoice, cloud } = this.settings
      if (engineChoice !== 'cloud' || !cloud)
        throw new DictationCleanupError(
          'no-provider',
          'No hosted provider is selected in Settings.'
        )
      if (cloud.provider === 'groq' || cloud.provider === 'openrouter')
        throw new DictationCleanupError('no-provider', 'The selected provider is retired.')
      const model = cloud.model?.trim() ?? ''
      if (!consent || consent.provider !== cloud.provider || consent.model !== model)
        throw new DictationCleanupError(
          'no-consent',
          'Approve sending dictated text to this provider in Dictation settings.'
        )
      const apiKey = cloud.apiKeyEncrypted ? this.decryptApiKey(cloud.apiKeyEncrypted) : ''
      if (!apiKey && cloud.provider !== 'ollama')
        throw new DictationCleanupError('no-provider', 'The provider key is unavailable.')
      return new CloudNotesEngine({
        provider: cloud.provider,
        dataPolicyConfirmed: true,
        apiKey: apiKey ?? '',
        ...(model ? { model } : {})
      })
    }
    // The quickest installed model that fits this Mac, not necessarily the one notes use.
    const installed: Array<{ spec: LocalModelSpec; path: string }> = []
    for (const spec of LOCAL_MODELS) {
      if (spec.minRamGB > totalRamGB()) continue
      const path = await this.modelStore.find(spec)
      if (path) installed.push({ spec, path })
    }
    const fastest = fastestInstalled(installed.map((item) => item.spec))
    const chosen = installed.find((item) => item.spec.id === fastest?.id)
    if (!chosen) throw new DictationCleanupError('no-model', 'No local notes model is installed.')
    this.dictationSpec = chosen.spec
    this.dictationSpecAt = Date.now()
    return this.obtainDictationEngine(chosen.spec, chosen.path)
  }

  /**
   * The notes engine when it already runs this model; otherwise a dedicated one, so
   * dictating never swaps the model notes use (a reload each way).
   */
  private obtainDictationEngine(spec: LocalModelSpec, modelPath: string): LocalNotesEngine {
    if (this.localEngineModelId === spec.id || this.settings.activeLocalModelId === spec.id) {
      return this.obtainLocalEngine(spec, modelPath)
    }
    if (!this.dictationEngine || this.dictationEngineModelId !== spec.id) {
      void this.dictationEngine?.dispose().catch(() => {})
      this.dictationEngine = new LocalNotesEngine({
        modelUri: spec.uri,
        modelId: spec.id,
        onDiagnostic: this.engineLog.log,
        modelPath
      })
      this.dictationEngineModelId = spec.id
    }
    if (this.dictationEngineTimer) clearTimeout(this.dictationEngineTimer)
    this.dictationEngineTimer = setTimeout(() => void this.disposeDictationEngine(), 10 * 60_000)
    this.dictationEngineTimer.unref?.()
    return this.dictationEngine
  }

  private async disposeDictationEngine(): Promise<void> {
    if (this.dictationEngineTimer) clearTimeout(this.dictationEngineTimer)
    this.dictationEngineTimer = null
    const engine = this.dictationEngine
    this.dictationEngine = null
    this.dictationEngineModelId = null
    try {
      await engine?.dispose()
    } catch {
      // Freed anyway.
    }
  }

  /**
   * Load the local cleanup model now, while the person is still speaking, so it is
   * ready when they stop. Skipped (never queued) when a model task is running;
   * holds the shared lease while loading so nothing else starts on a half-loaded
   * model. A failure here is silent: the real cleanup reports its own.
   */
  warmDictationModel(): void {
    const notesStopped = this.cancelNotesWarmup()
    if (this.dictationWarm || this.askBusy || this.enhanceBusy || this.activateBusy) return
    this.askBusy = true
    const work = (async () => {
      try {
        await notesStopped
        const engine = await this.pickDictationEngine('local', null)
        if (engine instanceof LocalNotesEngine) await engine.prepare()
      } catch {
        // Cleanup will say what is wrong, if it is needed at all.
      } finally {
        this.askBusy = false
      }
    })()
    this.dictationWarm = work.finally(() => {
      this.dictationWarm = null
    })
  }

  /** Capture calls this without awaiting it, after the speech engine reports ready. */
  warmNotesModel(meetingId: string, source: 'mic' | 'system' | 'both' = 'both'): void {
    if (this.notesWarm) return
    this.clearNotesPrediction()
    const meeting = this.meetings.get(meetingId)
    if (!meeting) return
    const prediction = this.predictNotesPrompt(meetingId, meeting.segments, source)
    if (!prediction) return
    this.notesPrediction = { meetingId, source, system: prediction.system, timer: null }
    this.startNotesWarmup(meetingId, prediction, 'start')
  }

  private predictNotesPrompt(
    meetingId: string,
    segments: readonly MeetingTranscriptSegment[],
    source: 'mic' | 'system' | 'both'
  ): { system: string; predictedSpeakers: number } | null {
    const meeting = this.meetings.get(meetingId)
    if (!meeting) return null
    const participants = withSelfParticipant(meeting.participants, this.settings.profileName ?? '')
    const speakers = speakerInfos(
      segments.filter((segment) => !segment.echo),
      participants
    )
    // Before any speech, the UI's two-channel capture predicts mic-only use.
    // Once speech exists, use only observed, kept speakers, exactly as Generate does.
    if (speakers.length === 0) {
      const channel = source === 'system' ? 'system' : 'mic'
      speakers.push({
        label: speakerLabel({ channel, speaker: '' }, participants),
        isSelf: channel === 'mic'
      })
    }
    return {
      system: buildMergeSystemPrompt(meeting.templateId, speakers),
      predictedSpeakers: speakers.length
    }
  }

  /** Called with the same committed segments delivered to the renderer. Never awaits inference. */
  observeNotesTranscript(meetingId: string, segments: readonly MeetingTranscriptSegment[]): void {
    const current = this.notesPrediction
    if (!current || current.meetingId !== meetingId) return
    const prediction = this.predictNotesPrompt(meetingId, segments, current.source)
    if (!prediction || prediction.system === current.system) return
    current.system = prediction.system
    if (current.timer) clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      current.timer = null
      const warm = this.notesWarm
      // Settle the outstanding bounded batch before reusing its sequence.
      warm?.controller.abort(new GenerationError('canceled', 'Background roster changed.'))
      void (warm?.work ?? Promise.resolve()).then(() => {
        if (this.notesPrediction !== current || current.system !== prediction.system) return
        this.startNotesWarmup(meetingId, prediction, 'rewarm')
      })
    }, 3_000)
    current.timer.unref?.()
  }

  /** End capture prediction, but leave an already-running warm job for Generate to join. */
  endNotesPrediction(meetingId: string): void {
    if (this.notesPrediction?.meetingId === meetingId) this.clearNotesPrediction()
  }

  private startNotesWarmup(
    meetingId: string,
    { system, predictedSpeakers }: { system: string; predictedSpeakers: number },
    reason: 'start' | 'rewarm'
  ): void {
    let requiredMB: number | undefined
    let contextSize = NOTES_WARM_CONTEXT_SIZE
    const memory = (): {
      freeMB: number
      requiredMB?: number
      totalMB: number
      contextSize: number
    } => ({
      freeMB: Math.floor(freemem() / 1024 ** 2),
      requiredMB,
      totalMB: Math.floor(totalmem() / 1024 ** 2),
      contextSize
    })
    const skip = (
      reason: 'disabled' | 'cloud' | 'busy' | 'battery' | 'memory' | 'no-model' | 'no-meeting',
      onBatteryPower?: boolean
    ): void =>
      this.engineLog.log({
        event: 'warmup',
        reason: 'skipped',
        why: reason,
        onBatteryPower,
        ...memory()
      })
    if (!NOTES_WARMUP_ENABLED) return skip('disabled')
    if (this.settings.engineChoice !== 'local') return skip('cloud')
    if (
      this.notesWarm ||
      this.dictationWarm ||
      this.askBusy ||
      this.enhanceBusy ||
      this.activateBusy
    )
      return skip('busy')
    // Read Electron's current state at capture ready, never a settings/startup cache.
    const onBatteryPower = powerMonitor.isOnBatteryPower()
    if (onBatteryPower) return skip('battery', onBatteryPower)
    const selected = LOCAL_MODELS.find((spec) => spec.id === this.settings.activeLocalModelId)
    if (!selected) return skip('no-model')
    if (!this.meetings.get(meetingId)) return skip('no-meeting')
    const controller = new AbortController()
    const job = { meetingId, controller, work: Promise.resolve() }
    this.notesWarm = job
    // Yield to the capture ready callback; no disk/model work in the capture path.
    job.work = Promise.resolve()
      .then(async () => {
        controller.signal.throwIfAborted()
        preloadNotesRuntime(this.engineLog.log)
        const lookupStarted = Date.now()
        const modelPath = await this.modelStore.find(selected)
        this.engineLog.log({
          event: 'prepare',
          stage: 'model-lookup',
          elapsedMs: Date.now() - lookupStarted,
          modelId: selected.id
        })
        controller.signal.throwIfAborted()
        if (!modelPath) return skip('no-model')
        if (this.localEngineModelId === selected.id && this.localEnginePath === modelPath)
          contextSize = this.localEngine?.warmContextSize ?? NOTES_WARM_CONTEXT_SIZE
        const estimateStarted = Date.now()
        const required = await estimateNotesWarmupBytes(modelPath, contextSize)
        this.engineLog.log({
          event: 'prepare',
          stage: 'footprint',
          elapsedMs: Date.now() - estimateStarted,
          modelId: selected.id
        })
        controller.signal.throwIfAborted()
        requiredMB = required === null ? undefined : Math.ceil(required / 1024 ** 2)
        if (required === null || selected.minRamGB > totalRamGB() || freemem() < required)
          return skip('memory')
        // Settings/power can change while metadata is being read. Cancellation owns settings changes.
        if (powerMonitor.isOnBatteryPower()) return skip('battery', true)
        this.engineLog.log({
          event: 'warmup',
          reason,
          predictedSpeakers,
          modelId: selected.id,
          onBatteryPower,
          ...memory()
        })
        const engine = this.obtainLocalEngine(selected, modelPath)
        controller.signal.throwIfAborted()
        await engine.warm(system, controller.signal)
        this.engineLog.log({ event: 'warmup', reason: 'complete', modelId: selected.id })
      })
      .catch((error) => {
        this.engineLog.log({
          event: controller.signal.aborted ? 'warmup' : 'failure',
          reason: controller.signal.aborted ? 'cancel' : undefined,
          error: controller.signal.aborted ? controller.signal.reason : error,
          modelId: selected.id
        })
      })
      .finally(() => {
        if (this.notesWarm === job) this.notesWarm = null
      })
  }

  /** Higher-priority work requests native cancellation; capture never awaits this. */
  cancelNotesWarmup(meetingId?: string): Promise<void> {
    const warm = this.notesWarm
    if (meetingId === undefined || this.notesPrediction?.meetingId === meetingId)
      this.clearNotesPrediction()
    if (meetingId !== undefined && warm?.meetingId !== meetingId) return Promise.resolve()
    warm?.controller.abort(new GenerationError('canceled', 'Background notes warm-up canceled.'))
    return warm?.work ?? Promise.resolve()
  }

  /** Cheap, settings-only view for the Dictation panel; touches no model file. */
  dictationCleanupOptions(): {
    localModelLabel: string | null
    byok: { provider: string; model: string; hasKey: boolean } | null
  } {
    const { activeLocalModelId, engineChoice, cloud } = this.settings
    const local = LOCAL_MODELS.find((m) => m.id === activeLocalModelId)
    // The model dictation last used, once it has used one; until then the notes model.
    const chosen = this.dictationSpec && Date.now() - this.dictationSpecAt < 60 * 60_000
    return {
      localModelLabel: (chosen ? this.dictationSpec?.label : local?.label) ?? null,
      byok:
        engineChoice === 'cloud' && cloud
          ? {
              provider: cloud.provider,
              model: cloud.model?.trim() ?? '',
              hasKey: Boolean(cloud.apiKeyEncrypted) || cloud.provider === 'ollama'
            }
          : null
    }
  }

  /* ---- settings ---- */

  batchTranscriptionSettings(): BatchTranscriptionSettings {
    return normalizeBatchSettings(this.settings.batchTranscription)
  }

  private settingsView(): NotesSettingsView {
    const { engineChoice, activeLocalModelId, profileName, cloud } = this.settings
    return {
      engineChoice,
      batchTranscription: this.batchTranscriptionSettings(),
      autoGenerateNotesAfterStop: autoGenerateNotesAfterStop(
        this.settings.autoGenerateNotesAfterStop
      ),
      ...(activeLocalModelId ? { activeLocalModelId } : {}),
      ...(profileName ? { profileName } : {}),
      ...(cloud
        ? {
            cloud: {
              provider: cloud.provider,
              dataPolicyConfirmed: cloud.dataPolicyConfirmed === true,
              ...(cloud.model ? { model: cloud.model } : {}),
              // "Usable", strictly speaking: Ollama is keyless by design.
              hasKey: Boolean(cloud.apiKeyEncrypted) || cloud.provider === 'ollama'
            }
          }
        : {})
    }
  }

  private applySettings(update: NotesSettingsUpdate): NotesSettingsView {
    void this.cancelNotesWarmup()
    let error: string | undefined
    const previousSettings = { ...this.settings }
    if (update.batchTranscription)
      this.settings.batchTranscription = normalizeBatchSettings(update.batchTranscription)

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

    const validProviders: CloudProvider[] = ['anthropic', 'openai', 'grok', 'gemini', 'ollama']
    if (update.cloud === null) {
      delete this.settings.cloud
    } else if (update.cloud && validProviders.includes(update.cloud.provider as CloudProvider)) {
      const provider = update.cloud.provider as CloudProvider
      const model =
        typeof update.cloud.model === 'string' && update.cloud.model.trim()
          ? update.cloud.model.trim()
          : undefined
      const previous = this.settings.cloud
      // Keys are provider-specific: never reuse one for a different provider.
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

      if (!error && (apiKeyEncrypted || provider === 'ollama')) {
        this.settings.cloud = {
          provider,
          dataPolicyConfirmed: update.cloud.dataPolicyConfirmed === true,
          ...(model ? { model } : {}),
          ...(apiKeyEncrypted ? { apiKeyEncrypted } : {})
        }
      } else if (!error) {
        error = 'Enter an API key for the selected provider. Your previous settings are preserved.'
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
        batchTranscription: normalizeBatchSettings(
          raw.batchTranscription ?? {
            parakeetModel:
              (raw as { transcriptionLanguage?: string }).transcriptionLanguage === 'multilingual'
                ? 'v3'
                : 'v2'
          }
        ),
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
          dataPolicyConfirmed: cloud.dataPolicyConfirmed === true,
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
      this.engineLog.log({ event: 'failure', stage: 'settings', error: err })
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
function bestNotesOf(
  record: MeetingRecord
): Pick<GlobalAskMeeting, 'notesMarkdown' | 'sourceTruncated'> | null {
  const enhanced = record.enhancedMarkdown?.trim()
  if (enhanced) return { notesMarkdown: enhanced }
  const raw = record.rawNotesMarkdown.trim()
  if (raw) return { notesMarkdown: raw }
  const spoken = record.segments
    .filter((s) => !s.echo)
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n')
    .trim()
  if (spoken.length === 0) return null
  if (spoken.length <= TRANSCRIPT_EXCERPT_CHARS) return { notesMarkdown: spoken }
  let prefix = spoken.slice(0, TRANSCRIPT_EXCERPT_CHARS)
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1)
  return { notesMarkdown: `${prefix}…`, sourceTruncated: true }
}

function isGlobalChatEntry(entry: unknown): entry is GlobalChatEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const e = entry as Partial<GlobalChatEntry>
  return (
    typeof e.question === 'string' && typeof e.answer === 'string' && typeof e.askedAt === 'string'
  )
}
