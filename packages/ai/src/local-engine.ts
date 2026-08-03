import os from 'node:os'
import path from 'node:path'
import type { Llama, LlamaModel } from 'node-llama-cpp'
import { ASK_SYSTEM_PROMPT, buildAskUserMessage } from './ask-prompt'
import { buildGlobalAskUserMessage, GLOBAL_ASK_SYSTEM_PROMPT, type GlobalAskInput } from './global-ask-prompt'
import { generateMeetingNotes } from './map-reduce'
import type { AskAnswer, AskInput, MergeInput, MergedNotes, NotesEngine, NotesProgress } from './types'

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
 * The default Doodle Note engine: an on-device model downloaded during
 * onboarding and run in-process (llama.cpp with Metal). No account, no API
 * key, nothing leaves the machine.
 */
export interface LocalEngineOptions {
  /** node-llama-cpp model URI (hf:...) or an absolute GGUF path. */
  modelUri: string
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
  /** GPU layer failed once (load or context) — stay on CPU from then on. */
  private forceCpu = false
  private readonly options: LocalEngineOptions

  constructor(options: LocalEngineOptions) {
    this.options = options
    this.id = `local:${options.modelUri}`
    this.label = 'On-device model'
  }

  /** Download (if needed) and load the model. Safe to call more than once. */
  async prepare(): Promise<void> {
    if (this.model) return
    const { getLlama, resolveModelFile } = await loadNodeLlamaCpp()
    this.modelPath = await resolveModelFile(this.options.modelUri, {
      directory: this.options.modelsDir ?? DEFAULT_MODELS_DIR,
      cli: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        if (totalSize > 0) this.options.onDownloadProgress?.(downloadedSize / totalSize)
      }
    })
    // Staged load: the default compute layer first (Metal on mac, Vulkan on
    // Windows when present), then CPU-only. Shared laptop iGPUs under Vulkan
    // fail intermittently — whether the weights or the KV cache fit depends
    // on what else is using GPU memory at that moment — with llama.cpp's
    // bare "failed to load model". The CPU binary always loads given enough
    // RAM, and once the GPU misbehaves we stop trusting it (forceCpu).
    // build:'never' everywhere: a packaged app must never attempt a
    // from-source build (no toolchain on user machines).
    if (!this.forceCpu) {
      try {
        this.llama = await getLlama({ build: 'never' })
        this.model = await this.llama.loadModel({ modelPath: this.modelPath })
        return
      } catch (gpuErr) {
        console.error('[local-engine] default compute layer failed, retrying CPU-only:', gpuErr)
        this.forceCpu = true
      }
    }
    try {
      this.llama = await getLlama({ gpu: false, build: 'never' })
      this.model = await this.llama.loadModel({ modelPath: this.modelPath })
    } catch (cpuErr) {
      this.llama = null
      this.model = null
      const detail = cpuErr instanceof Error ? cpuErr.message : String(cpuErr)
      throw new Error(
        `The on-device model could not be loaded (tried GPU, then CPU): ${detail}. ` +
          'If this keeps happening, re-download the model from Settings → Notes model.'
      )
    }
  }

  async generateNotes(
    input: MergeInput,
    onToken?: (text: string) => void,
    onProgress?: (progress: NotesProgress) => void
  ): Promise<MergedNotes> {
    return generateMeetingNotes(this, input, onToken, onProgress)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runRaw(ASK_SYSTEM_PROMPT, buildAskUserMessage(input), onToken)
  }

  async askAcrossMeetings(
    input: GlobalAskInput,
    onToken?: (text: string) => void
  ): Promise<AskAnswer> {
    return this.runRaw(GLOBAL_ASK_SYSTEM_PROMPT, buildGlobalAskUserMessage(input), onToken)
  }

  /**
   * One generation against the loaded model. Fresh context per call: no state
   * bleeds between runs, and the model weights stay loaded across calls.
   */
  async runRaw(
    systemPrompt: string,
    userMessage: string,
    onToken?: (text: string) => void
  ): Promise<MergedNotes> {
    await this.prepare()
    const { LlamaChatSession } = await loadNodeLlamaCpp()
    const started = Date.now()

    let context: Awaited<ReturnType<LlamaModel['createContext']>>
    try {
      context = await this.model!.createContext({
        contextSize: this.options.contextSize ?? 16384
      })
    } catch (err) {
      if (this.forceCpu) throw err
      // Weights fit on the GPU but the KV cache didn't — reload on CPU.
      console.error('[local-engine] context creation failed on GPU, reloading CPU-only:', err)
      this.forceCpu = true
      await this.model?.dispose()
      this.model = null
      this.llama = null
      await this.prepare()
      context = await this.model!.createContext({
        contextSize: this.options.contextSize ?? 16384
      })
    }
    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt
      })
      const markdown = await session.prompt(userMessage, {
        temperature: 0.3,
        onTextChunk: onToken
      })
      return {
        markdown: markdown.trim(),
        engine: this.id,
        elapsedMs: Date.now() - started
      }
    } finally {
      await context.dispose()
    }
  }

  async dispose(): Promise<void> {
    await this.model?.dispose()
    this.model = null
    this.llama = null
  }
}
