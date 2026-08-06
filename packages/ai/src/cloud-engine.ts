import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { buildAskSystemPrompt, buildAskUserMessage } from './ask-prompt'
import { buildGlobalAskUserMessage, GLOBAL_ASK_SYSTEM_PROMPT, type GlobalAskInput } from './global-ask-prompt'
import { generateMeetingNotes } from './map-reduce'
import type { AskAnswer, AskInput, MergeInput, MergedNotes, NotesEngine, NotesProgress } from './types'

/**
 * The optional BYOK path: same merge, run against the user's own API key.
 * Added in settings AFTER onboarding — the local engine is the default.
 *
 * groq / openrouter / ollama speak the OpenAI wire protocol — one client,
 * different base URLs. Ollama runs locally and needs no real key.
 */
export type CloudProviderId = 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'ollama'

export interface CloudEngineOptions {
  provider: CloudProviderId
  apiKey: string
  /** Provider model id; falls back to a sensible default per provider. */
  model?: string
}

export const CLOUD_PROVIDER_PRESETS: Record<
  CloudProviderId,
  { label: string; defaultModel: string; baseURL?: string; keyOptional?: boolean }
> = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-5' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-5' },
  groq: {
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1'
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    baseURL: 'https://openrouter.ai/api/v1'
  },
  ollama: {
    label: 'Ollama (local)',
    defaultModel: 'llama3.1',
    baseURL: 'http://localhost:11434/v1',
    keyOptional: true
  }
}

export class CloudNotesEngine implements NotesEngine {
  readonly id: string
  readonly label: string
  /** Frontier context windows dwarf the local 16K — condense only marathon
   *  transcripts (~5+ hours of speech). */
  readonly singlePassThresholdChars = 400_000
  private readonly options: CloudEngineOptions

  constructor(options: CloudEngineOptions) {
    this.options = options
    this.id = `cloud:${options.provider}:${options.model ?? 'default'}`
    const preset = CLOUD_PROVIDER_PRESETS[options.provider]
    this.label =
      options.provider === 'ollama' ? preset.label : `${preset.label} (your key)`
  }

  async generateNotes(
    input: MergeInput,
    onToken?: (text: string) => void,
    onProgress?: (progress: NotesProgress) => void
  ): Promise<MergedNotes> {
    return generateMeetingNotes(this, input, onToken, onProgress)
  }

  async askQuestion(input: AskInput, onToken?: (text: string) => void): Promise<AskAnswer> {
    return this.runRaw(buildAskSystemPrompt(input.speakers), buildAskUserMessage(input), onToken)
  }

  async askAcrossMeetings(
    input: GlobalAskInput,
    onToken?: (text: string) => void
  ): Promise<AskAnswer> {
    return this.runRaw(GLOBAL_ASK_SYSTEM_PROMPT, buildGlobalAskUserMessage(input), onToken)
  }

  async runRaw(
    system: string,
    prompt: string,
    onToken?: (text: string) => void
  ): Promise<MergedNotes> {
    const started = Date.now()
    const preset = CLOUD_PROVIDER_PRESETS[this.options.provider]
    const modelId = this.options.model?.trim() || preset.defaultModel
    const model =
      this.options.provider === 'anthropic'
        ? createAnthropic({ apiKey: this.options.apiKey })(modelId)
        : createOpenAI({
            // Ollama's OpenAI shim rejects an empty Authorization header.
            apiKey: this.options.apiKey || 'ollama',
            ...(preset.baseURL ? { baseURL: preset.baseURL } : {})
          })(modelId)

    const { text } = await generateText({ model, system, prompt, temperature: 0.3 })
    onToken?.(text)
    return { markdown: text.trim(), engine: this.id, elapsedMs: Date.now() - started }
  }
}
