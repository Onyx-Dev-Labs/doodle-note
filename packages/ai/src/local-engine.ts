import os from 'node:os'
import path from 'node:path'
import type { Llama, LlamaModel } from 'node-llama-cpp'
import { ASK_SYSTEM_PROMPT, buildAskUserMessage } from './ask-prompt'
import { buildGlobalAskUserMessage, GLOBAL_ASK_SYSTEM_PROMPT, type GlobalAskInput } from './global-ask-prompt'
import { buildMergeSystemPrompt, buildMergeUserMessage } from './prompt'
import type { AskAnswer, AskInput, MergeInput, MergedNotes, NotesEngine } from './types'

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
    this.llama = await getLlama()
    this.model = await this.llama.loadModel({ modelPath: this.modelPath })
  }

  async generateNotes(input: MergeInput, onToken?: (text: string) => void): Promise<MergedNotes> {
    return this.runPrompt(buildMergeSystemPrompt(input.templateId), buildMergeUserMessage(input), onToken)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runPrompt(ASK_SYSTEM_PROMPT, buildAskUserMessage(input), onToken)
  }

  async askAcrossMeetings(
    input: GlobalAskInput,
    onToken?: (text: string) => void
  ): Promise<AskAnswer> {
    return this.runPrompt(GLOBAL_ASK_SYSTEM_PROMPT, buildGlobalAskUserMessage(input), onToken)
  }

  /**
   * One generation against the loaded model. Fresh context per call: no state
   * bleeds between runs, and the model weights stay loaded across calls.
   */
  private async runPrompt(
    systemPrompt: string,
    userMessage: string,
    onToken?: (text: string) => void
  ): Promise<MergedNotes> {
    await this.prepare()
    const { LlamaChatSession } = await loadNodeLlamaCpp()
    const started = Date.now()

    const context = await this.model!.createContext({
      contextSize: this.options.contextSize ?? 8192
    })
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
