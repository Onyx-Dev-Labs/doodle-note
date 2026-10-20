import { assertRequestFits } from './bounded-request'
import {
  GENERATION_LIMITS,
  requireCompleteOutput,
  withGenerationDeadline
} from './generation-control'
import os from 'node:os'
import path from 'node:path'
import type { Llama, LlamaModel } from 'node-llama-cpp'
import { buildAskSystemPrompt, buildAskUserMessage } from './ask-prompt'
import {
  buildGlobalAskPrompt,
  GLOBAL_ASK_SYSTEM_PROMPT,
  type GlobalAskInput
} from './global-ask-prompt'
import { generateMeetingNotes } from './map-reduce'
import type {
  AskAnswer,
  AskInput,
  GenerationControl,
  MergeInput,
  MergedNotes,
  NotesEngine,
  NotesProgress
} from './types'

/**
 * node-llama-cpp is ESM-only *with top-level await*, so it cannot be
 * `require()`d — and the Electron main process bundles this package to CJS.
 * A lazy dynamic import() survives CJS bundling verbatim (rollup keeps
 * `import()` expressions in cjs output), so the module loads correctly from
 * both ESM (tsx scripts) and CJS (Electron main) consumers.
 */
type NodeLlamaCpp = typeof import('node-llama-cpp')
let nodeLlamaCppPromise: Promise<NodeLlamaCpp> | null = null
function loadNodeLlamaCpp(): Promise<NodeLlamaCpp> {
  nodeLlamaCppPromise ??= import('node-llama-cpp')
  return nodeLlamaCppPromise
}

/**
 * The default DoodleNote engine: an on-device model downloaded during
 * onboarding and run in-process (llama.cpp with Metal). No account, no API
 * key, nothing leaves the machine.
 */
export interface LocalEngineOptions {
  /** node-llama-cpp model URI (hf:...) or an absolute GGUF path. */
  modelUri: string
  /** Verified local artifact; preserves the catalog URI as the public engine ID. */
  modelPath?: string
  /** Where models live; the desktop app passes its userData models dir. */
  modelsDir?: string
  /** Download progress (0..1); only fires when the model isn't cached yet. */
  onDownloadProgress?: (fraction: number) => void
  /** Tokens of context; transcripts are trimmed upstream to fit. */
  contextSize?: number
}

export const DEFAULT_MODELS_DIR = path.join(os.homedir(), '.cache', 'doodle-note', 'models')

export class LocalNotesEngine implements NotesEngine {
  readonly id: string
  readonly label: string

  private llama: Llama | null = null
  private model: LlamaModel | null = null
  private modelPath: string | null = null
  /** Default compute failed once (load or context) — stay on CPU from then on. */
  private forceCpu = false
  private readonly options: LocalEngineOptions

  constructor(options: LocalEngineOptions) {
    this.options = options
    this.id = `local:${options.modelUri}`
    this.label = 'On-device model'
  }

  /** Download (if needed) and load the model. Safe to call more than once. */
  async prepare(signal?: AbortSignal): Promise<void> {
    return this.prepareModel(signal)
  }

  private async acquireRuntime(
    cpuOnly: boolean,
    signal?: AbortSignal,
    defaultFailure?: unknown
  ): Promise<Llama> {
    const { getLlama, NoBinaryFoundError } = await loadNodeLlamaCpp()
    try {
      const llama = await getLlama({ ...(cpuOnly ? { gpu: false } : {}), build: 'never' })
      signal?.throwIfAborted()
      return llama
    } catch (error) {
      signal?.throwIfAborted()
      const cause =
        defaultFailure === undefined
          ? error
          : new AggregateError(
              [defaultFailure, error],
              'Default compute and CPU runtime acquisition failed'
            )
      // The exported class has name === 'Error'. Only classify acquisition,
      // never model loading/context failures or matching message strings.
      if (!(error instanceof NoBinaryFoundError)) {
        if (defaultFailure === undefined) throw error
        throw new Error(
          'The local inference runtime could not be initialized. Restart DoodleNote to retry.',
          { cause }
        )
      }
      const prior = defaultFailure === undefined ? '' : 'The default compute attempt failed. '
      const runtime = cpuOnly ? 'CPU-only' : 'default compute'
      throw new Error(
        `Local inference is unavailable. ${prior}No usable ${runtime} runtime was found in this app installation. ` +
          'Restart DoodleNote to retry the default compute runtime. If this continues, install a compatible DoodleNote build.',
        { cause }
      )
    }
  }

