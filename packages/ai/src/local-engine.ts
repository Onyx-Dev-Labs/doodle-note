import os from 'node:os'
import path from 'node:path'
import { getLlama, LlamaChatSession, resolveModelFile, type Llama, type LlamaModel } from 'node-llama-cpp'
import { buildMergeUserMessage, MERGE_SYSTEM_PROMPT } from './prompt'
import type { MergeInput, MergedNotes, NotesEngine } from './types'

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
    await this.prepare()
    const started = Date.now()

    // Fresh context per meeting: no state bleeds between generations, and the
    // model weights stay loaded across calls.
    const context = await this.model!.createContext({
      contextSize: this.options.contextSize ?? 8192
    })
    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: MERGE_SYSTEM_PROMPT
      })
      const markdown = await session.prompt(buildMergeUserMessage(input), {
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