  private async prepareModel(signal?: AbortSignal, defaultFailure?: unknown): Promise<void> {
    signal?.throwIfAborted()
    if (this.model) return
    const { resolveModelFile } = await loadNodeLlamaCpp()
    this.modelPath =
      this.options.modelPath ??
      (await resolveModelFile(this.options.modelUri, {
        directory: this.options.modelsDir ?? DEFAULT_MODELS_DIR,
        cli: false,
        onProgress: ({ totalSize, downloadedSize }) => {
          if (totalSize > 0) this.options.onDownloadProgress?.(downloadedSize / totalSize)
        }
      }))
    signal?.throwIfAborted()
    // Staged load: the default compute layer first (Metal on mac, Vulkan on
    // Windows when present), then CPU-only. A default load or context failure
    // makes CPU selection sticky; a usable CPU runtime is not guaranteed to
    // be present in every installation. The failure alone does not prove OOM.
    // build:'never' everywhere: a packaged app must never attempt a
    // from-source build (no toolchain on user machines).
    if (!this.forceCpu) {
      try {
        this.llama = await this.acquireRuntime(false, signal)
        this.model = await this.llama.loadModel({
          modelPath: this.modelPath,
          loadSignal: signal
        })
        return
      } catch (gpuErr) {
        this.llama = null
        this.model = null
        signal?.throwIfAborted()
        console.error('[local-engine] default compute layer failed, retrying CPU-only:', gpuErr)
        defaultFailure = gpuErr
        this.forceCpu = true
      }
    }
    // Keep runtime selection outside the model-load recovery advice: replacing
    // a GGUF cannot supply a missing or unusable native runtime.
    this.llama = null
    this.llama = await this.acquireRuntime(true, signal, defaultFailure)
    try {
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        loadSignal: signal
      })
    } catch (cpuErr) {
      this.llama = null
      this.model = null
      signal?.throwIfAborted()
      const detail = cpuErr instanceof Error ? cpuErr.message : String(cpuErr)
      const attempts = defaultFailure === undefined ? 'CPU' : 'tried default compute, then CPU'
      throw new Error(
        `The on-device model could not be loaded (${attempts}): ${detail}. ` +
          'If this keeps happening, re-download the model from Settings → Notes model.',
        {
          cause:
            defaultFailure === undefined ? cpuErr : new AggregateError([defaultFailure, cpuErr])
        }
      )
    }
  }

  async generateNotes(
    input: MergeInput,
    onToken?: (text: string) => void,
    onProgress?: (progress: NotesProgress) => void,
    control?: GenerationControl
  ): Promise<MergedNotes> {
    return generateMeetingNotes(this, input, onToken, onProgress, control)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runRaw(buildAskSystemPrompt(input.speakers), buildAskUserMessage(input), onToken)
  }

  async askAcrossMeetings(
    input: GlobalAskInput,
    onToken?: (text: string) => void
  ): Promise<AskAnswer> {
    return this.runRaw(GLOBAL_ASK_SYSTEM_PROMPT, '', onToken, undefined, input)
  }

  async runBounded(system: string, prompt: string, control?: GenerationControl): Promise<MergedNotes> {
    return this.runRaw(system, prompt, undefined, control, undefined, true)
  }

  /**
   * One generation against the loaded model. Fresh context per call: no state
   * bleeds between runs, and the model weights stay loaded across calls.
   */
  async runRaw(
    systemPrompt: string,
    userMessage: string,
    onToken?: (text: string) => void,
    control?: GenerationControl,
    globalAskInput?: GlobalAskInput,
    bounded = false
  ): Promise<AskAnswer> {
    await withGenerationDeadline(control?.signal, 'preparing', (signal) => this.prepare(signal))
    return withGenerationDeadline(control?.signal, control?.phase ?? 'writing', async (signal) => {
      signal.throwIfAborted()
      const { LlamaChatSession } = await loadNodeLlamaCpp()
      const started = Date.now()

      let context: Awaited<ReturnType<LlamaModel['createContext']>>
      try {
        context = await this.model!.createContext({
          contextSize: this.options.contextSize ?? 16384
        })
      } catch (err) {
        signal.throwIfAborted()
        if (this.forceCpu) throw err
        // Context creation failed on the default compute layer; try CPU without
        // assuming the cause was GPU memory exhaustion.
        console.error('[local-engine] default context creation failed, reloading CPU-only:', err)
        this.forceCpu = true
        await this.model?.dispose()
        this.model = null
        this.llama = null
        await this.prepareModel(signal, err)
        context = await this.model!.createContext({
          contextSize: this.options.contextSize ?? 16384
        })
      }
      try {
        signal.throwIfAborted()
        const session = new LlamaChatSession({
          contextSequence: context.getSequence(),
          systemPrompt,
          // Gemma requires explicit admission before folding system rules into its user turn.
          forceAddSystemPrompt: true
        })
        const prompt = globalAskInput
          ? buildGlobalAskPrompt(globalAskInput, {
              contextWindowTokens: context.contextSize,
              outputReserveTokens: GENERATION_LIMITS.writing.maxTokens,
              safetyMarginTokens: 256,
              accounting: 'model-tokenizer',
              countInputTokens: (_system, user) =>
                session.chatWrapper
                  .generateContextState({
                    chatHistory: [
                      ...session.getChatHistory(),
                      { type: 'user', text: user },
                      { type: 'model', response: [] }
                    ]
                  })
                  .contextText.tokenize(this.model!.tokenizer).length
            })
          : undefined
        if (bounded) assertRequestFits(systemPrompt, userMessage, {
          contextWindowTokens: context.contextSize,
          outputReserveTokens: GENERATION_LIMITS.writing.maxTokens,
          safetyMarginTokens: 256,
          accounting: 'model-tokenizer',
          countInputTokens: (_system, user) => session.chatWrapper.generateContextState({
            chatHistory: [...session.getChatHistory(), { type: 'user', text: user }, { type: 'model', response: [] }]
          }).contextText.tokenize(this.model!.tokenizer).length
        })
        signal.throwIfAborted()
        const result = await session.promptWithMeta(prompt?.user ?? userMessage, {
          signal,
          maxTokens: GENERATION_LIMITS[control?.phase ?? 'writing'].maxTokens,
          temperature: 0.3,
          onTextChunk: (text) => {
            control?.onActivity?.()
            onToken?.(text)
          }
        })
        signal.throwIfAborted()
        requireCompleteOutput(result.stopReason, control?.phase ?? 'writing')
        return {
          ...(prompt ? { coverage: prompt.coverage } : {}),
          markdown: result.responseText.trim(),
          engine: this.id,
          elapsedMs: Date.now() - started
        }
      } finally {
        await context.dispose()
      }
    })
  }

  async dispose(): Promise<void> {
    await this.model?.dispose()
    this.model = null
    this.llama = null
  }
}
